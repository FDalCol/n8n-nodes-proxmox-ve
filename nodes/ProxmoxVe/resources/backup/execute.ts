import type { IDataObject } from 'n8n-workflow';

import writeParams from '../../generated/writeParams.json';
import { data, list, task, type OperationContext, type ResourceHandlers } from '../../shared/engine';
import { apiPath, validateNodeName, validateVmid } from '../../shared/security';
import { volumeId } from '../storage/execute';

const VMID_LIST = /^\d+(\s*,\s*\d+)*$/;
const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

function vmidList(ctx: OperationContext, value: unknown, label: string): string {
	const s = String(value ?? '').trim();
	if (!VMID_LIST.test(s)) throw ctx.client.error(`${label} must be a comma-separated list of VMIDs`);
	return s.replace(/\s+/g, '');
}

function jobId(ctx: OperationContext): string {
	const id = ctx.str('jobId');
	if (!JOB_ID.test(id)) throw ctx.client.error('Invalid backup job ID');
	return id;
}

function cleanJobFields(ctx: OperationContext): IDataObject {
	const fields = ctx.collection('jobFields');
	if (fields.vmid) fields.vmid = vmidList(ctx, fields.vmid, 'VMIDs');
	if (fields.exclude) fields.exclude = vmidList(ctx, fields.exclude, 'Exclude VMIDs');
	if (fields.node) fields.node = validateNodeName(fields.node);
	return fields;
}

/** Converts a property object returned by the API back to a property string (k=v,k=v). */
function toPropertyString(value: unknown): unknown {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return Object.entries(value as IDataObject)
			.map(([k, v]) => `${k}=${String(v)}`)
			.join(',');
	}
	return value;
}

const VZDUMP_PARAMS = new Set(
	((writeParams as Record<string, Array<{ n: string }>>)['POST /nodes/{node}/vzdump'] ?? []).map((p) => p.n),
);
/** Job properties that only concern scheduling or are restricted (job-id is root@pam only). */
const NOT_FOR_VZDUMP = new Set(['id', 'schedule', 'enabled', 'type', 'node', 'comment', 'next-run', 'repeat-missed', 'starttime', 'dow', 'job-id']);

