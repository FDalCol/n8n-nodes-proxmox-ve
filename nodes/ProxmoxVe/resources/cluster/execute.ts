import type { IDataObject } from 'n8n-workflow';

import { data, list, type ResourceHandlers } from '../../shared/engine';

export const clusterHandlers: ResourceHandlers = {
	getStatus: async (ctx) => list(await ctx.client.get('/cluster/status')),
	getResources: async (ctx) => {
		const type = ctx.str('resourceType');
		const qs: IDataObject = {};
		if (['vm', 'storage', 'node', 'sdn'].includes(type)) qs.type = type;
		return list(await ctx.client.get('/cluster/resources', qs));
	},
	getLog: async (ctx) => list(await ctx.client.get('/cluster/log', { max: Math.max(1, Math.floor(ctx.num('max', 50))) })),
	getOptions: async (ctx) => data(await ctx.client.get('/cluster/options')),
	getVersion: async (ctx) => data(await ctx.client.get('/version')),
};
