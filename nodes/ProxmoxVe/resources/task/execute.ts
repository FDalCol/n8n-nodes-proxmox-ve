import type { IDataObject } from 'n8n-workflow';

import { data, list, type OperationContext, type ResourceHandlers } from '../../shared/engine';
import { apiPath, MAX_LIST_ENTRIES, validateNodeName, validateVmid } from '../../shared/security';
import { getTaskStatus, isTaskSuccessful, parseUpid, validateWaitOptions, waitForTask } from '../../shared/tasks';

const MAX_TASKS = 1000;

function upid(ctx: OperationContext): { upid: string; node: string } {
	const value = ctx.str('upid');
	try {
		const parsed = parseUpid(value);
		return { upid: value, node: parsed.node };
	} catch {
		throw ctx.client.error('Invalid task ID (UPID)');
	}
}

function toEpoch(ctx: OperationContext, value: unknown, label: string): number | undefined {
	if (value === undefined || value === null || value === '') return undefined;
	const ms = typeof value === 'number' ? value * 1000 : Date.parse(String(value));
	if (!Number.isFinite(ms)) throw ctx.client.error(`Invalid date for "${label}"`);
	return Math.floor(ms / 1000);
}

function isRunning(t: IDataObject): boolean {
	return !t.endtime || t.status === 'running';
}

/** Recent tasks matching the filters, newest first. */
async function findTasks(ctx: OperationContext, limit: number): Promise<IDataObject[]> {
	const nodeValue = ctx.locator('filterNode');
	const node = nodeValue ? validateNodeName(nodeValue) : undefined;
	const f = ctx.collection('taskFilters');
	const type = typeof f.type === 'string' && f.type ? f.type : undefined;
	if (type && !/^[A-Za-z0-9_-]+$/.test(type)) throw ctx.client.error('Invalid task type');
	const vmid = Number(f.vmid) > 0 ? validateVmid(f.vmid) : undefined;
	const user = typeof f.user === 'string' && f.user ? f.user : undefined;
	const errorsOnly = f.errorsOnly === true;
	const runningOnly = f.runningOnly === true;
	const since = toEpoch(ctx, f.since, 'Since');
	const until = toEpoch(ctx, f.until, 'Until');

	let rows: IDataObject[];
	if (node) {
		// Per-node task index: filters are applied by Proxmox VE, also on archived tasks
		const qs: IDataObject = { source: runningOnly ? 'active' : 'all', limit: Math.min(limit, MAX_TASKS) };
		if (type) qs.typefilter = type;
		if (vmid) qs.vmid = vmid;
		if (user) qs.userfilter = user;
		if (errorsOnly) qs.errors = true;
		if (since !== undefined) qs.since = since;
		if (until !== undefined) qs.until = until;
		rows = (await ctx.client.get<IDataObject[]>(apiPath`/nodes/${node}/tasks`, qs)) ?? [];
	} else {
		// Cluster-wide list of recent tasks (no server-side filters)
		rows = (await ctx.client.get<IDataObject[]>('/cluster/tasks')) ?? [];
	}

	// The same filters are applied locally so both sources behave the same
	return (Array.isArray(rows) ? rows : [])
		.filter((t) => !node || t.node === node)
		.filter((t) => !type || t.type === type)
		.filter((t) => !vmid || String(t.id ?? '') === String(vmid))
		.filter((t) => !user || String(t.user ?? '').toLowerCase().includes(user.toLowerCase()))
		.filter((t) => !runningOnly || isRunning(t))
		.filter((t) => !errorsOnly || (!isRunning(t) && !isTaskSuccessful(t.status)))
		.filter((t) => since === undefined || Number(t.starttime) >= since)
		.filter((t) => until === undefined || Number(t.starttime) <= until)
		.sort((a, b) => Number(b.starttime) - Number(a.starttime))
		.slice(0, limit)
		.map((t) => ({ ...t, running: isRunning(t), success: isRunning(t) ? null : isTaskSuccessful(t.status) }));
}

export const taskHandlers: ResourceHandlers = {
	getMany: async (ctx) => {
		const limit = Math.floor(ctx.num('limit', 50));
		if (limit < 1 || limit > MAX_TASKS) throw ctx.client.error(`Limit must be between 1 and ${MAX_TASKS}`);
		return list(await findTasks(ctx, limit));
	},
	getLast: async (ctx) => {
		const [last] = await findTasks(ctx, 1);
		return data(last ?? { found: false });
	},
	getStatus: async (ctx) => {
		const t = upid(ctx);
		return data(await getTaskStatus(ctx.client, t.upid));
	},
	getLog: async (ctx) => {
		const t = upid(ctx);
		const o = ctx.collection('logOptions');
		ctx.limitOption(o, 'limit', 1, MAX_LIST_ENTRIES);
		ctx.limitOption(o, 'start', 0, Number.MAX_SAFE_INTEGER);
		return list(await ctx.client.get(apiPath`/nodes/${t.node}/tasks/${t.upid}/log`, o));
	},
	stop: async (ctx) => {
		const t = upid(ctx);
		await ctx.client.delete(apiPath`/nodes/${t.node}/tasks/${t.upid}`);
		return data({ upid: t.upid, stopped: true });
	},
	waitForCompletion: async (ctx) => {
		const t = upid(ctx);
		const options = validateWaitOptions(ctx.client.node, ctx.param<IDataObject>('taskWaitOptions', {}) ?? {}, ctx.itemIndex);
		return data(await waitForTask(ctx.client, t.upid, options));
	},
};
