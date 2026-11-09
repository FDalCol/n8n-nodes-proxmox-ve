import {
	NodeConnectionTypes,
	NodeOperationError,
	type IDataObject,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
	type IPollFunctions,
} from 'n8n-workflow';

import { apiPath, MAX_STATE_ENTRIES, redactString, validateNodeName } from '../ProxmoxVe/shared/security';
import { isTaskSuccessful } from '../ProxmoxVe/shared/tasks';
import { ProxmoxClient } from '../ProxmoxVe/shared/transport';

type EventName =
	| 'guestStateChanged'
	| 'nodeStatusChanged'
	| 'taskFinished'
	| 'storageUsageAboveThreshold'
	| 'updatesAvailable';

interface TriggerState {
	event?: EventName;
	initialized?: boolean;
	activatedAt?: number;
	guests?: Record<string, string>;
	nodes?: Record<string, string>;
	seenTasks?: string[];
	storagesAbove?: string[];
	packages?: Record<string, string[]>;
}

interface Snapshot {
	items: IDataObject[];
	sample: IDataObject | undefined;
}

const now = () => Math.floor(Date.now() / 1000);

function csvList(value: unknown): string[] {
	return String(value ?? '')
		.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
}

function limitRecord<T>(record: Record<string, T>): Record<string, T> {
	const keys = Object.keys(record);
	if (keys.length <= MAX_STATE_ENTRIES) return record;
	const out: Record<string, T> = {};
	for (const k of keys.slice(keys.length - MAX_STATE_ENTRIES)) out[k] = record[k];
	return out;
}

function effectiveGuestStatus(row: IDataObject, qmp: Map<string, string>): string {
	const status = String(row.status ?? 'unknown');
	const q = qmp.get(String(row.vmid));
	if (status === 'running' && (q === 'paused' || q === 'suspended')) return 'paused';
	return status;
}

