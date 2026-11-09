import type { IDataObject } from 'n8n-workflow';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { MAX_STATE_ENTRIES } from '../nodes/ProxmoxVe/shared/security';
import { FakeProxmox } from './helpers/fakeProxmox';
import { poll, tokenCredentials } from './helpers/harness';

let server: FakeProxmox;
const state: {
	guests: IDataObject[];
	qmp: Record<number, string>;
	nodes: IDataObject[];
	tasks: IDataObject[];
	storages: IDataObject[];
	updates: Record<string, IDataObject[]>;
} = { guests: [], qmp: {}, nodes: [], tasks: [], storages: [], updates: {} };

beforeAll(async () => {
	server = await new FakeProxmox().start();
	server.on('GET', '/cluster/resources', (req) => ({ data: req.query.get('type') === 'storage' ? state.storages : state.guests }));
	server.on('GET', '/nodes/{node}/qemu', (_r, p) => ({
		data: state.guests.filter((g) => g.node === p.node && g.type === 'qemu').map((g) => ({ vmid: g.vmid, qmpstatus: state.qmp[Number(g.vmid)] ?? g.status })),
	}));
	server.on('GET', '/nodes', () => ({ data: state.nodes }));
	server.on('GET', '/cluster/tasks', () => ({ data: state.tasks }));
	server.on('GET', '/nodes/{node}/apt/update', (_r, p) => ({ data: state.updates[p.node] ?? [] }));
});
afterAll(async () => server.stop());

beforeEach(() => {
	state.guests = [
		{ type: 'qemu', vmid: 100, name: 'web', node: 'pve1', status: 'running' },
		{ type: 'lxc', vmid: 200, name: 'dns', node: 'pve1', status: 'running' },
	];
	state.qmp = {};
	state.nodes = [{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'online' }];
	state.tasks = [{ upid: 'UPID:pve1:00000001:00000001:65000000:vzdump::root@pam:', type: 'vzdump', node: 'pve1', status: 'OK', starttime: 1, endtime: 2 }];
	state.storages = [{ storage: 'local', node: 'pve1', disk: 50, maxdisk: 100, shared: 0 }];
	state.updates = { pve1: [{ Package: 'pve-manager', Version: '9.2.9', OldVersion: '9.2.8' }], pve2: [] };
});

const creds = () => tokenCredentials(server);

