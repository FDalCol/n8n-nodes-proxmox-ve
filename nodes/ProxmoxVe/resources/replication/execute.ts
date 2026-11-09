import type { IDataObject } from 'n8n-workflow';

import { data, list, task, type OperationContext, type ResourceHandlers } from '../../shared/engine';
import { apiPath, validateNodeName } from '../../shared/security';

function jobId(ctx: OperationContext): string {
	const id = ctx.str('jobId');
	if (!/^\d{3,9}-\d{1,9}$/.test(id)) throw ctx.client.error('Invalid replication job ID, use VMID-number, e.g. 100-0');
	return id;
}

function fields(ctx: OperationContext): IDataObject {
	const f = ctx.collection('jobFields');
	if (f.rate === 0) delete f.rate;
	return f;
}

export const replicationHandlers: ResourceHandlers = {
	getMany: async (ctx) => list(await ctx.client.get('/cluster/replication')),
	get: async (ctx) => data(await ctx.client.get(apiPath`/cluster/replication/${jobId(ctx)}`)),
	create: async (ctx) => {
		const id = jobId(ctx);
		const target = validateNodeName(ctx.str('target'));
		await ctx.client.post('/cluster/replication', { id, type: 'local', target, ...fields(ctx) });
		return data({ id, target, success: true });
	},
	update: async (ctx) => {
		const id = jobId(ctx);
		const f = fields(ctx);
		if (!Object.keys(f).length) throw ctx.client.error('Nothing to update');
		await ctx.client.put(apiPath`/cluster/replication/${id}`, f);
		return data({ id, success: true });
	},
	delete: async (ctx) => {
		const id = jobId(ctx);
		await ctx.client.delete(apiPath`/cluster/replication/${id}`, ctx.collection('deleteOptions'));
		return data({ id, deleted: true });
	},
	runNow: async (ctx) => {
		const id = jobId(ctx);
		const job = (await ctx.client.get<IDataObject>(apiPath`/cluster/replication/${id}`)) ?? {};
		let node = typeof job.source === 'string' && job.source ? job.source : '';
		if (!node) {
			// The job runs on the node that currently hosts the guest
			const vmid = Number(job.guest ?? id.split('-')[0]);
			const resources = (await ctx.client.get<IDataObject[]>('/cluster/resources', { type: 'vm' })) ?? [];
			const guest = resources.find((r) => Number(r.vmid) === vmid);
			if (!guest || typeof guest.node !== 'string') throw ctx.client.error(`Guest ${vmid} of the replication job not found`);
			node = guest.node;
		}
		node = validateNodeName(node);
		return task(await ctx.client.post(apiPath`/nodes/${node}/replication/${id}/schedule_now`), { id, node });
	},
};
