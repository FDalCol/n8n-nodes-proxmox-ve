import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { FakeProxmox, makeUpid } from './helpers/fakeProxmox';
import { runNode, runNodeJson, sentRequests, tokenCredentials, type Params } from './helpers/harness';

let server: FakeProxmox;
const creds = () => tokenCredentials(server);
const run = (params: Params | Params[], extra: Partial<Parameters<typeof runNode>[0]> = {}) =>
	runNodeJson({ credentials: creds(), params, ...extra });

beforeAll(async () => {
	server = await new FakeProxmox().start();
	// ---- generic data
	server.on('GET', '/nodes', () => ({ data: [{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'online' }] }));
	server.on('GET', '/cluster/resources', (req) => {
		const all = [
			{ type: 'qemu', vmid: 100, name: 'web', node: 'pve1', status: 'running' },
			{ type: 'lxc', vmid: 200, name: 'dns', node: 'pve2', status: 'stopped' },
			{ type: 'storage', storage: 'local', node: 'pve1', disk: 10, maxdisk: 100 },
		];
		const type = req.query.get('type');
		return { data: type === 'vm' ? all.filter((r) => r.type !== 'storage') : type ? all.filter((r) => r.type === type) : all };
	});
	server.on('GET', '/cluster/nextid', (req) => ({ data: req.query.get('vmid') ?? '105' }));
	server.on('GET', '/version', () => ({ data: { version: '9.2.9', release: '9.2' } }));
});

afterAll(async () => server.stop());
afterEach(() => {
	server.requests.length = 0;
	sentRequests.length = 0;
});

describe('Node', () => {
	it('lists services, refreshes packages and reads RRD data', async () => {
		server.on('GET', '/nodes/{node}/services', () => ({ data: [{ service: 'pveproxy', state: 'running' }] }));
		server.on('GET', '/nodes/{node}/rrddata', () => ({ data: [{ time: 1, cpu: 0.1 }, { time: 2, cpu: 0.2 }] }));
		const upid = makeUpid('pve1', 'aptupdate');
		server.on('POST', '/nodes/{node}/apt/update', () => ({ data: upid }));
		const out = await run([
			{ resource: 'node', operation: 'getServices', node: 'pve1' },
			{ resource: 'node', operation: 'refreshPackageIndex', node: 'pve1' },
			{ resource: 'node', operation: 'getRrdData', node: 'pve1', timeframe: 'hour', cf: 'AVERAGE', splitIntoItems: false },
		]);
		expect(out[0].service).toBe('pveproxy');
		expect(out[1]).toMatchObject({ upid, node: 'pve1', type: 'aptupdate' });
		expect(out[2].data).toHaveLength(2);
		expect(server.requestsTo('GET', '/nodes/pve1/rrddata')[0].query.get('timeframe')).toBe('hour');
	});

	it('stops all guests with options', async () => {
		server.on('POST', '/nodes/{node}/stopall', () => ({ data: makeUpid('pve1', 'stopall') }));
		await run({ resource: 'node', operation: 'stopAllGuests', node: 'pve1', guestOptions: { vms: '100,101', 'force-stop': true, timeout: 60 } });
		const req = server.requestsTo('POST', '/nodes/pve1/stopall')[0];
		expect(req.form.get('vms')).toBe('100,101');
		expect(req.form.get('force-stop')).toBe('1');
	});
});

