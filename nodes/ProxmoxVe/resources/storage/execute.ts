import type { IDataObject } from 'n8n-workflow';

import { data, list, task, type OperationContext, type ResourceHandlers } from '../../shared/engine';
import { apiPath, UPLOAD_TIMEOUT_MS, validateVmid } from '../../shared/security';

const CONTENT_TYPES = ['iso', 'vztmpl', 'import'];

export function validateFileName(ctx: OperationContext, name: string): string {
	const n = name.trim();
	if (!/^[A-Za-z0-9][A-Za-z0-9._+-]{0,250}$/.test(n) || n.includes('..')) {
		throw ctx.client.error(`Invalid file name "${n.slice(0, 64)}"`, 'Use letters, digits, ".", "_", "+" and "-" only.');
	}
	return n;
}

function contentType(ctx: OperationContext): string {
	const c = ctx.str('uploadContent');
	if (!CONTENT_TYPES.includes(c)) throw ctx.client.error('Invalid content type');
	return c;
}

function checksumOptions(opts: IDataObject): IDataObject {
	const out: IDataObject = {};
	if (typeof opts.checksum === 'string' && opts.checksum) {
		if (!/^[A-Fa-f0-9]{32,128}$/.test(opts.checksum)) throw new Error('Checksum must be a hex string');
		out.checksum = opts.checksum.toLowerCase();
		out['checksum-algorithm'] = opts['checksum-algorithm'] ?? 'sha256';
	}
	return out;
}

export function volumeId(ctx: OperationContext, name = 'volume'): string {
	const v = ctx.str(name);
	if (!/^[A-Za-z0-9][A-Za-z0-9._-]*:[^\s]+$/.test(v) || v.split('/').includes('..')) {
		throw ctx.client.error(`Invalid volume ID "${v.slice(0, 64)}"`, 'Expected format storage:content/name, e.g. local:iso/debian.iso');
	}
	return v;
}

export const storageHandlers: ResourceHandlers = {
	getMany: async (ctx) => {
		const f = ctx.collection('storageFilters');
		const qs: IDataObject = {};
		if (f.content) qs.content = f.content;
		if (f.enabled === true) qs.enabled = true;
		return list(await ctx.client.get(apiPath`/nodes/${ctx.node()}/storage`, qs));
	},
	getStatus: async (ctx) => data(await ctx.client.get(apiPath`/nodes/${ctx.node()}/storage/${ctx.storage()}/status`)),
	getContent: async (ctx) => {
		const f = ctx.collection('contentFilters');
		const qs: IDataObject = {};
		if (f.content) qs.content = f.content;
		if (Number(f.vmid) > 0) qs.vmid = validateVmid(f.vmid);
		return list(await ctx.client.get(apiPath`/nodes/${ctx.node()}/storage/${ctx.storage()}/content`, qs));
	},
	upload: async (ctx) => {
		const node = ctx.node();
		const storage = ctx.storage();
		const content = contentType(ctx);
		const prop = ctx.str('binaryPropertyName');
		const binary = ctx.ef.helpers.assertBinaryData(ctx.itemIndex, prop);
		const opts = ctx.collection('transferOptions');
		const filename = validateFileName(ctx, String(opts.filename || binary.fileName || ''));
		let checksum: IDataObject;
		try {
			checksum = checksumOptions(opts);
		} catch (error) {
			throw ctx.client.error((error as Error).message);
		}
		const buffer = await ctx.ef.helpers.getBinaryDataBuffer(ctx.itemIndex, prop);
		const form = new FormData();
		form.append('content', content);
		for (const [k, v] of Object.entries(checksum)) form.append(k, String(v));
		form.append('filename', new Blob([new Uint8Array(buffer)], { type: 'application/octet-stream' }), filename);
		const upid = await ctx.client.request('POST', apiPath`/nodes/${node}/storage/${storage}/upload`, {
			formData: form,
			timeoutMs: UPLOAD_TIMEOUT_MS,
		});
		return task(upid, { storage, filename, content, size: buffer.length });
	},
	downloadFromUrl: async (ctx) => {
		const node = ctx.node();
		const storage = ctx.storage();
		const url = ctx.str('url');
		let parsed: URL;
		try {
			parsed = new URL(url);
		} catch {
			throw ctx.client.error('Invalid URL');
		}
		if (!['http:', 'https:'].includes(parsed.protocol)) throw ctx.client.error('URL must use http:// or https://');
		const opts = ctx.collection('transferOptions');
		let checksum: IDataObject;
		try {
			checksum = checksumOptions(opts);
		} catch (error) {
			throw ctx.client.error((error as Error).message);
		}
		const body: IDataObject = {
			url,
			content: contentType(ctx),
			filename: validateFileName(ctx, ctx.str('filename')),
			...checksum,
		};
		if (opts.compression) body.compression = opts.compression;
		if (opts['verify-certificates'] !== undefined) body['verify-certificates'] = opts['verify-certificates'];
		return task(await ctx.client.post(apiPath`/nodes/${node}/storage/${storage}/download-url`, body), {
			storage,
			filename: body.filename as string,
		});
	},
	allocateVolume: async (ctx) => {
		const size = ctx.str('allocSize');
		if (!/^\d+(\.\d+)?[KMGT]?$/.test(size)) throw ctx.client.error('Invalid size, use e.g. 4G');
		const volid = await ctx.client.post(apiPath`/nodes/${ctx.node()}/storage/${ctx.storage()}/content`, {
			vmid: validateVmid(ctx.param('allocVmid')),
			filename: validateFileName(ctx, ctx.str('allocFilename')),
			size,
			format: ctx.str('allocFormat'),
		});
		return data({ volid });
	},
	deleteVolume: async (ctx) => {
		const volume = volumeId(ctx);
		return task(await ctx.client.delete(apiPath`/nodes/${ctx.node()}/storage/${ctx.storage()}/content/${volume}`), { volume });
	},
	getRrdData: async (ctx) =>
		list(
			await ctx.client.get(apiPath`/nodes/${ctx.node()}/storage/${ctx.storage()}/rrddata`, {
				timeframe: ctx.str('timeframe'),
				cf: ctx.str('cf'),
			}),
		),
};
