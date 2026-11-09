import { jsonParse, type IDataObject } from 'n8n-workflow';

import { data, list, task, type ResourceHandlers } from '../../shared/engine';
import { isSafeKey, validateApiPath } from '../../shared/security';
import { isUpid, type ProxmoxMethod } from '../../shared/transport';

const PARAM_NAME = /^[A-Za-z0-9_.\-[\]]{1,128}$/;
const METHODS: ProxmoxMethod[] = ['GET', 'POST', 'PUT', 'DELETE'];
const TOKEN_PATH = /^\/access\/users\/[^/]+\/token(\/|$)/i;

function stripTokenValues(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stripTokenValues);
	if (value && typeof value === 'object') {
		const out: IDataObject = { ...(value as IDataObject) };
		for (const key of ['value', 'secret', 'token']) {
			if (out[key] !== undefined) out[key] = '[REDACTED]';
		}
		return out;
	}
	return value;
}

export const customApiCallHandlers: ResourceHandlers = {
	call: async (ctx) => {
		const method = ctx.str('method').toUpperCase() as ProxmoxMethod;
		if (!METHODS.includes(method)) throw ctx.client.error('Invalid method');
		const path = ctx.guard(() => validateApiPath(ctx.str('path')));

		const qs: IDataObject = {};
		const raw = ctx.param<{ parameter?: Array<{ name?: string; value?: unknown }> }>('queryParameters', {}) ?? {};
		for (const entry of raw.parameter ?? []) {
			const name = String(entry.name ?? '').trim();
			if (name === '') continue;
			if (!PARAM_NAME.test(name) || !isSafeKey(name)) throw ctx.client.error(`Invalid query parameter name "${name.slice(0, 64)}"`);
			qs[name] = entry.value === undefined || entry.value === null ? '' : String(entry.value);
		}

		let body: IDataObject | undefined;
		if (method === 'POST' || method === 'PUT') {
			const rawBody = ctx.param<unknown>('body', '{}');
			let parsed: unknown = rawBody;
			if (typeof rawBody === 'string') {
				try {
					parsed = rawBody.trim() === '' ? {} : jsonParse(rawBody);
				} catch {
					throw ctx.client.error('Body must be valid JSON');
				}
			}
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				throw ctx.client.error('Body must be a JSON object');
			}
			for (const key of Object.keys(parsed as IDataObject)) {
				if (!PARAM_NAME.test(key) || !isSafeKey(key)) throw ctx.client.error(`Invalid body parameter name "${key.slice(0, 64)}"`);
			}
			body = parsed as IDataObject;
		}

		let result = await ctx.client.request(method, path, { qs, body });
		if (isUpid(result)) return task(result);
		// API token secrets (returned when a token is created or regenerated) never reach the output
		if (TOKEN_PATH.test(path)) result = stripTokenValues(result);
		return Array.isArray(result) ? list(result) : data(result);
	},
};
