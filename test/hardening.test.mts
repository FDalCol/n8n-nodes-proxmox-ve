/**
 * Security hardening: path traversal variants, prototype keys, secret masking in responses and
 * errors, limits from expressions, redirects on the credential test and the ticket login.
 */
import type { IDataObject, IHttpRequestOptions } from 'n8n-workflow';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { apiPath, encodeSegment, isSafeKey, redactString, redactValue, validateApiPath } from '../nodes/ProxmoxVe/shared/security';
import { CSRF, FakeProxmox, PASSWORD, TICKET, TOKEN_ID, TOKEN_SECRET, Trap } from './helpers/fakeProxmox';
import {
	credentialType,
	evalCredentialExpression,
	httpRequestWithAuthentication,
	NODE,
	passwordCredentials,
	poll,
	runNode,
	runNodeJson,
	tokenCredentials,
	type Params,
} from './helpers/harness';

let server: FakeProxmox;
let trap: Trap;

beforeAll(async () => {
	server = await new FakeProxmox().start();
	trap = await new Trap().start();
});
afterAll(async () => {
	await server.stop();
	await trap.stop();
});
afterEach(() => {
	server.requests.length = 0;
});

const fail = (params: Params, extra: IDataObject = {}) =>
	runNode({ credentials: tokenCredentials(server, extra), params }).then(
		() => {
			throw new Error('expected an error');
		},
		(e: Error & { description?: string }) => e,
	);

describe('path values cannot change the endpoint', () => {
	const evil = ['pve/../..', '%2e%2e', '..;', '..;/access', '100/../../access', '..%2F..', 'a/%2e%2e/b', '..\\x', '.'];

	it('rejects traversal in any encoded path segment', () => {
		for (const v of evil) expect(() => encodeSegment(v), v).toThrow();
		expect(apiPath`/nodes/pve1/storage/local/content/${'local:iso/debian.iso'}`).toBe('/nodes/pve1/storage/local/content/local%3Aiso%2Fdebian.iso');
		expect(encodeSegment('UPID:pve1:00000001:00000001:65000000:vzdump::n8n@pve!test:')).toContain('UPID%3Apve1');
	});

	it('rejects traversal in user supplied values of every resource before any request', async () => {
		const cases: Params[] = [
			{ resource: 'node', operation: 'getStatus', node: 'pve/../..' },
			{ resource: 'node', operation: 'getNetworkInterface', node: 'pve1', iface: '../../access' },
			{ resource: 'node', operation: 'getNetworkInterface', node: 'pve1', iface: '..;' },
			{ resource: 'vm', operation: 'getStatus', node: 'pve1', vmid: '100/../../access' },
			{ resource: 'storage', operation: 'getStatus', node: 'pve1', storage: '%2e%2e' },
			{ resource: 'storage', operation: 'deleteVolume', node: 'pve1', storage: 'local', volume: 'local:iso/../../x' },
			{ resource: 'vm', operation: 'getSnapshotConfig', node: 'pve1', vmid: '100', snapname: '..;' },
			{ resource: 'node', operation: 'getServiceState', node: 'pve1', service: '../x' },
			{ resource: 'backupJob', operation: 'get', jobId: '..' },
			{ resource: 'ha', operation: 'getResource', sid: 'vm:100/../x' },
			{ resource: 'task', operation: 'getStatus', upid: 'UPID:pve1/../..:00000001:00000001:65000000:vzdump::root@pam:' },
			{ resource: 'task', operation: 'getStatus', upid: 'UPID:pve1:00000001:00000001:65000000:vzdump:..:root@pam:' },
			{ resource: 'access', operation: 'getApiTokens', userid: '../../x@pve' },
		];
		for (const params of cases) {
			const err = await fail(params);
			expect(err.message, JSON.stringify(params)).not.toBe('expected an error');
		}
		expect(server.requests.map((r) => `${r.method} ${r.path}`)).toEqual([]);
	});

	it('Custom API Call rejects ";", double encoding and overlong UTF-8', () => {
		for (const p of ['/nodes/..;/access', '/nodes;jsessionid=1', '/nodes/%c0%ae%c0%ae/access', '/nodes/%e0%80%ae', '/nodes/%252e%252e', '/nodes/%2e', '/nodes/%3b', '/nodes/%ff']) {
			expect(() => validateApiPath(p), p).toThrow();
		}
		expect(validateApiPath('/nodes/pve1/tasks/UPID%3Apve1%3A1')).toBe('/nodes/pve1/tasks/UPID%3Apve1%3A1');
	});
});

