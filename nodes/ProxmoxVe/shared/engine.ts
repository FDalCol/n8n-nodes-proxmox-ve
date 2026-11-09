import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import {
	redactString,
	SecurityError,
	validateNodeName,
	validateStorageId,
	validateVmid,
} from './security';
import { parseUpid, validateWaitOptions, waitForTask } from './tasks';
import { isUpid, type ProxmoxClient } from './transport';

export type OperationResult =
	| { kind: 'data'; data: unknown }
	| { kind: 'list'; data: unknown }
	| { kind: 'task'; upid: unknown; extra?: IDataObject }
	| { kind: 'tasks'; tasks: Array<{ upid: unknown; extra?: IDataObject }> }
	| { kind: 'items'; items: INodeExecutionData[] };

export type OperationHandler = (ctx: OperationContext) => Promise<OperationResult>;

export type ResourceHandlers = Record<string, OperationHandler>;

export const data = (value: unknown): OperationResult => ({ kind: 'data', data: value });
export const list = (value: unknown): OperationResult => ({ kind: 'list', data: value });
export const task = (upid: unknown, extra?: IDataObject): OperationResult => ({ kind: 'task', upid, extra });

/** Proxmox VE parameter names: letters, digits, "-" and "_", e.g. memory, net0, prune-backups. */
const PARAM_NAME = /^[a-z][a-z0-9_-]{0,63}$/i;

/** Per item context with typed parameter accessors. */
export class OperationContext {
	constructor(
		readonly ef: IExecuteFunctions,
		readonly client: ProxmoxClient,
		readonly itemIndex: number,
	) {}

	param<T = unknown>(name: string, fallback?: unknown): T {
		return this.ef.getNodeParameter(name, this.itemIndex, fallback) as T;
	}

	str(name: string, fallback = ''): string {
		const v = this.param<unknown>(name, fallback);
		return v === undefined || v === null ? '' : String(v).trim();
	}

	optStr(name: string): string | undefined {
		const v = this.str(name, '');
		return v === '' ? undefined : v;
	}

	num(name: string, fallback?: number): number {
		const v = Number(this.param<unknown>(name, fallback));
		if (!Number.isFinite(v)) throw this.client.error(`Parameter "${name}" must be a number`);
		return v;
	}

	bool(name: string, fallback = false): boolean {
		return this.param<unknown>(name, fallback) === true;
	}

	/** Collection parameter without empty values. */
	collection(name: string): IDataObject {
		const raw = this.param<IDataObject>(name, {}) ?? {};
		const out: IDataObject = {};
		for (const [k, v] of Object.entries(raw)) {
			if (v === undefined || v === null || v === '') continue;
			out[k] = typeof v === 'string' ? v.trim() : v;
		}
		return out;
	}

	/** Runs a validation function and converts its error into a NodeOperationError. */
	guard<T>(fn: () => T): T {
		try {
			return fn();
		} catch (error) {
			throw this.client.error((error as Error).message);
		}
	}

	locator(name: string): string {
		const v = this.ef.getNodeParameter(name, this.itemIndex, undefined, { extractValue: true });
		return v === undefined || v === null ? '' : String(v).trim();
	}

	node(name = 'node'): string {
		return validateNodeName(this.locator(name));
	}

	vmid(name = 'vmid'): number {
		return validateVmid(this.locator(name));
	}

	storage(name = 'storage'): string {
		return validateStorageId(this.locator(name));
	}

	/**
	 * Reads an "Additional Parameters" fixed collection. Names must look like Proxmox VE
	 * parameter names; unknown names are rejected by Proxmox VE with a clear error.
	 */
	additional(name = 'additionalParameters', reserved: string[] = []): IDataObject {
		const raw = this.param<{ parameter?: Array<{ name?: string; value?: unknown }> }>(name, {}) ?? {};
		const out: IDataObject = {};
		for (const entry of raw.parameter ?? []) {
			const key = String(entry.name ?? '').trim();
			if (key === '') continue;
			if (!PARAM_NAME.test(key)) throw this.client.error(`Invalid parameter name "${key.slice(0, 64)}"`);
			if (reserved.includes(key) || key in out) {
				throw this.client.error(`Parameter "${key}" is set more than once`);
			}
			const value = entry.value;
			out[key] = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
		}
		return out;
	}
}

function toJson(value: unknown): IDataObject {
	if (value === null || value === undefined) return { success: true };
	if (typeof value === 'object' && !Array.isArray(value)) return value as IDataObject;
	if (Array.isArray(value)) return { data: value as IDataObject[] };
	return { value: value as string | number | boolean };
}

async function resolveTask(ctx: OperationContext, upid: unknown, extra: IDataObject = {}): Promise<IDataObject> {
	if (!isUpid(upid)) {
		// Some endpoints return null or a value instead of a task ID (e.g. synchronous variants)
		return { ...extra, ...toJson(upid) };
	}
	const wait = ctx.param<boolean>('waitForCompletion', false) === true;
	if (!wait) {
		const parsed = parseUpid(upid);
		return { ...extra, upid, node: parsed.node, type: parsed.type, id: parsed.id };
	}
	const options = validateWaitOptions(ctx.client.node, ctx.param<IDataObject>('waitOptions', {}) ?? {}, ctx.itemIndex);
	const status = await waitForTask(ctx.client, upid, options);
	return { ...extra, ...status };
}

/** Converts an operation result into output items (with pairedItem and redaction). */
export async function finalize(ctx: OperationContext, result: OperationResult): Promise<INodeExecutionData[]> {
	const pairedItem = { item: ctx.itemIndex };
	const wrap = (json: IDataObject): INodeExecutionData => ({ json: ctx.client.redactValue(json), pairedItem });
	switch (result.kind) {
		case 'data':
			return [wrap(toJson(result.data))];
		case 'list': {
			const arr = Array.isArray(result.data) ? result.data : result.data === null || result.data === undefined ? [] : [result.data];
			const split = ctx.param<boolean>('splitIntoItems', true) !== false;
			if (!split) return [wrap({ data: arr as IDataObject[] })];
			return arr.map((entry) =>
				wrap(entry !== null && typeof entry === 'object' && !Array.isArray(entry) ? (entry as IDataObject) : { value: entry as string }),
			);
		}
		case 'task':
			return [wrap(await resolveTask(ctx, result.upid, result.extra))];
		case 'tasks': {
			const out: INodeExecutionData[] = [];
			for (const t of result.tasks) out.push(wrap(await resolveTask(ctx, t.upid, t.extra)));
			return out;
		}
		case 'items':
			return result.items.map((item) => ({ ...item, json: ctx.client.redactValue(item.json), pairedItem }));
	}
}

/** Converts any thrown error into a safe message/description without secrets. */
export function safeError(client: ProxmoxClient | undefined, error: unknown): { message: string; description?: string } {
	const e = error as { message?: string; description?: string | null };
	let message = typeof e?.message === 'string' && e.message ? e.message : 'Unknown error';
	let description = typeof e?.description === 'string' ? e.description : undefined;
	if (error instanceof SecurityError) description = undefined;
	if (client) {
		message = client.redact(message);
		description = description ? client.redact(description) : undefined;
	} else {
		message = redactString(message);
		description = description ? redactString(description) : undefined;
	}
	return { message, description };
}