describe('VM', () => {
	it('Get returns configuration and status together', async () => {
		server.on('GET', '/nodes/{node}/qemu/{vmid}/config', () => ({ data: { name: 'web', memory: 2048 } }));
		server.on('GET', '/nodes/{node}/qemu/{vmid}/status/current', () => ({ data: { status: 'running', uptime: 42 } }));
		const [out] = await run({ resource: 'vm', operation: 'get', node: { __rl: true, mode: 'list', value: 'pve1' }, vmid: { __rl: true, mode: 'id', value: '100' } });
		expect(out).toEqual({ vmid: 100, node: 'pve1', type: 'qemu', config: { name: 'web', memory: 2048 }, status: { status: 'running', uptime: 42 } });
	});

	it('creates a VM with validated additional parameters', async () => {
		server.on('POST', '/nodes/{node}/qemu', () => ({ data: makeUpid('pve1', 'qmcreate', '150') }));
		await run({
			resource: 'vm',
			operation: 'create',
			node: 'pve1',
			newVmid: 150,
			createFields: { name: 'new', memory: 1024 },
			additionalParameters: { parameter: [{ name: 'net1', value: 'virtio,bridge=vmbr1' }, { name: 'agent', value: '1' }] },
		});
		const req = server.requestsTo('POST', '/nodes/pve1/qemu')[0];
		expect(req.form.get('vmid')).toBe('150');
		expect(req.form.get('net1')).toBe('virtio,bridge=vmbr1');
		await expect(
			runNode({ credentials: creds(), params: { resource: 'vm', operation: 'create', node: 'pve1', newVmid: 151, additionalParameters: { parameter: [{ name: 'bad name&x=1', value: 'x' }] } } }),
		).rejects.toThrow(/Invalid parameter name/);
	});

	it('hibernates with todisk and handles snapshots and cloud-init', async () => {
		server.on('POST', '/nodes/{node}/qemu/{vmid}/status/suspend', () => ({ data: makeUpid('pve1', 'qmsuspend', '100') }));
		server.on('POST', '/nodes/{node}/qemu/{vmid}/snapshot/{snap}/rollback', () => ({ data: makeUpid('pve1', 'qmrollback', '100') }));
		server.on('POST', '/nodes/{node}/qemu/{vmid}/config', () => ({ data: makeUpid('pve1', 'qmconfig', '100') }));
		server.on('PUT', '/nodes/{node}/qemu/{vmid}/cloudinit', () => ({ data: null }));
		await run([
			{ resource: 'vm', operation: 'hibernate', node: 'pve1', vmid: '100' },
			{ resource: 'vm', operation: 'rollbackSnapshot', node: 'pve1', vmid: '100', snapname: 'before_upgrade' },
			{ resource: 'vm', operation: 'updateCloudInit', node: 'pve1', vmid: '100', cloudInitFields: { ciuser: 'admin', sshkeys: 'ssh-ed25519 AAAA test@host' } },
			{ resource: 'vm', operation: 'regenerateCloudInit', node: 'pve1', vmid: '100' },
		]);
		expect(server.requestsTo('POST', '/nodes/pve1/qemu/100/status/suspend')[0].form.get('todisk')).toBe('1');
		expect(server.requestsTo('POST', '/nodes/pve1/qemu/100/snapshot/before_upgrade/rollback')).toHaveLength(1);
		const ci = server.requestsTo('POST', '/nodes/pve1/qemu/100/config')[0];
		expect(ci.form.get('sshkeys')).toBe(encodeURIComponent('ssh-ed25519 AAAA test@host'));
		expect(server.requestsTo('PUT', '/nodes/pve1/qemu/100/cloudinit')).toHaveLength(1);
	});

	it('returns the next free VMID', async () => {
		expect(await run({ resource: 'vm', operation: 'getNextFreeVmid' })).toEqual([{ vmid: 105, free: true }]);
	});

	it('rejects invalid VMIDs and node names before sending anything', async () => {
		await expect(runNode({ credentials: creds(), params: { resource: 'vm', operation: 'start', node: 'pve1', vmid: '../1' } })).rejects.toThrow(/VMID/);
		await expect(runNode({ credentials: creds(), params: { resource: 'vm', operation: 'start', node: '../etc', vmid: '100' } })).rejects.toThrow(/node name/);
		expect(server.requests).toHaveLength(0);
	});
});