describe('prototype keys are rejected', () => {
	it('isSafeKey', () => {
		for (const k of ['__proto__', 'constructor', 'prototype', 'Constructor']) expect(isSafeKey(k)).toBe(false);
		expect(isSafeKey('memory')).toBe(true);
	});

	it('in Additional Parameters and in Custom API Call query and body', async () => {
		for (const name of ['__proto__', 'constructor', 'prototype']) {
			const a = await fail({ resource: 'vm', operation: 'updateConfig', node: 'pve1', vmid: '100', additionalParameters: { parameter: [{ name, value: 'x' }] } });
			expect(a.message).toMatch(/Invalid parameter name/);
			const q = await fail({ resource: 'customApiCall', operation: 'call', method: 'GET', path: '/version', queryParameters: { parameter: [{ name, value: 'x' }] } });
			expect(q.message).toMatch(/Invalid query parameter name/);
			const b = await fail({ resource: 'customApiCall', operation: 'call', method: 'POST', path: '/pools', body: `{"${name}": {"polluted": true}}` });
			expect(b.message).toMatch(/Invalid body parameter name/);
		}
		expect(({} as IDataObject).polluted).toBeUndefined();
		expect(server.requests).toHaveLength(0);
	});

	it('never copies __proto__ from server data', () => {
		const out = redactValue(JSON.parse('{"__proto__": {"polluted": true}, "a": 1}') as IDataObject);
		expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
		expect((out as IDataObject).polluted).toBeUndefined();
	});
});

describe('sensitive data in responses and errors', () => {
	it('masks cloud-init passwords and password/secret fields in configs', async () => {
		server.on('GET', '/nodes/{node}/qemu/{vmid}/cloudinit', () => ({
			data: [
				{ key: 'ciuser', value: 'admin' },
				{ key: 'cipassword', value: '$5$hashedsecret', pending: 'new-plain-password' },
			],
		}));
		server.on('GET', '/nodes/{node}/qemu/{vmid}/config', () => ({ data: { name: 'web', cipassword: '**********', 'my-secret-note': 'x', args: '-smbios type=1,serial=abc' } }));
		const ci = await runNodeJson({ credentials: tokenCredentials(server), params: { resource: 'vm', operation: 'getCloudInit', node: 'pve1', vmid: '100' } });
		expect(ci[0]).toEqual({ key: 'ciuser', value: 'admin' });
		expect(ci[1]).toEqual({ key: 'cipassword', value: '[REDACTED]', pending: '[REDACTED]' });
		const [cfg] = await runNodeJson({ credentials: tokenCredentials(server), params: { resource: 'vm', operation: 'getConfig', node: 'pve1', vmid: '100' } });
		expect(cfg).toMatchObject({ name: 'web', cipassword: '[REDACTED]', 'my-secret-note': '[REDACTED]' });
	});

	it('never shows the Exec command line or File Write content in errors', async () => {
		server.on('POST', '/nodes/{node}/qemu/{vmid}/agent/exec', (req) => ({
			status: 500,
			statusMessage: `Agent error: Failed to execute child process "${req.form.getAll('command').join(' ')}"`,
		}));
		server.on('POST', '/nodes/{node}/qemu/{vmid}/agent/file-write', (req) => ({
			status: 400,
			statusMessage: 'Parameter verification failed.',
			errors: { content: `invalid value '${req.form.get('content') ?? ''}'` },
		}));
		const exec = await fail({ resource: 'guestAgent', operation: 'exec', node: 'pve1', vmid: '100', command: '/usr/local/bin/rotate-keys', arguments: ['--token', 'very-secret-arg'] });
		const execText = `${exec.message} ${exec.description ?? ''}`;
		expect(execText).not.toContain('rotate-keys');
		expect(execText).not.toContain('very-secret-arg');
		expect(execText).toContain('REDACTED');
		const write = await fail({ resource: 'guestAgent', operation: 'fileWrite', node: 'pve1', vmid: '100', file: '/etc/app.conf', contentSource: 'text', content: 'db_password=TopSecret123' });
		const writeText = `${write.message} ${write.description ?? ''}`;
		expect(writeText).not.toContain('TopSecret123');
		expect(writeText).not.toContain(Buffer.from('db_password=TopSecret123').toString('base64'));
	});

	it('network and certificate errors contain no secrets (token and ticket), also with continueOnFail', async () => {
		for (const credentials of [tokenCredentials(server, { allowSelfSigned: false }), passwordCredentials(server, { allowSelfSigned: false })]) {
			const out = await runNode({ credentials, continueOnFail: true, params: { resource: 'node', operation: 'getMany' } });
			const text = JSON.stringify(out);
			expect(text).toMatch(/certificate/i);
			for (const s of [TOKEN_SECRET, PASSWORD, TICKET, CSRF, `PVEAPIToken`]) expect(text).not.toContain(s);
		}
		const refused = await runNode({
			credentials: tokenCredentials(server, { baseUrl: 'https://127.0.0.1:1' }),
			continueOnFail: true,
			params: { resource: 'node', operation: 'getMany' },
		});
		expect(JSON.stringify(refused)).not.toContain(TOKEN_SECRET);
		expect(TOKEN_ID).toContain('!'); // token ID format used by the fake server
	});
});

