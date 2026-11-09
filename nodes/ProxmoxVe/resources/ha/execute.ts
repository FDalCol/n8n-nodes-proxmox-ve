import type { IDataObject } from 'n8n-workflow';

import { data, list, type OperationContext, type ResourceHandlers } from '../../shared/engine';
import { apiPath } from '../../shared/security';

const CONFIG_ID = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;

function sid(ctx: OperationContext): string {
	const s = ctx.str('sid');
	if (!/^(?:(?:vm|ct):)?\d{3,9}$/.test(s)) throw ctx.client.error('Invalid HA resource ID, use vm:<vmid> or ct:<vmid>');
	return s;
}

function configId(ctx: OperationContext, name: string, label: string): string {
	const v = ctx.str(name);
	if (!CONFIG_ID.test(v)) throw ctx.client.error(`Invalid ${label}`);
	return v;
}

function ruleBody(ctx: OperationContext): IDataObject {
	const type = ctx.str('ruleType');
	if (!['node-affinity', 'resource-affinity'].includes(type)) throw ctx.client.error('Invalid rule type');
	const fields = ctx.collection('ruleFields');
	if (type === 'resource-affinity') {
		delete fields.nodes;
		delete fields.strict;
	}
	return { type, ...fields };
}

export const haHandlers: ResourceHandlers = {
	getResources: async (ctx) => {
		const type = ctx.str('filterType');
		return list(await ctx.client.get('/cluster/ha/resources', type === 'vm' || type === 'ct' ? { type } : {}));
	},
	getResource: async (ctx) => data(await ctx.client.get(apiPath`/cluster/ha/resources/${sid(ctx)}`)),
	addResource: async (ctx) => {
		const id = sid(ctx);
		await ctx.client.post('/cluster/ha/resources', { sid: id, ...ctx.collection('resourceFields') });
		return data({ sid: id, success: true });
	},
	updateResource: async (ctx) => {
		const id = sid(ctx);
		const fields = ctx.collection('resourceFields');
		if (!Object.keys(fields).length) throw ctx.client.error('Nothing to update');
		await ctx.client.put(apiPath`/cluster/ha/resources/${id}`, fields);
		return data({ sid: id, success: true });
	},
	removeResource: async (ctx) => {
		const id = sid(ctx);
		const qs: IDataObject = {};
		// purge exists only in Proxmox VE 9.x; only send it when disabled explicitly or on 9.x defaults
		if (ctx.param('purge', true) === false) qs.purge = false;
		await ctx.client.delete(apiPath`/cluster/ha/resources/${id}`, qs);
		return data({ sid: id, removed: true });
	},
	getRules: async (ctx) => list(await ctx.client.get('/cluster/ha/rules')),
	getRule: async (ctx) => data(await ctx.client.get(apiPath`/cluster/ha/rules/${configId(ctx, 'rule', 'rule ID')}`)),
	createRule: async (ctx) => {
		const rule = configId(ctx, 'rule', 'rule ID');
		const body = ruleBody(ctx);
		if (!body.resources) throw ctx.client.error('Resources are required for an HA rule');
		if (body.type === 'node-affinity' && !body.nodes) throw ctx.client.error('Nodes are required for a node affinity rule');
		await ctx.client.post('/cluster/ha/rules', { rule, ...body });
		return data({ rule, success: true });
	},
	updateRule: async (ctx) => {
		const rule = configId(ctx, 'rule', 'rule ID');
		await ctx.client.put(apiPath`/cluster/ha/rules/${rule}`, ruleBody(ctx));
		return data({ rule, success: true });
	},
	deleteRule: async (ctx) => {
		const rule = configId(ctx, 'rule', 'rule ID');
		await ctx.client.delete(apiPath`/cluster/ha/rules/${rule}`);
		return data({ rule, deleted: true });
	},
	getGroups: async (ctx) => list(await ctx.client.get('/cluster/ha/groups')),
	getGroup: async (ctx) => data(await ctx.client.get(apiPath`/cluster/ha/groups/${configId(ctx, 'group', 'group name')}`)),
	createGroup: async (ctx) => {
		const group = configId(ctx, 'group', 'group name');
		const fields = ctx.collection('groupFields');
		if (!fields.nodes) throw ctx.client.error('Nodes are required for an HA group');
		await ctx.client.post('/cluster/ha/groups', { group, ...fields });
		return data({ group, success: true });
	},
	updateGroup: async (ctx) => {
		const group = configId(ctx, 'group', 'group name');
		await ctx.client.put(apiPath`/cluster/ha/groups/${group}`, ctx.collection('groupFields'));
		return data({ group, success: true });
	},
	deleteGroup: async (ctx) => {
		const group = configId(ctx, 'group', 'group name');
		await ctx.client.delete(apiPath`/cluster/ha/groups/${group}`);
		return data({ group, deleted: true });
	},
	getStatus: async (ctx) => list(await ctx.client.get('/cluster/ha/status/current')),
	getManagerStatus: async (ctx) => data(await ctx.client.get('/cluster/ha/status/manager_status')),
};