describe('Wait For Completion', () => {
	it('returns status and exitstatus when the task succeeds', async () => {
		const upid = server.addTask('pve1', 'qmstart', '100', 'OK', 1);
		server.on('POST', '/nodes/{node}/qemu/{vmid}/status/start', () => ({ data: upid }));
		const [out] = await run({ resource: 'vm', operation: 'start', node: 'pve1', vmid: '100', waitForCompletion: true, waitOptions: { pollInterval: 1, timeout: 30 } });
		expect(out).toMatchObject({ upid, status: 'stopped', exitstatus: 'OK', success: true });
	});

	it('fails with the task log when the task fails', async () => {
		const upid = server.addTask('pve1', 'qmstop', '100', 'command failed: timeout', 0, ['stopping', 'error: timeout']);
		server.on('POST', '/nodes/{node}/qemu/{vmid}/status/stop', () => ({ data: upid }));
		const err = await runNode({
			credentials: creds(),
			params: { resource: 'vm', operation: 'stop', node: 'pve1', vmid: '100', waitForCompletion: true, waitOptions: { pollInterval: 1, timeout: 30 } },
		}).catch((e: Error & { description?: string }) => e);
		expect((err as Error).message).toMatch(/task failed: command failed: timeout/);
		expect((err as { description?: string }).description).toMatch(/error: timeout/);
	});

	it('times out when the task keeps running', async () => {
		const upid = server.addTask('pve1', 'qmshutdown', '100', 'OK', 1000);
		server.on('POST', '/nodes/{node}/qemu/{vmid}/status/shutdown', () => ({ data: upid }));
		await expect(
			runNode({ credentials: creds(), params: { resource: 'vm', operation: 'shutdown', node: 'pve1', vmid: '100', waitForCompletion: true, waitOptions: { pollInterval: 1, timeout: 1 } } }),
		).rejects.toThrow(/Timed out after 1 s/);
	});

	it('stops waiting when the execution is cancelled', async () => {
		const upid = server.addTask('pve1', 'qmmigrate', '100', 'OK', 1000);
		server.on('POST', '/nodes/{node}/qemu/{vmid}/migrate', () => ({ data: upid }));
		const controller = new AbortController();
		const started = Date.now();
		setTimeout(() => controller.abort(), 300);
		await expect(
			runNode({
				credentials: creds(),
				cancelSignal: controller.signal,
				params: { resource: 'vm', operation: 'migrate', node: 'pve1', vmid: '100', targetNode: 'pve2', waitForCompletion: true, waitOptions: { pollInterval: 1, timeout: 600 } },
			}),
		).rejects.toThrow(/cancelled/);
		expect(Date.now() - started).toBeLessThan(5000);
	});

	it('enforces minimum interval and 24 h maximum also from expressions', async () => {
		const upid = server.addTask('pve1', 'qmreboot', '100');
		server.on('POST', '/nodes/{node}/qemu/{vmid}/status/reboot', () => ({ data: upid }));
		await expect(
			runNode({ credentials: creds(), params: { resource: 'vm', operation: 'reboot', node: 'pve1', vmid: '100', waitForCompletion: true, waitOptions: { pollInterval: 0.5 } } }),
		).rejects.toThrow(/at least 1 s/);
		await expect(
			runNode({ credentials: creds(), params: { resource: 'vm', operation: 'reboot', node: 'pve1', vmid: '100', waitForCompletion: true, waitOptions: { timeout: 86401 } } }),
		).rejects.toThrow(/24 h/);
	});

	it('Task resource: status, log, stop and wait', async () => {
		const upid = server.addTask('pve2', 'vzdump', '', 'OK', 0);
		server.on('DELETE', '/nodes/{node}/tasks/{upid}', () => ({ data: null }));
		const out = await run([
			{ resource: 'task', operation: 'getStatus', upid },
			{ resource: 'task', operation: 'getLog', upid },
			{ resource: 'task', operation: 'stop', upid },
			{ resource: 'task', operation: 'waitForCompletion', upid, taskWaitOptions: { pollInterval: 1, timeout: 10 } },
		]);
		expect(out[0].status).toBe('stopped');
		expect(out.some((o) => o.t === 'task started')).toBe(true);
		expect(server.requests.some((r) => r.method === 'DELETE' && r.path.startsWith('/nodes/pve2/tasks/'))).toBe(true);
		expect(out[out.length - 1]).toMatchObject({ exitstatus: 'OK', node: 'pve2' });
		await expect(runNode({ credentials: creds(), params: { resource: 'task', operation: 'getStatus', upid: 'UPID:../../x' } })).rejects.toThrow(/UPID/);
	});
});

