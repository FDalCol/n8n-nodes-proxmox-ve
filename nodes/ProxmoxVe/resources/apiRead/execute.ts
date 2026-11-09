import type { IDataObject } from 'n8n-workflow';

import { findEndpoint } from '../../shared/apiCatalog';
import { data, list, type OperationContext, type ResourceHandlers } from '../../shared/engine';
import { encodeSegment, validateApiPath } from '../../shared/security';

interface NameValue {
	name?: string;
	value?: unknown;
}

function entries(ctx: OperationContext, param: string): NameValue[] {
	const raw = ctx.param<{ parameter?: NameValue[] }>(param, {}) ?? {};
	return (raw.parameter ?? []).filter((e) => String(e.name ?? '').trim() !== '');
}

function convert(ctx: OperationContext, name: string, type: string, raw: unknown, allowed?: string[]): string | number | boolean {
	const value = typeof raw === 'string' ? raw.trim() : raw;
	if (allowed && !allowed.includes(String(value))) {
		throw ctx.client.error(`Invalid value for "${name}"`, `Allowed values: ${allowed.join(', ')}`);
	}
	if (type === 'integer') {
		const n = Number(value);
		if (!Number.isInteger(n)) throw ctx.client.error(`Parameter "${name}" must be an integer`);
		return n;
	}
	if (type === 'number') {
		const n = Number(value);
		if (!Number.isFinite(n)) throw ctx.client.error(`Parameter "${name}" must be a number`);
		return n;
	}
	if (type === 'boolean') {
		if (value === true || value === 'true' || value === '1' || value === 1) return true;
		if (value === false || value === 'false' || value === '0' || value === 0) return false;
		throw ctx.client.error(`Parameter "${name}" must be a boolean (true/false)`);
	}
	return String(value ?? '');
}

export const apiReadHandlers: ResourceHandlers = {
	get: async (ctx) => {
		const template = ctx.locator('endpoint');
		const endpoint = findEndpoint(template);
		if (!endpoint) {
			throw ctx.client.error(
				`Unknown endpoint "${template.slice(0, 120)}"`,
				'API Read only allows GET endpoints of the Proxmox VE API specification. Choose one from the list.',
			);
		}
		const pathParams = endpoint.params.filter((p) => p.in === 'path');
		const queryParams = endpoint.params.filter((p) => p.in !== 'path');

		const pathValues = new Map<string, string>();
		for (const e of entries(ctx, 'pathParameters')) {
			const name = String(e.name).trim();
			if (!pathParams.some((p) => p.n === name)) throw ctx.client.error(`"${name}" is not a path parameter of ${template}`);
			if (pathValues.has(name)) throw ctx.client.error(`Path parameter "${name}" is set more than once`);
			pathValues.set(name, String(e.value ?? ''));
		}
		let path = template;
		for (const p of pathParams) {
			const value = pathValues.get(p.n);
			if (value === undefined || value.trim() === '') throw ctx.client.error(`Missing path parameter "${p.n}"`);
			path = path.replace(`{${p.n}}`, ctx.guard(() => encodeSegment(value, p.n)));
		}
		path = ctx.guard(() => validateApiPath(path));

		const qs: IDataObject = {};
		for (const e of entries(ctx, 'queryParameters')) {
			const name = String(e.name).trim();
			const spec = queryParams.find((p) => p.n === name);
			if (!spec) throw ctx.client.error(`"${name}" is not a query parameter of ${template}`);
			if (name in qs) throw ctx.client.error(`Query parameter "${name}" is set more than once`);
			qs[name] = convert(ctx, name, spec.t, e.value, spec.e);
		}
		const missing = queryParams.filter((p) => p.r === 1 && !(p.n in qs)).map((p) => p.n);
		if (missing.length) throw ctx.client.error(`Missing required query parameter(s): ${missing.join(', ')}`);

		const result = await ctx.client.get(path, qs);
		return Array.isArray(result) ? list(result) : data(result);
	},
};
