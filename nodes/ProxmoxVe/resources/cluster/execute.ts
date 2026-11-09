import type { IDataObject } from 'n8n-workflow';

import { data, list, type ResourceHandlers } from '../../shared/engine';
import { MAX_LIST_ENTRIES } from '../../shared/security';

export const clusterHandlers: ResourceHandlers = {
	getStatus: async (ctx) => list(await ctx.client.get('/cluster/status')),
	getResources: async (ctx) => {
		const type = ctx.str('resourceType');
		const qs: IDataObject = {};
		if (['vm', 'storage', 'node', 'sdn'].includes(type)) qs.type = type;
		return list(await ctx.client.get('/cluster/resources', qs));
	},
	getLog: async (ctx) => {
		const qs: IDataObject = { max: ctx.param('max', 50) };
		ctx.limitOption(qs, 'max', 1, MAX_LIST_ENTRIES);
		return list(await ctx.client.get('/cluster/log', qs));
	},
	getOptions: async (ctx) => data(await ctx.client.get('/cluster/options')),
	getVersion: async (ctx) => data(await ctx.client.get('/version')),
};