describe('Task search', () => {
	const t = (n: number, extra: Record<string, unknown>) => ({
		upid: `UPID:pve1:0000000${n}:0000000${n}:6500000${n}:vzdump::root@pam:`,
		node: 'pve1',
		type: 'vzdump',
		id: '',
		user: 'root@pam',
		starttime: 1767225600 + n * 100,
		endtime: 1767225600 + n * 100 + 50,
		status: 'OK',
		...extra,
	});
	const clusterTasks = [
		t(1, { id: '100', status: 'OK' }),
		t(2, { id: '100', status: 'job errors' }),
		t(3, { type: 'qmstart', id: '200', user: 'n8n@pve!test' }),
		t(4, { id: '100', endtime: undefined, status: undefined }),
		t(5, { node: 'pve2', id: '300', status: 'OK' }),
	];

	beforeAll(() => {
		server.on('GET', '/cluster/tasks', () => ({ data: clusterTasks }));
		server.on('GET', '/nodes/{node}/tasks', (_req, p) => ({ data: clusterTasks.filter((x) => x.node === p.node) }));
	});

	it('Get Many lists cluster tasks newest first with local filters and limit', async () => {
		const all = await run({ resource: 'task', operation: 'getMany' });
		expect(all.map((x) => x.starttime)).toEqual([...clusterTasks].map((x) => x.starttime).sort((a, b) => b - a));
		const backups = await run({ resource: 'task', operation: 'getMany', taskFilters: { type: 'vzdump', vmid: 100 }, limit: 2 });
		expect(backups.map((x) => x.upid)).toEqual([clusterTasks[3].upid, clusterTasks[1].upid]);
		const errors = await run({ resource: 'task', operation: 'getMany', taskFilters: { errorsOnly: true } });
		expect(errors.map((x) => x.status)).toEqual(['job errors']);
		expect(errors[0]).toMatchObject({ running: false, success: false });
		const running = await run({ resource: 'task', operation: 'getMany', taskFilters: { runningOnly: true } });
		expect(running).toHaveLength(1);
		expect(running[0]).toMatchObject({ running: true, success: null });
		const byUser = await run({ resource: 'task', operation: 'getMany', taskFilters: { user: 'n8n@pve' } });
		expect(byUser.map((x) => x.type)).toEqual(['qmstart']);
		const range = await run({
			resource: 'task',
			operation: 'getMany',
			taskFilters: { since: new Date((1767225600 + 200) * 1000).toISOString(), until: new Date((1767225600 + 300) * 1000).toISOString() },
		});
		expect(range.map((x) => x.starttime)).toEqual([1767225600 + 300, 1767225600 + 200]);
		await expect(runNode({ credentials: creds(), params: { resource: 'task', operation: 'getMany', limit: 5000 } })).rejects.toThrow(/Limit/);
	});

	it('Get Many with a node uses the node task index with server-side filters', async () => {
		server.requests.length = 0;
		const out = await run({ resource: 'task', operation: 'getMany', filterNode: 'pve2', taskFilters: { type: 'vzdump', errorsOnly: false, user: 'root@pam' }, limit: 10 });
		expect(out.map((x) => x.id)).toEqual(['300']);
		const req = server.requestsTo('GET', '/nodes/pve2/tasks')[0];
		expect(req.query.get('typefilter')).toBe('vzdump');
		expect(req.query.get('userfilter')).toBe('root@pam');
		expect(req.query.get('source')).toBe('all');
		expect(req.query.get('limit')).toBe('10');
	});

	it('Get Last returns the most recent matching task or found=false', async () => {
		const [last] = await run({ resource: 'task', operation: 'getLast', taskFilters: { type: 'vzdump', errorsOnly: true } });
		expect(last).toMatchObject({ status: 'job errors', id: '100' });
		const [none] = await run({ resource: 'task', operation: 'getLast', taskFilters: { type: 'qmigrate' } });
		expect(none).toEqual({ found: false });
	});
});