export class ProxmoxVeTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Proxmox VE Trigger',
		name: 'proxmoxVeTrigger',
		icon: { light: 'file:../../icons/proxmoxVe.svg', dark: 'file:../../icons/proxmoxVe.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '={{$parameter["event"]}}',
		description: 'Starts the workflow when something changes in Proxmox VE (polling)',
		defaults: {
			name: 'Proxmox VE Trigger',
		},
		polling: true,
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'proxmoxVeApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				default: 'guestStateChanged',
				options: [
					{ name: 'Guest State Changed', value: 'guestStateChanged', description: 'A VM or container changes to running, stopped or paused' },
					{ name: 'Node Status Changed', value: 'nodeStatusChanged', description: 'A cluster node goes online or offline' },
					{ name: 'Storage Usage Above Threshold', value: 'storageUsageAboveThreshold', description: 'A storage exceeds a usage percentage (fires once until it drops below again)' },
					{ name: 'Task Finished', value: 'taskFinished', description: 'A task (e.g. vzdump backup) finishes, optionally only with errors' },
					{ name: 'Updates Available', value: 'updatesAvailable', description: 'New package updates are available on a node (requires Sys.Modify on the node)' },
				],
			},
			{
				displayName: 'Filters',
				name: 'guestFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { event: ['guestStateChanged'] } },
				options: [
					{ displayName: 'Guest Type', name: 'type', type: 'options', default: 'any', options: [
						{ name: 'Any', value: 'any' },
						{ name: 'VM (QEMU)', value: 'qemu' },
						{ name: 'Container (LXC)', value: 'lxc' },
					] },
					{ displayName: 'States', name: 'states', type: 'multiOptions', default: [], options: [
						{ name: 'Paused', value: 'paused' },
						{ name: 'Running', value: 'running' },
						{ name: 'Stopped', value: 'stopped' },
					], description: 'Only fire for these new states (empty = all)' },
					{ displayName: 'VMIDs', name: 'vmids', type: 'string', default: '', placeholder: '100,101' },
				],
			},
			{
				displayName: 'Filters',
				name: 'nodeFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { event: ['nodeStatusChanged'] } },
				options: [
					{ displayName: 'Nodes', name: 'nodes', type: 'string', default: '', placeholder: 'pve1,pve2' },
					{ displayName: 'States', name: 'states', type: 'multiOptions', default: [], options: [
						{ name: 'Online', value: 'online' },
						{ name: 'Offline', value: 'offline' },
					], description: 'Only fire for these new states (empty = all)' },
				],
			},
			{
				displayName: 'Filters',
				name: 'taskFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { event: ['taskFinished'] } },
				options: [
					{ displayName: 'Nodes', name: 'nodes', type: 'string', default: '', placeholder: 'pve1,pve2' },
					{ displayName: 'Result', name: 'result', type: 'options', default: 'any', options: [
						{ name: 'Any', value: 'any' },
						{ name: 'OK (Including Warnings)', value: 'ok' },
						{ name: 'Error', value: 'error' },
					] },
					{ displayName: 'Task Types', name: 'types', type: 'string', default: '', placeholder: 'vzdump,qmigrate', description: 'Comma-separated task types, e.g. vzdump for backups' },
				],
			},
			{
				displayName: 'Threshold (%)',
				name: 'threshold',
				type: 'number',
				default: 85,
				typeOptions: { minValue: 1, maxValue: 100 },
				displayOptions: { show: { event: ['storageUsageAboveThreshold'] } },
			},
			{
				displayName: 'Filters',
				name: 'storageFilters',
				type: 'collection',
				placeholder: 'Add Filter',
				default: {},
				displayOptions: { show: { event: ['storageUsageAboveThreshold'] } },
				options: [
					{ displayName: 'Nodes', name: 'nodes', type: 'string', default: '' },
					{ displayName: 'Storages', name: 'storages', type: 'string', default: '', placeholder: 'local,local-lvm' },
				],
			},
			{
				displayName: 'Nodes',
				name: 'updateNodes',
				type: 'string',
				default: '',
				placeholder: 'pve1,pve2',
				description: 'Nodes to check (empty = all online nodes)',
				displayOptions: { show: { event: ['updatesAvailable'] } },
			},
		],
	};

	async poll(this: IPollFunctions): Promise<INodeExecutionData[][] | null> {
		const event = this.getNodeParameter('event') as EventName;
		const manual = this.getMode() === 'manual';
		const state = this.getWorkflowStaticData('node') as TriggerState;
		if (state.event !== event) {
			for (const key of Object.keys(state)) delete (state as IDataObject)[key];
			state.event = event;
		}
		const firstRun = !state.initialized;
		let client: ProxmoxClient | undefined;
		let snapshot: Snapshot;
		try {
			client = await ProxmoxClient.create(this);
			switch (event) {
				case 'guestStateChanged':
					snapshot = await pollGuests.call(this, client, state, manual);
					break;
				case 'nodeStatusChanged':
					snapshot = await pollNodes.call(this, client, state, manual);
					break;
				case 'taskFinished':
					snapshot = await pollTasks.call(this, client, state, manual);
					break;
				case 'storageUsageAboveThreshold':
					snapshot = await pollStorage.call(this, client, state, manual);
					break;
				case 'updatesAvailable':
					snapshot = await pollUpdates.call(this, client, state, manual);
					break;
				default:
					throw new NodeOperationError(this.getNode(), `Unknown event "${String(event)}"`);
			}
		} catch (error) {
			const e = error as { message?: string; description?: string };
			const redact = (s: string) => (client ? client.redact(s) : redactString(s));
			throw new NodeOperationError(this.getNode(), redact(e?.message ?? 'Polling failed'), {
				description: e?.description ? redact(e.description) : undefined,
			});
		}

		if (manual) {
			// Test mode: return a real sample built from current data, do not change the stored state
			const items = snapshot.items.length ? snapshot.items : snapshot.sample ? [snapshot.sample] : [];
			if (!items.length) return null;
			return [items.map((json) => ({ json: client!.redactValue(json) }))];
		}
		if (firstRun) {
			state.initialized = true;
			state.activatedAt = now();
			return null;
		}
		if (!snapshot.items.length) return null;
		return [snapshot.items.map((json) => ({ json: client!.redactValue(json) }))];
	}
}

// -------------------------------------------------------------------------------------------------

