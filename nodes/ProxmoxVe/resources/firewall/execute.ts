import type { IDataObject } from 'n8n-workflow';

import { data, list, type OperationContext, type ResourceHandlers } from '../../shared/engine';
import { apiPath, validateVmid } from '../../shared/security';

const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const CIDR = /^[0-9A-Fa-f.:]+(\/\d{1,3})?$|^[A-Za-z][A-Za-z0-9_/-]*$/;

type Scope = 'cluster' | 'node' | 'vm' | 'container';

function scope(ctx: OperationContext): Scope {
	const s = ctx.str('scope');
	if (!['cluster', 'node', 'vm', 'container'].includes(s)) throw ctx.client.error('Invalid firewall level');
	return s as Scope;
}

function base(ctx: OperationContext): string {
	const s = scope(ctx);
	if (s === 'cluster') return '/cluster/firewall';
	const node = ctx.node();
	if (s === 'node') return apiPath`/nodes/${node}/firewall`;
	if (s === 'vm') return apiPath`/nodes/${node}/qemu/${ctx.vmid('vmid')}/firewall`;
	return apiPath`/nodes/${node}/lxc/${validateVmid(ctx.locator('ctid'))}/firewall`;
}

function requireAliasSupport(ctx: OperationContext): void {
	if (scope(ctx) === 'node') {
		throw ctx.client.error('Aliases and IP sets are not available at node level', 'The Proxmox VE API supports them for cluster, VM and container only.');
	}
}

function name(ctx: OperationContext, param: string, label: string): string {
	const v = ctx.str(param);
	if (!NAME.test(v)) throw ctx.client.error(`Invalid ${label}`);
	return v;
}

function cidr(ctx: OperationContext): string {
	const v = ctx.str('cidr');
	if (!CIDR.test(v)) throw ctx.client.error('Invalid CIDR');
	return v;
}

function pos(ctx: OperationContext): number {
	const p = ctx.num('pos');
	if (!Number.isInteger(p) || p < 0) throw ctx.client.error('Invalid rule position');
	return p;
}

function ruleFields(ctx: OperationContext, isCreate: boolean): IDataObject {
	const f = ctx.collection('ruleFields');
	if (typeof f.enable === 'boolean') f.enable = f.enable ? 1 : 0;
	if (isCreate) {
		delete f.moveto;
		delete f.delete;
		delete f.type;
		delete f.action;
	} else {
		delete f.pos;
	}
	return f;
}

function extra(ctx: OperationContext, keys: string[]): IDataObject {
	const f = ctx.collection('extraFields');
	const out: IDataObject = {};
	for (const k of keys) if (f[k] !== undefined) out[k] = f[k];
	return out;
}

const OPTIONS_ENDPOINT: Record<Scope, string> = {
	cluster: 'PUT /cluster/firewall/options',
	node: 'PUT /nodes/{node}/firewall/options',
	vm: 'PUT /nodes/{node}/qemu/{vmid}/firewall/options',
	container: 'PUT /nodes/{node}/lxc/{vmid}/firewall/options',
};

