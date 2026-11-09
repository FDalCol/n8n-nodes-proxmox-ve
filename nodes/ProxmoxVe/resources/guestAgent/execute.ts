import { sleep, type IDataObject } from 'n8n-workflow';

import { data, list, type OperationContext, type ResourceHandlers } from '../../shared/engine';
import { apiPath, hasControlChars, MAX_POLL_ITERATIONS } from '../../shared/security';
import { validateWaitOptions } from '../../shared/tasks';

const FILE_WRITE_MAX = 61440;

function agentPath(ctx: OperationContext, command: string): string {
	return `${apiPath`/nodes/${ctx.node()}/qemu/${ctx.vmid()}`}/agent/${command}`;
}

function unwrap(value: unknown): unknown {
	if (value && typeof value === 'object' && 'result' in (value as IDataObject)) {
		return (value as IDataObject).result;
	}
	return value;
}

function filePath(ctx: OperationContext): string {
	const file = ctx.str('file');
	if (file === '' || hasControlChars(file)) throw ctx.client.error('File path is required');
	return file;
}

async function waitForExec(ctx: OperationContext, statusPath: string, pid: number): Promise<IDataObject> {
	const options = validateWaitOptions(ctx.client.node, ctx.param<IDataObject>('execWaitOptions', {}) ?? {}, ctx.itemIndex);
	const deadline = Date.now() + options.timeoutSeconds * 1000;
	for (let i = 0; i < MAX_POLL_ITERATIONS; i++) {
		const status = (await ctx.client.get<IDataObject>(statusPath, { pid })) ?? {};
		if (status.exited === true || status.exited === 1) return { pid, ...status, exited: true };
		const remaining = deadline - Date.now();
		if (remaining <= 0) break;
		await sleep(Math.min(options.intervalSeconds * 1000, remaining));
	}
	throw ctx.client.error(
		`Timed out after ${options.timeoutSeconds} s waiting for the guest command to exit`,
		`The command is still running in the guest (PID ${pid}). Use "Get Exec Status" to check it later.`,
	);
}

export const guestAgentHandlers: ResourceHandlers = {
	ping: async (ctx) => {
		await ctx.client.post(agentPath(ctx, 'ping'));
		return data({ success: true });
	},
	getInfo: async (ctx) => data(unwrap(await ctx.client.get(agentPath(ctx, 'info')))),
	getOsInfo: async (ctx) => data(unwrap(await ctx.client.get(agentPath(ctx, 'get-osinfo')))),
	getNetworkInterfaces: async (ctx) => list(unwrap(await ctx.client.get(agentPath(ctx, 'network-get-interfaces')))),
	getFilesystems: async (ctx) => list(unwrap(await ctx.client.get(agentPath(ctx, 'get-fsinfo')))),
	exec: async (ctx) => {
		const command = ctx.str('command');
		if (command === '') throw ctx.client.error('Command is required');
		const args = (ctx.param<unknown[]>('arguments', []) ?? []).map((a) => String(a));
		const body: IDataObject = { command: [command, ...args] };
		const input = ctx.param<string>('inputData', '');
		if (input) body['input-data'] = input;
		const started = await ctx.client.post<IDataObject>(agentPath(ctx, 'exec'), body);
		const pid = Number(started?.pid);
		if (!Number.isInteger(pid)) throw ctx.client.error('The guest agent did not return a process ID');
		if (!ctx.bool('waitForResult', true)) return data({ pid });
		return data(await waitForExec(ctx, agentPath(ctx, 'exec-status'), pid));
	},
	getExecStatus: async (ctx) => {
		const pid = ctx.num('pid');
		return data({ pid, ...((await ctx.client.get<IDataObject>(agentPath(ctx, 'exec-status'), { pid })) ?? {}) });
	},
	fileRead: async (ctx) => {
		const file = filePath(ctx);
		const qs: IDataObject = { file };
		const o = ctx.collection('readOptions');
		if (Number(o.count) > 0) qs.count = o.count;
		if (Number(o.offset) > 0) qs.offset = o.offset;
		const res = (await ctx.client.get<IDataObject>(agentPath(ctx, 'file-read'), qs)) ?? {};
		return data({ file, ...res });
	},
	fileWrite: async (ctx) => {
		const file = filePath(ctx);
		let content: string;
		let encode: boolean;
		if (ctx.str('contentSource') === 'binary') {
			const prop = ctx.str('binaryPropertyName');
			ctx.ef.helpers.assertBinaryData(ctx.itemIndex, prop);
			const buffer = await ctx.ef.helpers.getBinaryDataBuffer(ctx.itemIndex, prop);
			content = buffer.toString('base64');
			encode = false; // already base64
		} else {
			content = ctx.param<string>('content', '');
			encode = true;
		}
		if (content.length > FILE_WRITE_MAX) {
			throw ctx.client.error(`Content too large for the guest agent (max ${FILE_WRITE_MAX} characters after encoding)`);
		}
		await ctx.client.post(agentPath(ctx, 'file-write'), { file, content, encode });
		return data({ file, bytes: encode ? Buffer.byteLength(content) : Buffer.from(content, 'base64').length, success: true });
	},
	fsFreeze: async (ctx) => data({ frozen: unwrap(await ctx.client.post(agentPath(ctx, 'fsfreeze-freeze'))) }),
	fsThaw: async (ctx) => data({ thawed: unwrap(await ctx.client.post(agentPath(ctx, 'fsfreeze-thaw'))) }),
	fsFreezeStatus: async (ctx) => data({ status: unwrap(await ctx.client.post(agentPath(ctx, 'fsfreeze-status'))) }),
	shutdown: async (ctx) => {
		await ctx.client.post(agentPath(ctx, 'shutdown'));
		return data({ success: true });
	},
};
