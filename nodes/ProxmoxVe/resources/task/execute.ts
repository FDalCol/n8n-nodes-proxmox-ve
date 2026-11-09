import type { IDataObject } from 'n8n-workflow';

import { data, list, type OperationContext, type ResourceHandlers } from '../../shared/engine';
import { apiPath } from '../../shared/security';
import { getTaskStatus, parseUpid, validateWaitOptions, waitForTask } from '../../shared/tasks';

function upid(ctx: OperationContext): { upid: string; node: string } {
	const value = ctx.str('upid');
	try {
		const parsed = parseUpid(value);
		return { upid: value, node: parsed.node };
	} catch {
		throw ctx.client.error('Invalid task ID (UPID)');
	}
}

export const taskHandlers: ResourceHandlers = {
	getStatus: async (ctx) => {
		const t = upid(ctx);
		return data(await getTaskStatus(ctx.client, t.upid));
	},
	getLog: async (ctx) => {
		const t = upid(ctx);
		const o = ctx.collection('logOptions');
		return list(await ctx.client.get(apiPath`/nodes/${t.node}/tasks/${t.upid}/log`, o));
	},
	stop: async (ctx) => {
		const t = upid(ctx);
		await ctx.client.delete(apiPath`/nodes/${t.node}/tasks/${t.upid}`);
		return data({ upid: t.upid, stopped: true });
	},
	waitForCompletion: async (ctx) => {
		const t = upid(ctx);
		const options = validateWaitOptions(ctx.client.node, ctx.param<IDataObject>('taskWaitOptions', {}) ?? {}, ctx.itemIndex);
		return data(await waitForTask(ctx.client, t.upid, options));
	},
};