export const firewallHandlers: ResourceHandlers = {
	getRules: async (ctx) => list(await ctx.client.get(`${base(ctx)}/rules`)),
	getRule: async (ctx) => data(await ctx.client.get(`${base(ctx)}${apiPath`/rules/${pos(ctx)}`}`)),
	createRule: async (ctx) => {
		const type = ctx.str('ruleType');
		const action = ctx.str('action');
		if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(action)) throw ctx.client.error('Invalid action');
		await ctx.client.post(`${base(ctx)}/rules`, { type, action, ...ruleFields(ctx, true) });
		return data({ success: true, type, action });
	},
	updateRule: async (ctx) => {
		const p = pos(ctx);
		const fields = ruleFields(ctx, false);
		if (!Object.keys(fields).length) throw ctx.client.error('Nothing to update');
		await ctx.client.put(`${base(ctx)}${apiPath`/rules/${p}`}`, fields);
		return data({ pos: p, success: true });
	},
	deleteRule: async (ctx) => {
		const p = pos(ctx);
		await ctx.client.delete(`${base(ctx)}${apiPath`/rules/${p}`}`);
		return data({ pos: p, deleted: true });
	},
	getAliases: async (ctx) => {
		requireAliasSupport(ctx);
		return list(await ctx.client.get(`${base(ctx)}/aliases`));
	},
	getAlias: async (ctx) => {
		requireAliasSupport(ctx);
		return data(await ctx.client.get(`${base(ctx)}${apiPath`/aliases/${name(ctx, 'aliasName', 'alias name')}`}`));
	},
	createAlias: async (ctx) => {
		requireAliasSupport(ctx);
		const n = name(ctx, 'aliasName', 'alias name');
		await ctx.client.post(`${base(ctx)}/aliases`, { name: n, cidr: cidr(ctx), ...extra(ctx, ['comment']) });
		return data({ name: n, success: true });
	},
	updateAlias: async (ctx) => {
		requireAliasSupport(ctx);
		const n = name(ctx, 'aliasName', 'alias name');
		await ctx.client.put(`${base(ctx)}${apiPath`/aliases/${n}`}`, { cidr: cidr(ctx), ...extra(ctx, ['comment', 'rename']) });
		return data({ name: n, success: true });
	},
	deleteAlias: async (ctx) => {
		requireAliasSupport(ctx);
		const n = name(ctx, 'aliasName', 'alias name');
		await ctx.client.delete(`${base(ctx)}${apiPath`/aliases/${n}`}`);
		return data({ name: n, deleted: true });
	},
	getIpsets: async (ctx) => {
		requireAliasSupport(ctx);
		return list(await ctx.client.get(`${base(ctx)}/ipset`));
	},
	getIpsetEntries: async (ctx) => {
		requireAliasSupport(ctx);
		return list(await ctx.client.get(`${base(ctx)}${apiPath`/ipset/${name(ctx, 'ipsetName', 'IP set name')}`}`));
	},
	createIpset: async (ctx) => {
		requireAliasSupport(ctx);
		const n = name(ctx, 'ipsetName', 'IP set name');
		await ctx.client.post(`${base(ctx)}/ipset`, { name: n, ...extra(ctx, ['comment']) });
		return data({ name: n, success: true });
	},
	deleteIpset: async (ctx) => {
		requireAliasSupport(ctx);
		const n = name(ctx, 'ipsetName', 'IP set name');
		await ctx.client.delete(`${base(ctx)}${apiPath`/ipset/${n}`}`, extra(ctx, ['force']));
		return data({ name: n, deleted: true });
	},
	addIpsetEntry: async (ctx) => {
		requireAliasSupport(ctx);
		const n = name(ctx, 'ipsetName', 'IP set name');
		const c = cidr(ctx);
		await ctx.client.post(`${base(ctx)}${apiPath`/ipset/${n}`}`, { cidr: c, ...extra(ctx, ['comment', 'nomatch']) });
		return data({ name: n, cidr: c, success: true });
	},
	updateIpsetEntry: async (ctx) => {
		requireAliasSupport(ctx);
		const n = name(ctx, 'ipsetName', 'IP set name');
		const c = cidr(ctx);
		await ctx.client.put(`${base(ctx)}${apiPath`/ipset/${n}/${c}`}`, extra(ctx, ['comment', 'nomatch']));
		return data({ name: n, cidr: c, success: true });
	},
	removeIpsetEntry: async (ctx) => {
		requireAliasSupport(ctx);
		const n = name(ctx, 'ipsetName', 'IP set name');
		const c = cidr(ctx);
		await ctx.client.delete(`${base(ctx)}${apiPath`/ipset/${n}/${c}`}`);
		return data({ name: n, cidr: c, removed: true });
	},
	getOptions: async (ctx) => data(await ctx.client.get(`${base(ctx)}/options`)),
	updateOptions: async (ctx) => {
		const s = scope(ctx);
		const body = ctx.additional(OPTIONS_ENDPOINT[s], 'firewallOptions');
		if (!Object.keys(body).length) throw ctx.client.error('Nothing to update: add at least one option');
		await ctx.client.put(`${base(ctx)}/options`, body);
		return data({ success: true, ...body });
	},
};