describe('limits also from expressions', () => {
	it('rejects list limits above the maximum', async () => {
		const upid = 'UPID:pve1:00000001:00000001:65000000:vzdump::root@pam:';
		const cases: Params[] = [
			{ resource: 'node', operation: 'getSyslog', node: 'pve1', syslogOptions: { limit: 10_000_000 } },
			{ resource: 'node', operation: 'getJournal', node: 'pve1', journalOptions: { lastentries: 10_000_001 } },
			{ resource: 'task', operation: 'getLog', upid, logOptions: { limit: 1e9 } },
			{ resource: 'cluster', operation: 'getLog', max: 1e9 },
			{ resource: 'task', operation: 'getMany', limit: 1001 },
			{ resource: 'task', operation: 'waitForCompletion', upid, taskWaitOptions: { timeout: 86_401 } },
			{ resource: 'guestAgent', operation: 'exec', node: 'pve1', vmid: '100', command: '/bin/true', execWaitOptions: { pollInterval: 0 } },
		];
		server.on('POST', '/nodes/{node}/qemu/{vmid}/agent/exec', () => ({ data: { pid: 1 } }));
		for (const params of cases) {
			const err = await fail(params);
			expect(err.message, JSON.stringify(params)).toMatch(/between|at least|Limit/);
		}
	});
});

describe('no redirects are followed', () => {
	it('credential test request', async () => {
		const redirecting = await new FakeProxmox().start();
		redirecting.on('GET', '/version', () => ({ status: 302, statusMessage: 'Found', headers: { Location: `${trap.url}/api2/json/version` } }));
		try {
			const creds = tokenCredentials(redirecting);
			const req = credentialType.test.request as IDataObject;
			expect(req.disableFollowRedirect).toBe(true);
			const resolved: IDataObject = {};
			for (const [k, v] of Object.entries(req)) resolved[k] = evalCredentialExpression(v, creds);
			const options = { ...(resolved as unknown as IHttpRequestOptions), url: `${String(resolved.baseURL)}${String(resolved.url)}`, baseURL: undefined, returnFullResponse: true, ignoreHttpStatusErrors: true };
			const res = (await httpRequestWithAuthentication(NODE, creds, options)) as { statusCode: number };
			expect(res.statusCode).toBe(302);
			expect(trap.hits).toHaveLength(0);
		} finally {
			await redirecting.stop();
		}
	});

	it('ticket login', async () => {
		const redirecting = await new FakeProxmox().start();
		redirecting.on('POST', '/access/ticket', () => ({ status: 307, statusMessage: 'Temporary Redirect', headers: { Location: `${trap.url}/api2/json/access/ticket` } }));
		try {
			const err = await runNode({ credentials: passwordCredentials(redirecting), params: { resource: 'node', operation: 'getMany' } }).catch((e: Error) => e);
			expect((err as Error).message).toMatch(/redirect/i);
			expect(trap.hits).toHaveLength(0);
		} finally {
			await redirecting.stop();
		}
	});
});