export const backupHandlers: ResourceHandlers = {
	create: async (ctx) => {
		const node = ctx.node();
		const opts = ctx.collection('backupOptions');
		if (opts.bwlimit === 0) delete opts.bwlimit;
		const body: IDataObject = { ...opts };
		const vmids = ctx.str('vmids');
		if (vmids) body.vmid = vmidList(ctx, vmids, 'VMIDs');
		if (opts.exclude) body.exclude = vmidList(ctx, opts.exclude, 'Exclude VMIDs');
		if (!body.vmid && body.all !== true && !body.pool) {
			throw ctx.client.error('Specify VMIDs, enable "All Guests" or set a pool');
		}
		Object.assign(body, ctx.additional('POST /nodes/{node}/vzdump', 'additionalParameters', Object.keys(body)));
		return task(await ctx.client.post(apiPath`/nodes/${node}/vzdump`, body), { node });
	},
	restore: async (ctx) => {
		const node = ctx.node();
		const kind = ctx.str('guestType') === 'lxc' ? 'lxc' : 'qemu';
		const vmid = validateVmid(ctx.param('targetVmid'));
		const archive = volumeId(ctx, 'archive');
		const opts = ctx.collection('restoreOptions');
		if (opts.bwlimit === 0) delete opts.bwlimit;
		const body: IDataObject = { vmid, force: ctx.bool('force', false) };
		for (const k of ['storage', 'pool', 'start', 'unique', 'bwlimit']) if (opts[k] !== undefined) body[k] = opts[k];
		if (kind === 'qemu') {
			body.archive = archive;
			if (opts['live-restore'] !== undefined) body['live-restore'] = opts['live-restore'];
		} else {
			body.ostemplate = archive;
			body.restore = true;
		}
		return task(await ctx.client.post(apiPath`/nodes/${node}/${kind}`, body), { vmid, node, archive });
	},
	getMany: async (ctx) => {
		const qs: IDataObject = { content: 'backup' };
		const vmid = Number(ctx.param('filterVmid', 0));
		if (vmid) qs.vmid = validateVmid(vmid);
		return list(await ctx.client.get(apiPath`/nodes/${ctx.node()}/storage/${ctx.storage()}/content`, qs));
	},
	delete: async (ctx) => {
		const volume = volumeId(ctx);
		return task(await ctx.client.delete(apiPath`/nodes/${ctx.node()}/storage/${ctx.storage()}/content/${volume}`), { volume });
	},
	prune: async (ctx) => {
		const params: IDataObject = {};
		const retention = ctx.str('pruneBackups');
		if (retention) {
			if (!/^[a-z-]+=\d+(,[a-z-]+=\d+)*$/.test(retention)) throw ctx.client.error('Invalid retention, e.g. keep-last=3,keep-daily=7');
			params['prune-backups'] = retention;
		}
		const type = ctx.str('pruneType');
		if (type === 'qemu' || type === 'lxc') params.type = type;
		const vmid = Number(ctx.param('filterVmid', 0));
		if (vmid) params.vmid = validateVmid(vmid);
		const path = apiPath`/nodes/${ctx.node()}/storage/${ctx.storage()}/prunebackups`;
		if (!ctx.bool('deleteBackups', false)) {
			return list(await ctx.client.get(path, params));
		}
		return task(await ctx.client.delete(path, params), { deleted: true });
	},
	getJobs: async (ctx) => list(await ctx.client.get('/cluster/backup')),
	getJob: async (ctx) => data(await ctx.client.get(apiPath`/cluster/backup/${jobId(ctx)}`)),
	createJob: async (ctx) => {
		const fields = cleanJobFields(ctx);
		Object.assign(fields, ctx.additional('POST /cluster/backup', 'jobAdditionalCreate', Object.keys(fields)));
		if (!fields.schedule) throw ctx.client.error('A schedule is required for a backup job');
		await ctx.client.post('/cluster/backup', fields);
		return data({ success: true, ...fields });
	},
	updateJob: async (ctx) => {
		const id = jobId(ctx);
		const fields = cleanJobFields(ctx);
		Object.assign(fields, ctx.additional('PUT /cluster/backup/{id}', 'jobAdditionalUpdate', Object.keys(fields)));
		if (Object.keys(fields).length === 0) throw ctx.client.error('Nothing to update');
		await ctx.client.put(apiPath`/cluster/backup/${id}`, fields);
		return data({ id, success: true });
	},
	deleteJob: async (ctx) => {
		const id = jobId(ctx);
		await ctx.client.delete(apiPath`/cluster/backup/${id}`);
		return data({ id, deleted: true });
	},
	runJob: async (ctx) => {
		const id = jobId(ctx);
		const job = (await ctx.client.get<IDataObject>(apiPath`/cluster/backup/${id}`)) ?? {};
		const params: IDataObject = {};
		for (const [k, v] of Object.entries(job)) {
			if (NOT_FOR_VZDUMP.has(k) || !VZDUMP_PARAMS.has(k) || v === null || v === undefined) continue;
			params[k] = toPropertyString(v) as IDataObject[string];
		}
		const nodes = ((await ctx.client.get<IDataObject[]>('/nodes')) ?? []).filter((n) => n.status === 'online').map((n) => String(n.node));
		let targets = nodes;
		if (typeof job.node === 'string' && job.node) {
			if (!nodes.includes(job.node)) throw ctx.client.error(`Node "${job.node}" of the backup job is not online`);
			targets = [job.node];
		}
		if (targets.length === 0) throw ctx.client.error('No online node found');
		const tasks: Array<{ upid: unknown; extra: IDataObject }> = [];
		for (const node of targets) {
			const upid = await ctx.client.post(apiPath`/nodes/${validateNodeName(node)}/vzdump`, params);
			tasks.push({ upid, extra: { jobId: id, node } });
		}
		return { kind: 'tasks', tasks };
	},
	getNotBackedUp: async (ctx) => list(await ctx.client.get('/cluster/backup-info/not-backed-up')),
};
