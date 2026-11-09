import { NodeOperationError, type IDataObject, type INode } from 'n8n-workflow';

import {
	apiPath,
	MAX_POLL_ITERATIONS,
	MAX_WAIT_SECONDS,
	MIN_POLL_INTERVAL_SECONDS,
	validateNodeName,
} from './security';
import { isUpid, type ProxmoxClient } from './transport';

export interface ParsedUpid {
	upid: string;
	node: string;
	pid: number;
	starttime: number;
	type: string;
	id: string;
	user: string;
}

export function parseUpid(upid: string): ParsedUpid {
	if (!isUpid(upid)) throw new Error('Invalid task ID (UPID)');
	const parts = upid.split(':');
	return {
		upid,
		node: validateNodeName(parts[1]),
		pid: parseInt(parts[2], 16),
		starttime: parseInt(parts[4], 16),
		type: parts[5],
		id: parts[6],
		user: parts[7],
	};
}

export interface WaitOptions {
	intervalSeconds: number;
	timeoutSeconds: number;
}

/** Validates wait options (also when they come from expressions). */
export function validateWaitOptions(node: INode, raw: IDataObject, itemIndex?: number): WaitOptions {
	const interval = Number(raw.pollInterval ?? 2);
	const timeout = Number(raw.timeout ?? 3600);
	if (!Number.isFinite(interval) || interval < MIN_POLL_INTERVAL_SECONDS) {
		throw new NodeOperationError(node, `Poll interval must be at least ${MIN_POLL_INTERVAL_SECONDS} s`, { itemIndex });
	}
	if (!Number.isFinite(timeout) || timeout <= 0 || timeout > MAX_WAIT_SECONDS) {
		throw new NodeOperationError(node, `Timeout must be between 1 and ${MAX_WAIT_SECONDS} s (24 h)`, { itemIndex });
	}
	return { intervalSeconds: interval, timeoutSeconds: timeout };
}

export function isTaskSuccessful(exitstatus: unknown): boolean {
	return typeof exitstatus === 'string' && (exitstatus === 'OK' || /^WARNINGS: \d+$/.test(exitstatus));
}

export async function getTaskStatus(client: ProxmoxClient, upid: string): Promise<IDataObject> {
	const { node } = parseUpid(upid);
	return await client.get<IDataObject>(apiPath`/nodes/${node}/tasks/${upid}/status`);
}

async function getTaskLogTail(client: ProxmoxClient, upid: string, lines = 20): Promise<string> {
	const { node } = parseUpid(upid);
	try {
		const log = await client.get<Array<{ n: number; t: string }>>(
			apiPath`/nodes/${node}/tasks/${upid}/log`,
			{ start: 0, limit: 5000 },
		);
		return (Array.isArray(log) ? log : [])
			.slice(-lines)
			.map((l) => l.t)
			.join('\n');
	} catch {
		return '';
	}
}

/**
 * Polls the task status until the task stops. Returns status and exitstatus.
 * Throws when the task fails or the timeout is reached.
 */
export async function waitForTask(
	client: ProxmoxClient,
	upid: string,
	options: WaitOptions,
): Promise<IDataObject> {
	const parsed = parseUpid(upid);
	const deadline = Date.now() + options.timeoutSeconds * 1000;
	let status: IDataObject = {};
	for (let i = 0; i < MAX_POLL_ITERATIONS; i++) {
		status = await getTaskStatus(client, upid);
		if (status.status === 'stopped') {
			const result: IDataObject = {
				upid,
				node: parsed.node,
				type: status.type ?? parsed.type,
				id: status.id ?? parsed.id,
				user: status.user ?? parsed.user,
				status: status.status,
				exitstatus: status.exitstatus,
				starttime: status.starttime,
				success: isTaskSuccessful(status.exitstatus),
			};
			if (!result.success) {
				const log = await getTaskLogTail(client, upid);
				throw client.error(
					`Proxmox VE task failed: ${String(status.exitstatus ?? 'unknown error')}`,
					`Task: ${upid}${log ? `\nLast log lines:\n${log}` : ''}`,
				);
			}
			return result;
		}
		const remaining = deadline - Date.now();
		if (remaining <= 0) break;
		await client.pause(Math.min(options.intervalSeconds * 1000, remaining));
	}
	throw client.error(
		`Timed out after ${options.timeoutSeconds} s waiting for the Proxmox VE task to finish`,
		`The task is still running and was not stopped. Task: ${upid}`,
	);
}