async function pollGuests(this: IPollFunctions, client: ProxmoxClient, state: TriggerState, manual: boolean): Promise<Snapshot> {
	const f = this.getNodeParameter('guestFilters', {}) as IDataObject;
	const vmids = csvList(f.vmids);
	const type = String(f.type ?? 'any');
	const states = (f.states as string[] | undefined) ?? [];
	const rows = ((await client.get<IDataObject[]>('/cluster/resources', { type: 'vm' })) ?? []).filter(
		(r) => r.type === 'qemu' || r.type === 'lxc',
	);
	// Paused VMs are reported as "running" by /cluster/resources: read qmpstatus per node
	const qmp = new Map<string, string>();
	const nodesWithRunningVms = [...new Set(rows.filter((r) => r.type === 'qemu' && r.status === 'running').map((r) => String(r.node)))];
	for (const node of nodesWithRunningVms) {
		const list = (await client.get<IDataObject[]>(apiPath`/nodes/${validateNodeName(node)}/qemu`)) ?? [];
		for (const vm of list) if (vm.qmpstatus) qmp.set(String(vm.vmid), String(vm.qmpstatus));
	}
	const previous = state.guests ?? {};
	const current: Record<string, string> = {};
	const items: IDataObject[] = [];
	let sample: IDataObject | undefined;
	for (const r of rows) {
		const id = String(r.vmid);
		const status = effectiveGuestStatus(r, qmp);
		current[id] = status;
		if (vmids.length && !vmids.includes(id)) continue;
		if (type !== 'any' && r.type !== type) continue;
		const entry: IDataObject = {
			event: 'guestStateChanged',
			vmid: Number(r.vmid),
			name: r.name,
			type: r.type,
			node: r.node,
			previousStatus: previous[id] ?? null,
			status,
			timestamp: new Date().toISOString(),
		};
		if (!sample && (!states.length || states.includes(status))) sample = entry;
		if (previous[id] === undefined || previous[id] === status) continue;
		if (states.length && !states.includes(status)) continue;
		items.push(entry);
	}
	if (!manual) state.guests = limitRecord(current);
	return { items: manual ? [] : items, sample };
}

async function pollNodes(this: IPollFunctions, client: ProxmoxClient, state: TriggerState, manual: boolean): Promise<Snapshot> {
	const f = this.getNodeParameter('nodeFilters', {}) as IDataObject;
	const nodes = csvList(f.nodes);
	const states = (f.states as string[] | undefined) ?? [];
	const rows = (await client.get<IDataObject[]>('/nodes')) ?? [];
	const previous = state.nodes ?? {};
	const current: Record<string, string> = {};
	const items: IDataObject[] = [];
	let sample: IDataObject | undefined;
	for (const r of rows) {
		const name = String(r.node);
		const status = String(r.status ?? 'unknown');
		current[name] = status;
		if (nodes.length && !nodes.includes(name)) continue;
		const entry: IDataObject = {
			event: 'nodeStatusChanged',
			node: name,
			previousStatus: previous[name] ?? null,
			status,
			uptime: r.uptime,
			timestamp: new Date().toISOString(),
		};
		if (!sample) sample = entry;
		if (previous[name] === undefined || previous[name] === status) continue;
		if (states.length && !states.includes(status)) continue;
		items.push(entry);
	}
	if (!manual) state.nodes = limitRecord(current);
	return { items: manual ? [] : items, sample };
}

async function pollTasks(this: IPollFunctions, client: ProxmoxClient, state: TriggerState, manual: boolean): Promise<Snapshot> {
	const f = this.getNodeParameter('taskFilters', {}) as IDataObject;
	const types = csvList(f.types);
	const nodes = csvList(f.nodes);
	const result = String(f.result ?? 'any');
	const rows = ((await client.get<IDataObject[]>('/cluster/tasks')) ?? []).filter((t) => typeof t.upid === 'string' && t.endtime);
	rows.sort((a, b) => Number(a.endtime) - Number(b.endtime));
	const seen = new Set(state.seenTasks ?? []);
	const activatedAt = state.activatedAt ?? 0;
	const items: IDataObject[] = [];
	let sample: IDataObject | undefined;
	for (const t of rows) {
		const success = isTaskSuccessful(t.status);
		if (types.length && !types.includes(String(t.type))) continue;
		if (nodes.length && !nodes.includes(String(t.node))) continue;
		if (result === 'ok' && !success) continue;
		if (result === 'error' && success) continue;
		const entry: IDataObject = {
			event: 'taskFinished',
			upid: t.upid,
			type: t.type,
			id: t.id,
			node: t.node,
			user: t.user,
			status: t.status,
			success,
			starttime: t.starttime,
			endtime: t.endtime,
		};
		sample = entry; // most recent matching task
		if (seen.has(String(t.upid)) || Number(t.endtime) < activatedAt) continue;
		items.push(entry);
	}
	if (!manual) {
		for (const t of rows) seen.add(String(t.upid));
		state.seenTasks = [...seen].slice(-MAX_STATE_ENTRIES);
	}
	return { items: manual ? [] : items, sample };
}

