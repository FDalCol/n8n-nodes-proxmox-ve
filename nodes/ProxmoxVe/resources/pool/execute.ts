import { data, list, type OperationContext, type ResourceHandlers } from '../../shared/engine';

function poolId(ctx: OperationContext, value?: unknown): string {
	const id = String(value ?? ctx.str('poolid')).trim();
	if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*(\/[A-Za-z0-9][A-Za-z0-9_.-]*){0,2}$/.test(id)) throw ctx.client.error('Invalid pool ID');
	return id;
}

export const poolHandlers: ResourceHandlers = {
	getMany: async (ctx) => {
		const f = ctx.collection('poolFilters');
		if (f.poolid) f.poolid = poolId(ctx, f.poolid);
		return list(await ctx.client.get('/pools', f));
	},
	create: async (ctx) => {
		const poolid = poolId(ctx);
		const comment = ctx.optStr('comment');
		await ctx.client.post('/pools', comment ? { poolid, comment } : { poolid });
		return data({ poolid, success: true });
	},
	update: async (ctx) => {
		const poolid = poolId(ctx);
		const fields = ctx.collection('poolFields');
		if (fields.vms && !/^\d+(,\d+)*$/.test(String(fields.vms).replace(/\s+/g, ''))) throw ctx.client.error('VMIDs must be a comma-separated list');
		await ctx.client.put('/pools', { poolid, ...fields });
		return data({ poolid, success: true });
	},
	delete: async (ctx) => {
		const poolid = poolId(ctx);
		await ctx.client.delete('/pools', { poolid });
		return data({ poolid, deleted: true });
	},
};