describe('Container', () => {
	it('updates config synchronously and has no hibernate', async () => {
		server.on('PUT', '/nodes/{node}/lxc/{vmid}/config', () => ({ data: null }));
		const [out] = await run({ resource: 'container', operation: 'updateConfig', node: 'pve2', vmid: '200', additionalParameters: { parameter: [{ name: 'memory', value: '1024' }] } });
		expect(out).toEqual({ success: true });
		await expect(runNode({ credentials: creds(), params: { resource: 'container', operation: 'hibernate', node: 'pve2', vmid: '200' } })).rejects.toThrow(/Unsupported/);
	});

	it('moves a volume', async () => {
		server.on('POST', '/nodes/{node}/lxc/{vmid}/move_volume', () => ({ data: makeUpid('pve2', 'move_volume', '200') }));
		await run({ resource: 'container', operation: 'moveDisk', node: 'pve2', vmid: '200', disk: 'rootfs', targetStorage: 'local-zfs' });
		const req = server.requestsTo('POST', '/nodes/pve2/lxc/200/move_volume')[0];
		expect(req.form.get('volume')).toBe('rootfs');
		expect(req.form.get('storage')).toBe('local-zfs');
	});
});

describe('Guest Agent', () => {
	it('Exec waits for the result via exec-status', async () => {
		let polls = 0;
		server.on('POST', '/nodes/{node}/qemu/{vmid}/agent/exec', () => ({ data: { pid: 4242 } }));
		server.on('GET', '/nodes/{node}/qemu/{vmid}/agent/exec-status', () => {
			polls++;
			return polls < 2 ? { data: { exited: 0 } } : { data: { exited: 1, exitcode: 0, 'out-data': 'up 3 days\n' } };
		});
		const [out] = await run({ resource: 'guestAgent', operation: 'exec', node: 'pve1', vmid: '100', command: '/usr/bin/uptime', arguments: ['-p'], execWaitOptions: { pollInterval: 1, timeout: 20 } });
		expect(out).toMatchObject({ pid: 4242, exited: true, exitcode: 0, 'out-data': 'up 3 days\n' });
		const req = server.requestsTo('POST', '/nodes/pve1/qemu/100/agent/exec')[0];
		expect(req.form.getAll('command')).toEqual(['/usr/bin/uptime', '-p']);
		expect(server.requestsTo('GET', '/nodes/pve1/qemu/100/agent/exec-status')[0].query.get('pid')).toBe('4242');
	});

	it('reads OS info and network interfaces, writes files from binary data', async () => {
		server.on('GET', '/nodes/{node}/qemu/{vmid}/agent/get-osinfo', () => ({ data: { result: { id: 'debian', 'version-id': '13' } } }));
		server.on('GET', '/nodes/{node}/qemu/{vmid}/agent/network-get-interfaces', () => ({ data: { result: [{ name: 'lo' }, { name: 'eth0' }] } }));
		server.on('POST', '/nodes/{node}/qemu/{vmid}/agent/file-write', () => ({ data: null }));
		const out = await run(
			[
				{ resource: 'guestAgent', operation: 'getOsInfo', node: 'pve1', vmid: '100' },
				{ resource: 'guestAgent', operation: 'getNetworkInterfaces', node: 'pve1', vmid: '100' },
				{ resource: 'guestAgent', operation: 'fileWrite', node: 'pve1', vmid: '100', file: '/tmp/a.bin', contentSource: 'binary', binaryPropertyName: 'data' },
			],
			{ binary: { data: { data: Buffer.from([0, 1, 2, 255]), fileName: 'a.bin' } } },
		);
		expect(out[0]).toEqual({ id: 'debian', 'version-id': '13' });
		expect(out.filter((o) => o.name === 'eth0')).toHaveLength(1);
		const req = server.requestsTo('POST', '/nodes/pve1/qemu/100/agent/file-write')[0];
		expect(req.form.get('content')).toBe(Buffer.from([0, 1, 2, 255]).toString('base64'));
		expect(req.form.get('encode')).toBe('0');
	});
});

