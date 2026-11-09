import type { IDataObject } from 'n8n-workflow';

import { data, list, task, type OperationContext, type ResourceHandlers } from '../../shared/engine';
import { apiPath } from '../../shared/security';

const SERVICE = /^[A-Za-z0-9][A-Za-z0-9@._-]*$/;

function service(ctx: OperationContext): string {
	const s = ctx.str('service');
	if (!SERVICE.test(s)) throw ctx.client.error('Invalid service name');
	return s;
}

function guestOptions(ctx: OperationContext, allowed: string[]): IDataObject {
	const opts = ctx.collection('guestOptions');
	const out: IDataObject = {};
	for (const key of allowed) if (opts[key] !== undefined) out[key] = opts[key];
	if (out['max-workers'] === 0) delete out['max-workers'];
	return out;
}

export const nodeHandlers: ResourceHandlers = {
	getMany: async (ctx) => list(await ctx.client.get('/nodes')),
	getStatus: async (ctx) => data(await ctx.client.get(apiPath`/nodes/${ctx.node()}/status`)),
	shutdown: async (ctx) => {
		const node = ctx.node();
		await ctx.client.post(apiPath`/nodes/${node}/status`, { command: 'shutdown' });
		return data({ node, command: 'shutdown', success: true });
	},
	reboot: async (ctx) => {
		const node = ctx.node();
		await ctx.client.post(apiPath`/nodes/${node}/status`, { command: 'reboot' });
		return data({ node, command: 'reboot', success: true });
	},
	wakeOnLan: async (ctx) => {
		const node = ctx.node();
		const mac = await ctx.client.post(apiPath`/nodes/${node}/wakeonlan`);
		return data({ node, mac, success: true });
	},
	startAllGuests: async (ctx) =>
		task(await ctx.client.post(apiPath`/nodes/${ctx.node()}/startall`, guestOptions(ctx, ['force', 'vms', 'max-workers']))),
	stopAllGuests: async (ctx) =>
		task(await ctx.client.post(apiPath`/nodes/${ctx.node()}/stopall`, guestOptions(ctx, ['force-stop', 'timeout', 'vms', 'max-workers']))),
	suspendAllGuests: async (ctx) =>
		task(await ctx.client.post(apiPath`/nodes/${ctx.node()}/suspendall`, guestOptions(ctx, ['vms', 'max-workers']))),
	getServices: async (ctx) => list(await ctx.client.get(apiPath`/nodes/${ctx.node()}/services`)),
	getServiceState: async (ctx) =>
		data(await ctx.client.get(apiPath`/nodes/${ctx.node()}/services/${service(ctx)}/state`)),
	startService: async (ctx) => task(await ctx.client.post(apiPath`/nodes/${ctx.node()}/services/${service(ctx)}/start`)),
	stopService: async (ctx) => task(await ctx.client.post(apiPath`/nodes/${ctx.node()}/services/${service(ctx)}/stop`)),
	restartService: async (ctx) => task(await ctx.client.post(apiPath`/nodes/${ctx.node()}/services/${service(ctx)}/restart`)),
	reloadService: async (ctx) => task(await ctx.client.post(apiPath`/nodes/${ctx.node()}/services/${service(ctx)}/reload`)),
	refreshPackageIndex: async (ctx) =>
		task(await ctx.client.post(apiPath`/nodes/${ctx.node()}/apt/update`, ctx.collection('aptOptions'))),
	getUpdates: async (ctx) => list(await ctx.client.get(apiPath`/nodes/${ctx.node()}/apt/update`)),
	getPackageVersions: async (ctx) => list(await ctx.client.get(apiPath`/nodes/${ctx.node()}/apt/versions`)),
	getSyslog: async (ctx) => list(await ctx.client.get(apiPath`/nodes/${ctx.node()}/syslog`, ctx.collection('syslogOptions'))),
	getJournal: async (ctx) => {
		const opts = ctx.collection('journalOptions');
		if (opts.since === 0) delete opts.since;
		if (opts.until === 0) delete opts.until;
		return list(await ctx.client.get(apiPath`/nodes/${ctx.node()}/journal`, opts));
	},
	getNetworkInterfaces: async (ctx) => {
		const type = ctx.optStr('ifaceType');
		return list(await ctx.client.get(apiPath`/nodes/${ctx.node()}/network`, type ? { type } : {}));
	},
	getNetworkInterface: async (ctx) =>
		data(await ctx.client.get(apiPath`/nodes/${ctx.node()}/network/${ctx.str('iface')}`)),
	getDisks: async (ctx) => {
		const o = ctx.collection('diskOptions');
		delete o.healthonly;
		return list(await ctx.client.get(apiPath`/nodes/${ctx.node()}/disks/list`, o));
	},
	getDiskSmart: async (ctx) => {
		const o = ctx.collection('diskOptions');
		const qs: IDataObject = { disk: ctx.str('disk') };
		if (o.healthonly !== undefined) qs.healthonly = o.healthonly;
		return data(await ctx.client.get(apiPath`/nodes/${ctx.node()}/disks/smart`, qs));
	},
	getCertificates: async (ctx) => list(await ctx.client.get(apiPath`/nodes/${ctx.node()}/certificates/info`)),
	getRrdData: async (ctx) =>
		list(
			await ctx.client.get(apiPath`/nodes/${ctx.node()}/rrddata`, {
				timeframe: ctx.str('timeframe'),
				cf: ctx.str('cf'),
			}),
		),
};
