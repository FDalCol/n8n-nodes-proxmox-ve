import type { IDataObject } from 'n8n-workflow';

import { list, task, type OperationContext, type ResourceHandlers } from '../../shared/engine';
import { apiPath, validateVmid } from '../../shared/security';
import { volumeId } from '../storage/execute';

const VMID_LIST = /^\d+(\s*,\s*\d+)*$/;

export function vmidList(ctx: OperationContext, value: unknown, label: string): string {
	const s = String(value ?? '').trim();
	if (!VMID_LIST.test(s)) throw ctx.client.error(`${label} must be a comma-separated list of VMIDs`);
	return s.replace(/\s+/g, '');
}

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
		Object.assign(body, ctx.additional('additionalParameters', Object.keys(body)));
		return task(await ctx.client.post(apiPath`/nodes/${node}/vzdump`, body), { node });
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
	getNotBackedUp: async (ctx) => list(await ctx.client.get('/cluster/backup-info/not-backed-up')),
};