describe('trigger', () => {
	it('Guest State Changed: first run stores state silently, then emits filtered changes', async () => {
		const staticData: IDataObject = {};
		const params = { event: 'guestStateChanged', guestFilters: { states: ['stopped', 'paused'] } };
		expect(await poll({ credentials: creds(), params, staticData })).toBeNull();
		state.guests[0].status = 'stopped';
		state.qmp = {};
		const out = await poll({ credentials: creds(), params, staticData });
		expect(out).toEqual([expect.objectContaining({ vmid: 100, previousStatus: 'running', status: 'stopped', type: 'qemu' })]);
		// paused VM is reported as running by /cluster/resources: detected via qmpstatus
		state.guests[0].status = 'running';
		state.qmp[100] = 'paused';
		const paused = await poll({ credentials: creds(), params, staticData });
		expect(paused).toEqual([expect.objectContaining({ vmid: 100, previousStatus: 'stopped', status: 'paused' })]);
		// no change -> nothing
		expect(await poll({ credentials: creds(), params, staticData })).toBeNull();
		// filtered by VMID and type
		state.guests[1].status = 'stopped';
		expect(await poll({ credentials: creds(), params: { ...params, guestFilters: { vmids: '100' } }, staticData })).toBeNull();
	});

	it('Node Status Changed', async () => {
		const staticData: IDataObject = {};
		const params = { event: 'nodeStatusChanged', nodeFilters: { states: ['offline'] } };
		expect(await poll({ credentials: creds(), params, staticData })).toBeNull();
		state.nodes[1].status = 'offline';
		expect(await poll({ credentials: creds(), params, staticData })).toEqual([expect.objectContaining({ node: 'pve2', previousStatus: 'online', status: 'offline' })]);
		state.nodes[1].status = 'online';
		expect(await poll({ credentials: creds(), params, staticData })).toBeNull();
	});

	it('Task Finished: catches failed backups, deduplicates', async () => {
		const staticData: IDataObject = {};
		const params = { event: 'taskFinished', taskFilters: { types: 'vzdump', result: 'error' } };
		expect(await poll({ credentials: creds(), params, staticData })).toBeNull();
		const now = Math.floor(Date.now() / 1000) + 10;
		state.tasks.push(
			{ upid: 'UPID:pve1:00000002:00000002:65000001:vzdump::root@pam:', type: 'vzdump', node: 'pve1', status: 'job errors', starttime: now, endtime: now + 5 },
			{ upid: 'UPID:pve1:00000003:00000003:65000002:vzdump::root@pam:', type: 'vzdump', node: 'pve1', status: 'OK', starttime: now, endtime: now + 6 },
			{ upid: 'UPID:pve1:00000004:00000004:65000003:qmstart:100:root@pam:', type: 'qmstart', node: 'pve1', status: 'start failed', starttime: now, endtime: now + 7 },
			{ upid: 'UPID:pve1:00000005:00000005:65000004:vzdump::root@pam:', type: 'vzdump', node: 'pve1', starttime: now },
		);
		const out = await poll({ credentials: creds(), params, staticData });
		expect(out).toEqual([expect.objectContaining({ type: 'vzdump', status: 'job errors', success: false })]);
		expect(await poll({ credentials: creds(), params, staticData })).toBeNull();
		expect((staticData.seenTasks as string[]).length).toBeLessThanOrEqual(MAX_STATE_ENTRIES);
	});

	it('Storage Usage Above Threshold fires once until it drops below', async () => {
		const staticData: IDataObject = {};
		const params = { event: 'storageUsageAboveThreshold', threshold: 80 };
		expect(await poll({ credentials: creds(), params, staticData })).toBeNull();
		state.storages[0].disk = 90;
		expect(await poll({ credentials: creds(), params, staticData })).toEqual([expect.objectContaining({ storage: 'local', usagePercent: 90 })]);
		expect(await poll({ credentials: creds(), params, staticData })).toBeNull();
		state.storages[0].disk = 10;
		expect(await poll({ credentials: creds(), params, staticData })).toBeNull();
		state.storages[0].disk = 95;
		expect(await poll({ credentials: creds(), params, staticData })).toHaveLength(1);
	});

	it('Updates Available emits only new packages', async () => {
		const staticData: IDataObject = {};
		const params = { event: 'updatesAvailable' };
		expect(await poll({ credentials: creds(), params, staticData })).toBeNull();
		expect(await poll({ credentials: creds(), params, staticData })).toBeNull();
		state.updates.pve2 = [{ Package: 'proxmox-kernel', Version: '7.0.1', OldVersion: '7.0.0' }];
		const out = await poll({ credentials: creds(), params, staticData });
		expect(out).toEqual([expect.objectContaining({ node: 'pve2', newCount: 1 })]);
		expect((out?.[0].newPackages as IDataObject[])[0]).toMatchObject({ package: 'proxmox-kernel', version: '7.0.1' });
	});

	it('test mode returns a real sample without touching the stored state', async () => {
		const staticData: IDataObject = {};
		const samples = await Promise.all(
			['guestStateChanged', 'nodeStatusChanged', 'taskFinished', 'storageUsageAboveThreshold', 'updatesAvailable'].map((event) =>
				poll({ credentials: creds(), params: { event }, staticData: {}, mode: 'manual' }),
			),
		);
		expect(samples.map((s) => s?.[0]?.event)).toEqual(['guestStateChanged', 'nodeStatusChanged', 'taskFinished', 'storageUsageAboveThreshold', 'updatesAvailable']);
		expect(samples[0]?.[0]).toMatchObject({ vmid: 100, name: 'web' });
		await poll({ credentials: creds(), params: { event: 'nodeStatusChanged' }, staticData, mode: 'manual' });
		expect(staticData.initialized).toBeUndefined();
	});

	it('resets the state when the event changes', async () => {
		const staticData: IDataObject = {};
		await poll({ credentials: creds(), params: { event: 'nodeStatusChanged' }, staticData });
		expect(staticData.nodes).toBeDefined();
		await poll({ credentials: creds(), params: { event: 'storageUsageAboveThreshold', threshold: 10 }, staticData });
		expect(staticData.nodes).toBeUndefined();
		expect(staticData.event).toBe('storageUsageAboveThreshold');
	});
});