describe('Storage', () => {
	it('uploads n8n binary data as multipart', async () => {
		const upid = makeUpid('pve1', 'imgcopy');
		server.on('POST', '/nodes/{node}/storage/{storage}/upload', () => ({ data: upid }));
		const iso = Buffer.from('ISO-CONTENT-'.repeat(100));
		const [out] = await run(
			{ resource: 'storage', operation: 'upload', node: 'pve1', storage: 'local', uploadContent: 'iso', binaryPropertyName: 'data', transferOptions: { checksum: 'a'.repeat(64), 'checksum-algorithm': 'sha256' } },
			{ binary: { data: { data: iso, fileName: 'test.iso' } } },
		);
		expect(out).toMatchObject({ upid, storage: 'local', filename: 'test.iso', content: 'iso', size: iso.length });
		const req = server.requestsTo('POST', '/nodes/pve1/storage/local/upload')[0];
		expect(String(req.headers['content-type'])).toMatch(/multipart\/form-data/);
		expect(req.body).toContain('name="content"');
		expect(req.body).toContain('filename="test.iso"');
		expect(req.body).toContain('ISO-CONTENT-ISO-CONTENT');
		expect(req.body).toContain('name="checksum"');
	});

	it('downloads from URL and deletes volumes with encoded volume IDs', async () => {
		server.on('POST', '/nodes/{node}/storage/{storage}/download-url', () => ({ data: makeUpid('pve1', 'download') }));
		server.on('DELETE', '/nodes/{node}/storage/{storage}/content/{volume}', () => ({ data: makeUpid('pve1', 'imgdel') }));
		await run([
			{ resource: 'storage', operation: 'downloadFromUrl', node: 'pve1', storage: 'local', url: 'https://example.com/d.iso', filename: 'd.iso', uploadContent: 'iso' },
			{ resource: 'storage', operation: 'deleteVolume', node: 'pve1', storage: 'local', volume: 'local:iso/d.iso' },
		]);
		expect(server.requestsTo('POST', '/nodes/pve1/storage/local/download-url')[0].form.get('url')).toBe('https://example.com/d.iso');
		expect(server.requests.find((r) => r.method === 'DELETE')?.path).toBe('/nodes/pve1/storage/local/content/local%3Aiso%2Fd.iso');
		await expect(
			runNode({ credentials: creds(), params: { resource: 'storage', operation: 'downloadFromUrl', node: 'pve1', storage: 'local', url: 'file:///etc/passwd', filename: 'x.iso', uploadContent: 'iso' } }),
		).rejects.toThrow(/http/);
	});
});

