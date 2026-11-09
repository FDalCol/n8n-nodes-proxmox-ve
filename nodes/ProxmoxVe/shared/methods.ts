import type {
	IDataObject,
	ILoadOptionsFunctions,
	INodeListSearchItems,
	INodeListSearchResult,
	INodePropertyOptions,
} from 'n8n-workflow';

import { apiPath, validateNodeName } from './security';
import { ProxmoxClient } from './transport';

const MAX_RESULTS = 500;

function matches(filter: string | undefined, ...values: unknown[]): boolean {
	if (!filter) return true;
	const f = filter.toLowerCase();
	return values.some((v) => String(v ?? '').toLowerCase().includes(f));
}

function currentNode(ctx: ILoadOptionsFunctions): string | undefined {
	try {
		const v = ctx.getCurrentNodeParameter('node', { extractValue: true });
		return typeof v === 'string' && v.trim() ? validateNodeName(v) : undefined;
	} catch {
		return undefined;
	}
}

async function searchGuestsOfType(
	ctx: ILoadOptionsFunctions,
	type: 'qemu' | 'lxc' | 'any',
	filter?: string,
): Promise<INodeListSearchResult> {
	const client = await ProxmoxClient.create(ctx);
	const node = currentNode(ctx);
	const rows = (await client.get<IDataObject[]>('/cluster/resources', { type: 'vm' })) ?? [];
	const results: INodeListSearchItems[] = rows
		.filter((r) => (type === 'any' || r.type === type) && (!node || r.node === node))
		.filter((r) => matches(filter, r.vmid, r.name))
		.sort((a, b) => Number(a.vmid) - Number(b.vmid))
		.slice(0, MAX_RESULTS)
		.map((r) => ({
			name: `${String(r.vmid)} - ${String(r.name ?? '')} (${String(r.status ?? 'unknown')}, ${String(r.node ?? '')})`,
			value: String(r.vmid),
		}));
	return { results };
}

export const listSearch = {
	async searchNodes(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
		const client = await ProxmoxClient.create(this);
		const rows = (await client.get<IDataObject[]>('/nodes')) ?? [];
		return {
			results: rows
				.filter((r) => matches(filter, r.node))
				.sort((a, b) => String(a.node).localeCompare(String(b.node)))
				.slice(0, MAX_RESULTS)
				.map((r) => ({ name: `${String(r.node)} (${String(r.status ?? 'unknown')})`, value: String(r.node) })),
		};
	},
	async searchVms(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
		return await searchGuestsOfType(this, 'qemu', filter);
	},
	async searchContainers(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
		return await searchGuestsOfType(this, 'lxc', filter);
	},
	async searchGuests(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
		return await searchGuestsOfType(this, 'any', filter);
	},
	async searchStorages(this: ILoadOptionsFunctions, filter?: string): Promise<INodeListSearchResult> {
		const client = await ProxmoxClient.create(this);
		const node = currentNode(this);
		const rows = node
			? ((await client.get<IDataObject[]>(apiPath`/nodes/${node}/storage`)) ?? [])
			: ((await client.get<IDataObject[]>('/storage')) ?? []);
		return {
			results: rows
				.filter((r) => matches(filter, r.storage, r.type))
				.sort((a, b) => String(a.storage).localeCompare(String(b.storage)))
				.slice(0, MAX_RESULTS)
				.map((r) => ({ name: `${String(r.storage)} (${String(r.type ?? '')})`, value: String(r.storage) })),
		};
	},
};

export const loadOptions = {
	async getNodeServices(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const node = currentNode(this);
		if (!node) return [];
		const client = await ProxmoxClient.create(this);
		const rows = (await client.get<IDataObject[]>(apiPath`/nodes/${node}/services`)) ?? [];
		return rows
			.map((r) => ({ name: `${String(r.name ?? r.service)} (${String(r.state ?? '')})`, value: String(r.service ?? r.name) }))
			.sort((a, b) => a.name.localeCompare(b.name));
	},
	async getBackupJobs(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
		const client = await ProxmoxClient.create(this);
		const rows = (await client.get<IDataObject[]>('/cluster/backup')) ?? [];
		return rows.map((r) => ({
			name: `${String(r.id)}${r.comment ? ` - ${String(r.comment)}` : ''}${r.schedule ? ` (${String(r.schedule)})` : ''}`,
			value: String(r.id),
		}));
	},
};