describe('second review round', () => {
	it('redaction is linear on hostile input (no ReDoS) and still redacts real tickets', () => {
		const hostile = ['PVE:'.repeat(262_144), 'password="'.repeat(100_000), 'PVEAuthCookie='.repeat(70_000), 'Authorization: '.repeat(70_000)];
		for (const text of hostile) {
			const started = Date.now();
			redactString(text);
			expect(Date.now() - started, text.slice(0, 20)).toBeLessThan(1500);
		}
		expect(redactString(`cookie ${TICKET} end`)).not.toContain(TICKET);
	});

	it('does not turn the credential password into an oracle, but hides it in login errors', async () => {
		server.on('GET', '/nodes/{node}/qemu/{vmid}/agent/exec-status', () => ({ data: { exited: 1, exitcode: 0, 'out-data': `guess1 ${PASSWORD} guess3` } }));
		server.on('POST', '/nodes/{node}/qemu/{vmid}/agent/exec', () => ({ data: { pid: 7 } }));
		const [out] = await runNodeJson({
			credentials: passwordCredentials(server),
			params: { resource: 'guestAgent', operation: 'exec', node: 'pve1', vmid: '100', command: '/bin/echo', execWaitOptions: { pollInterval: 1, timeout: 10 } },
		});
		expect(out['out-data']).toBe(`guess1 ${PASSWORD} guess3`); // echoed by the workflow itself: no information gained
		const echoing = await new FakeProxmox().start();
		echoing.on('POST', '/access/ticket', (req) => ({ status: 401, statusMessage: `bad password ${req.form.get('password') ?? ''}` }));
		try {
			const err = await runNode({ credentials: passwordCredentials(echoing), params: { resource: 'node', operation: 'getMany' } }).catch((e: Error & { description?: string }) => e);
			expect(`${(err as Error).message} ${(err as { description?: string }).description ?? ''}`).not.toContain(PASSWORD);
		} finally {
			await echoing.stop();
		}
	});

	it('Custom API Call never returns the secret of a created token', async () => {
		server.on('POST', '/access/users/{userid}/token/{tokenid}', () => ({ data: { 'full-tokenid': 'n8n@pve!new', value: '11111111-2222-3333-4444-555555555555', info: { privsep: 1 } } }));
		const [out] = await runNodeJson({ credentials: tokenCredentials(server), params: { resource: 'customApiCall', operation: 'call', method: 'POST', path: '/access/users/n8n@pve/token/new', body: '{}' } });
		expect(out).toEqual({ 'full-tokenid': 'n8n@pve!new', value: '[REDACTED]', info: { privsep: 1 } });
	});

	it('does not return deeply nested data unchecked', () => {
		let nested: IDataObject = { password: 'deep-secret' };
		for (let i = 0; i < 40; i++) nested = { child: nested };
		expect(JSON.stringify(redactValue(nested))).not.toContain('deep-secret');
	});

	it('keeps the trigger state bounded in length and node count', async () => {
		const many = await new FakeProxmox().start();
		many.on('GET', '/nodes', () => ({ data: Array.from({ length: 100 }, (_, i) => ({ node: `n${i}`, status: 'online' })) }));
		many.on('GET', '/nodes/{node}/apt/update', () => ({ data: [{ Package: 'p'.repeat(5000), Version: '1' }] }));
		try {
			const staticData: IDataObject = {};
			await poll({ credentials: tokenCredentials(many), params: { event: 'updatesAvailable' }, staticData });
			const packages = staticData.packages as Record<string, string[]>;
			expect(Object.keys(packages).length).toBeLessThanOrEqual(64);
			expect(Object.values(packages).flat().every((k) => k.length <= 256)).toBe(true);
			expect(await poll({ credentials: tokenCredentials(many), params: { event: 'updatesAvailable' }, staticData })).toBeNull();
		} finally {
			await many.stop();
		}
	});
});