describe('Backup', () => {
	it('prune is a preview by default and deletes only with Delete Backups', async () => {
		server.on('GET', '/nodes/{node}/storage/{storage}/prunebackups', () => ({ data: [{ volid: 'local:backup/a', mark: 'remove' }] }));
		server.on('DELETE', '/nodes/{node}/storage/{storage}/prunebackups', () => ({ data: makeUpid('pve1', 'prunebackups') }));
		const preview = await run({ resource: 'backup', operation: 'prune', node: 'pve1', storage: 'local', pruneBackups: 'keep-last=3' });
		expect(preview[0].mark).toBe('remove');
		expect(server.requests.filter((r) => r.method === 'DELETE')).toHaveLength(0);
		await run({ resource: 'backup', operation: 'prune', node: 'pve1', storage: 'local', pruneBackups: 'keep-last=3', deleteBackups: true });
		expect(server.requests.filter((r) => r.method === 'DELETE')).toHaveLength(1);
	});

	it('Backup Job: get many, get and run now on every online node without scheduling fields', async () => {
		server.on('GET', '/cluster/backup', () => ({ data: [{ id: 'backup-abc', schedule: 'sun 01:00' }] }));
		server.on('GET', '/cluster/backup/{id}', () => ({
			data: { id: 'backup-abc', schedule: 'sun 01:00', enabled: 1, storage: 'pbs', vmid: '100,200', mode: 'snapshot', 'prune-backups': { 'keep-last': 3 }, comment: 'weekly', 'next-run': 123 },
		}));
		server.on('POST', '/nodes/{node}/vzdump', (_req, p) => ({ data: makeUpid(p.node, 'vzdump') }));
		const list = await run({ resource: 'backupJob', operation: 'getMany' });
		expect(list[0].id).toBe('backup-abc');
		const [job] = await run({ resource: 'backupJob', operation: 'get', jobId: 'backup-abc' });
		expect(job.storage).toBe('pbs');
		const out = await run({ resource: 'backupJob', operation: 'runNow', jobId: 'backup-abc' });
		expect(out).toHaveLength(2);
		expect(out.map((o) => o.node)).toEqual(['pve1', 'pve2']);
		const req = server.requestsTo('POST', '/nodes/pve1/vzdump')[0];
		expect(req.form.get('storage')).toBe('pbs');
		expect(req.form.get('prune-backups')).toBe('keep-last=3');
		for (const key of ['schedule', 'comment', 'enabled', 'id', 'next-run']) expect(req.form.get(key)).toBeNull();
		expect(server.requestsTo('POST', '/nodes/pve2/vzdump')).toHaveLength(1);
		await expect(runNode({ credentials: creds(), params: { resource: 'backup', operation: 'restore' } })).rejects.toThrow(/Unsupported/);
	});

	it('lists guests without backup', async () => {
		server.on('GET', '/cluster/backup-info/not-backed-up', () => ({ data: [{ vmid: 999, type: 'qemu' }] }));
		expect(await run({ resource: 'backup', operation: 'getNotBackedUp' })).toEqual([{ vmid: 999, type: 'qemu' }]);
	});
});

describe('Cluster, HA, Pool, Replication', () => {
	it('reads the version; Get Backup Info and Get Tasks no longer exist', async () => {
		const [out] = await run({ resource: 'cluster', operation: 'getVersion' });
		expect(out.version).toBe('9.2.9');
		for (const operation of ['getBackupInfo', 'getTasks']) {
			await expect(runNode({ credentials: creds(), params: { resource: 'cluster', operation } })).rejects.toThrow(/Unsupported/);
		}
	});

	it('creates HA rules (9.x) and groups (8.x)', async () => {
		server.on('POST', '/cluster/ha/rules', () => ({ data: null }));
		server.on('POST', '/cluster/ha/groups', () => ({ data: null }));
		await run([
			{ resource: 'ha', operation: 'createRule', rule: 'keep_web', ruleType: 'node-affinity', ruleFields: { resources: 'vm:100', nodes: 'pve1:2,pve2:1', strict: true } },
			{ resource: 'ha', operation: 'createGroup', group: 'prefer_pve1', groupFields: { nodes: 'pve1:2,pve2' } },
		]);
		const rule = server.requestsTo('POST', '/cluster/ha/rules')[0];
		expect(rule.form.get('type')).toBe('node-affinity');
		expect(rule.form.get('rule')).toBe('keep_web');
		expect(server.requestsTo('POST', '/cluster/ha/groups')[0].form.get('nodes')).toBe('pve1:2,pve2');
	});

	it('manages pools', async () => {
		server.on('POST', '/pools', () => ({ data: null }));
		server.on('DELETE', '/pools', () => ({ data: null }));
		await run([
			{ resource: 'pool', operation: 'create', poolid: 'prod', comment: 'Production' },
			{ resource: 'pool', operation: 'delete', poolid: 'prod' },
		]);
		expect(server.requestsTo('DELETE', '/pools')[0].query.get('poolid')).toBe('prod');
	});

	it('runs a replication job on the node that hosts the guest', async () => {
		server.on('GET', '/cluster/replication/{id}', () => ({ data: { id: '200-0', guest: 200, target: 'pve1' } }));
		server.on('POST', '/nodes/{node}/replication/{id}/schedule_now', () => ({ data: makeUpid('pve2', 'replicate', '200-0') }));
		const [out] = await run({ resource: 'replication', operation: 'runNow', jobId: '200-0' });
		expect(out.node).toBe('pve2');
		expect(server.requestsTo('POST', '/nodes/pve2/replication/200-0/schedule_now')).toHaveLength(1);
	});
});