async function pollStorage(this: IPollFunctions, client: ProxmoxClient, state: TriggerState, manual: boolean): Promise<Snapshot> {
	const threshold = Number(this.getNodeParameter('threshold', 85));
	if (!Number.isFinite(threshold) || threshold <= 0 || threshold > 100) {
		throw new NodeOperationError(this.getNode(), 'Threshold must be between 1 and 100');
	}
	const f = this.getNodeParameter('storageFilters', {}) as IDataObject;
	const nodes = csvList(f.nodes);
	const storages = csvList(f.storages);
	const rows = (await client.get<IDataObject[]>('/cluster/resources', { type: 'storage' })) ?? [];
	const above = new Set(state.storagesAbove ?? []);
	const nowAbove = new Set<string>();
	const items: IDataObject[] = [];
	let sample: IDataObject | undefined;
	let maxUsage = -1;
	for (const r of rows) {
		const total = Number(r.maxdisk);
		const used = Number(r.disk);
		if (!total || !Number.isFinite(used)) continue;
		if (nodes.length && !nodes.includes(String(r.node))) continue;
		if (storages.length && !storages.includes(String(r.storage))) continue;
		const key = r.shared ? `shared/${String(r.storage)}` : `${String(r.node)}/${String(r.storage)}`;
		const usage = Math.round((used / total) * 10000) / 100;
		const entry: IDataObject = {
			event: 'storageUsageAboveThreshold',
			storage: r.storage,
			node: r.node,
			shared: Boolean(r.shared),
			usagePercent: usage,
			threshold,
			used,
			total,
			timestamp: new Date().toISOString(),
		};
		if (usage > maxUsage) {
			maxUsage = usage;
			sample = entry;
		}
		if (usage < threshold) continue;
		if (nowAbove.has(key)) continue; // shared storage reported by several nodes
		nowAbove.add(key);
		if (!above.has(key)) items.push(entry);
	}
	if (!manual) state.storagesAbove = [...nowAbove].slice(-MAX_STATE_ENTRIES);
	return { items: manual ? [] : items, sample };
}

async function pollUpdates(this: IPollFunctions, client: ProxmoxClient, state: TriggerState, manual: boolean): Promise<Snapshot> {
	let nodes = csvList(this.getNodeParameter('updateNodes', '')).map((n) => validateNodeName(n));
	if (!nodes.length) {
		const rows = (await client.get<IDataObject[]>('/nodes')) ?? [];
		nodes = rows.filter((r) => r.status === 'online').map((r) => validateNodeName(r.node));
	}
	const previous = state.packages ?? {};
	const current: Record<string, string[]> = {};
	const items: IDataObject[] = [];
	let sample: IDataObject | undefined;
	for (const node of nodes) {
		const updates = (await client.get<IDataObject[]>(apiPath`/nodes/${node}/apt/update`)) ?? [];
		const keys = updates.map((u) => `${String(u.Package)}@${String(u.Version)}`);
		current[node] = keys.slice(0, MAX_STATE_ENTRIES);
		const known = new Set(previous[node] ?? []);
		const fresh = updates.filter((u) => !known.has(`${String(u.Package)}@${String(u.Version)}`));
		const packages = (list: IDataObject[]) =>
			list.map((u) => ({ package: u.Package, oldVersion: u.OldVersion, version: u.Version, priority: u.Priority, origin: u.Origin }));
		const entry: IDataObject = {
			event: 'updatesAvailable',
			node,
			newPackages: packages(fresh),
			newCount: fresh.length,
			totalUpdates: updates.length,
			timestamp: new Date().toISOString(),
		};
		if (!sample && updates.length) sample = { ...entry, newPackages: packages(updates), newCount: updates.length };
		if (previous[node] !== undefined && fresh.length) items.push(entry);
		if (previous[node] === undefined && state.initialized && fresh.length) items.push(entry);
	}
	if (!manual) state.packages = limitRecord(current);
	return { items: manual ? [] : items, sample };
}
