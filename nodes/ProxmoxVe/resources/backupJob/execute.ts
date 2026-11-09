import type { IDataObject } from 'n8n-workflow';

import { data, list, type OperationContext, type ResourceHandlers } from '../../shared/engine';
import { apiPath, validateNodeName } from '../../shared/security';

const JOB_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;

/** Parameters of POST /nodes/{node}/vzdump that a backup job definition may carry. */
const VZDUMP_PARAMS = new Set([
	'all', 'bwlimit', 'compress', 'dumpdir', 'exclude', 'exclude-path', 'fleecing', 'ionice', 'lockwait',
	'mailnotification', 'mailto', 'mode', 'notes-template', 'notification-mode', 'pbs-change-detection-mode',
	'performance', 'pigz', 'pool', 'protected', 'prune-backups', 'quiet', 'remove', 'script', 'stdexcludes',
	'stop', 'stopwait', 'storage', 'tmpdir', 'vmid', 'zstd',
]);

function jobId(ctx: OperationContext): string {
	const id = ctx.str('jobId');
	if (!JOB_ID.test(id)) throw ctx.client.error('Invalid backup job ID');
	return id;
}

/** Converts a property object returned by the API back to a property string (k=v,k=v). */
function toPropertyString(value: unknown): IDataObject[string] {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return Object.entries(value as IDataObject)
			.map(([k, v]) => `${k}=${String(v)}`)
			.join(',');
	}
	return value as IDataObject[string];
}

export const backupJobHandlers: ResourceHandlers = {
	getMany: async (ctx) => list(await ctx.client.get('/cluster/backup')),
	get: async (ctx) => data(await ctx.client.get(apiPath`/cluster/backup/${jobId(ctx)}`)),
	runNow: async (ctx) => {
		const id = jobId(ctx);
		const job = (await ctx.client.get<IDataObject>(apiPath`/cluster/backup/${id}`)) ?? {};
		// Same as "Run now" in the GUI: the job parameters without the scheduling fields
		const params: IDataObject = {};
		for (const [k, v] of Object.entries(job)) {
			if (!VZDUMP_PARAMS.has(k) || v === null || v === undefined) continue;
			params[k] = toPropertyString(v);
		}
		const nodes = ((await ctx.client.get<IDataObject[]>('/nodes')) ?? [])
			.filter((n) => n.status === 'online')
			.map((n) => String(n.node));
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
};