describe('Removed resources', () => {
	it('Firewall and API Read are no longer available', async () => {
		for (const resource of ['firewall', 'apiRead']) {
			await expect(runNode({ credentials: creds(), params: { resource, operation: 'getRules' } })).rejects.toThrow(/Unsupported/);
		}
		expect(server.requests).toHaveLength(0);
	});
});

describe('Access', () => {
	it('never returns token secrets', async () => {
		server.on('GET', '/access/users/{userid}/token', () => ({ data: [{ tokenid: 'automation', privsep: 1, value: 'leaked-secret' }] }));
		const [out] = await run({ resource: 'access', operation: 'getApiTokens', userid: 'n8n@pve' });
		expect(out).toEqual({ userid: 'n8n@pve', tokenid: 'automation', privsep: 1 });
		expect(server.requests[0].path).toBe('/access/users/n8n%40pve/token');
	});

	it('reads users, roles and ACL', async () => {
		server.on('GET', '/access/users', () => ({ data: [{ userid: 'root@pam' }] }));
		server.on('GET', '/access/roles', () => ({ data: [{ roleid: 'PVEAuditor' }] }));
		server.on('GET', '/access/acl', () => ({ data: [{ path: '/', roleid: 'PVEAuditor' }] }));
		const out = await run([
			{ resource: 'access', operation: 'getUsers' },
			{ resource: 'access', operation: 'getRoles' },
			{ resource: 'access', operation: 'getAcl' },
		]);
		expect(out.map((o) => o.userid ?? o.roleid)).toEqual(['root@pam', 'PVEAuditor', 'PVEAuditor']);
	});
});

describe('Custom API Call', () => {
	it('sends any method below /api2/json', async () => {
		server.on('POST', '/nodes/{node}/qemu/{vmid}/status/start', () => ({ data: makeUpid('pve1', 'qmstart', '100') }));
		const [out] = await run({ resource: 'customApiCall', operation: 'call', method: 'POST', path: 'nodes/pve1/qemu/100/status/start', body: '{"timeout":30}' });
		expect(out.type).toBe('qmstart');
		expect(server.requestsTo('POST', '/nodes/pve1/qemu/100/status/start')[0].form.get('timeout')).toBe('30');
	});

	it('rejects absolute URLs, traversal (also encoded) and paths outside the API', async () => {
		const bad = [
			'https://evil.example.com/api2/json/nodes',
			'//evil.example.com/nodes',
			'/nodes/../access/ticket',
			'/nodes/%2e%2e/access',
			'/nodes/%252e%252e/x',
			'/nodes%2fpve1',
			'/api2/extjs/nodes',
			'/nodes?x=1',
			'/nodes#a',
			'\\nodes',
			'/nodes/pve1\u0000',
			'javascript:alert(1)',
		];
		for (const path of bad) {
			await expect(runNode({ credentials: creds(), params: { resource: 'customApiCall', operation: 'call', method: 'GET', path } })).rejects.toThrow();
		}
		expect(server.requests).toHaveLength(0);
	});
});

describe('Split Into Items', () => {
	it('splits by default and returns one item with an array when disabled', async () => {
		const split = await run({ resource: 'cluster', operation: 'getResources' });
		expect(split.length).toBe(3);
		const single = await run({ resource: 'cluster', operation: 'getResources', splitIntoItems: false });
		expect(single).toHaveLength(1);
		expect(Array.isArray(single[0].data)).toBe(true);
	});
});
