import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { ProxmoxClient } from '../nodes/ProxmoxVe/shared/transport';
import { CSRF, FakeProxmox, PASSWORD, TICKET, TOKEN_SECRET, Trap } from './helpers/fakeProxmox';
import { executeContext, passwordCredentials, runNode, runNodeJson, sentRequests, tokenCredentials } from './helpers/harness';

let server: FakeProxmox;
let trap: Trap;

beforeAll(async () => {
	server = await new FakeProxmox().start();
	trap = await new Trap().start();
	server.on('GET', '/nodes', () => ({ data: [{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'offline' }] }));
	server.on('POST', '/nodes/{node}/status', () => ({ data: null }));
	server.on('GET', '/nodes/{node}/status', () => ({ data: { uptime: 100, cpu: 0.1 } }));
	server.on('GET', '/redirect-me', () => ({ status: 302, statusMessage: 'Found', headers: { Location: `${trap.url}/api2/json/nodes` } }));
	server.on('GET', '/nodes/{node}/syslog', () => ({ data: Array.from({ length: 2000 }, (_, i) => ({ n: i, t: 'x'.repeat(200) })) }));
	server.on('GET', '/nodes/{node}/journal', () => ({ data: [], delayMs: 1500 }));
	server.on('GET', '/nodes/{node}/network', () => ({
		status: 400,
		statusMessage: 'Parameter verification failed.',
		errors: { type: "value 'foo' does not have a value in the enumeration 'bridge, bond'" },
	}));
	server.on('GET', '/nodes/{node}/certificates/info', (req) => ({
		status: 500,
		statusMessage: `echo ${String(req.headers.authorization ?? req.headers.cookie)}`,
	}));
});

afterAll(async () => {
	await server.stop();
	await trap.stop();
});

afterEach(() => {
	server.requests.length = 0;
	sentRequests.length = 0;
});

describe('API token authentication', () => {
	it('sends the PVEAPIToken header and returns data', async () => {
		const out = await runNodeJson({ credentials: tokenCredentials(server), params: { resource: 'node', operation: 'getMany' } });
		expect(out.map((o) => o.node)).toEqual(['pve1', 'pve2']);
		const req = server.requestsTo('GET', '/nodes')[0];
		expect(req.headers.authorization).toBe(`PVEAPIToken=n8n@pve!test=${TOKEN_SECRET}`);
		expect(req.headers.cookie).toBeUndefined();
	});

	it('fails with a clear message on a wrong secret', async () => {
		await expect(
			runNode({ credentials: tokenCredentials(server, { tokenSecret: 'wrong-secret-value' }), params: { resource: 'node', operation: 'getMany' } }),
		).rejects.toThrow(/401/);
	});
});

describe('Username/password authentication', () => {
	it('logs in once per execution and sends ticket cookie and CSRF token on writes', async () => {
		const out = await runNodeJson({
			credentials: passwordCredentials(server),
			params: [
				{ resource: 'node', operation: 'getStatus', node: 'pve1' },
				{ resource: 'node', operation: 'reboot', node: 'pve1' },
				{ resource: 'node', operation: 'getStatus', node: 'pve1' },
			],
		});
		expect(out).toHaveLength(3);
		const logins = server.requestsTo('POST', '/access/ticket');
		expect(logins).toHaveLength(1);
		// credentials only in the body, never in the URL
		expect(logins[0].form.get('password')).toBe(PASSWORD);
		expect(logins[0].query.toString()).toBe('');
		const get = server.requestsTo('GET', '/nodes/pve1/status')[0];
		expect(get.headers.cookie).toBe(`PVEAuthCookie=${TICKET}`);
		expect(get.headers.csrfpreventiontoken).toBeUndefined();
		const post = server.requestsTo('POST', '/nodes/pve1/status')[0];
		expect(post.headers.csrfpreventiontoken).toBe(CSRF);
		expect(post.form.get('command')).toBe('reboot');
	});

	it('reports a failed login', async () => {
		await expect(
			runNode({ credentials: passwordCredentials(server, { password: 'nope-nope' }), params: { resource: 'node', operation: 'getMany' } }),
		).rejects.toThrow(/Login failed/);
	});
});

describe('TLS and URL handling', () => {
	it('rejects a self-signed certificate unless allowed, with a clear message', async () => {
		await expect(
			runNode({ credentials: tokenCredentials(server, { allowSelfSigned: false }), params: { resource: 'node', operation: 'getMany' } }),
		).rejects.toThrow(/certificate/i);
	});

	it('accepts a self-signed certificate when allowed and stays on HTTPS', async () => {
		await runNode({ credentials: tokenCredentials(server, { allowSelfSigned: true }), params: { resource: 'node', operation: 'getMany' } });
		expect(sentRequests.every((r) => r.url.startsWith('https://'))).toBe(true);
		expect(server.requests.length).toBeGreaterThan(0);
	});

	it('never downgrades: http base URLs are refused unless explicitly allowed', async () => {
		const http = server.url.replace('https://', 'http://');
		await expect(
			runNode({ credentials: tokenCredentials(server, { baseUrl: http }), params: { resource: 'node', operation: 'getMany' } }),
		).rejects.toThrow(/http/i);
		expect(sentRequests).toHaveLength(0);
	});

	it('rejects base URLs with credentials, query or fragment', async () => {
		for (const baseUrl of ['https://user:pw@127.0.0.1:8006', 'https://127.0.0.1:8006/?x=1', 'https://127.0.0.1:8006/#a']) {
			await expect(runNode({ credentials: tokenCredentials(server, { baseUrl }), params: { resource: 'node', operation: 'getMany' } })).rejects.toThrow();
		}
		expect(sentRequests).toHaveLength(0);
	});

	it('strips trailing slashes from the base URL', async () => {
		await runNode({ credentials: tokenCredentials(server, { baseUrl: `${server.url}///` }), params: { resource: 'node', operation: 'getMany' } });
		expect(sentRequests[0].url).toBe(`${server.url}/api2/json/nodes`);
	});

	it('does not follow redirects to another host', async () => {
		const ctx = executeContext({ credentials: tokenCredentials(server), params: {} });
		const client = await ProxmoxClient.create(ctx as never);
		await expect(client.get('/redirect-me')).rejects.toThrow(/redirect/i);
		expect(trap.hits).toHaveLength(0);
	});
});

describe('limits', () => {
	it('aborts responses larger than the limit', async () => {
		const ctx = executeContext({ credentials: tokenCredentials(server), params: {} });
		const client = await ProxmoxClient.create(ctx as never);
		await expect(client.get('/nodes/pve1/syslog', {}, { maxBytes: 64 * 1024 })).rejects.toThrow(/too large/i);
	});

	it('times out slow requests', async () => {
		const ctx = executeContext({ credentials: tokenCredentials(server), params: {} });
		const client = await ProxmoxClient.create(ctx as never);
		await expect(client.get('/nodes/pve1/journal', {}, { timeoutMs: 300 })).rejects.toThrow(/timed out/i);
	});
});

describe('errors', () => {
	it('turns Proxmox errors into NodeOperationError with parameter details', async () => {
		const err = await runNode({
			credentials: tokenCredentials(server),
			params: { resource: 'node', operation: 'getNetworkInterfaces', node: 'pve1', ifaceType: 'bridge' },
		}).catch((e: Error & { description?: string }) => e);
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toMatch(/400.*Parameter verification failed/);
		expect((err as { description?: string }).description).toMatch(/type: value 'foo'/);
	});

	it('returns { error } with continueOnFail and keeps pairedItem', async () => {
		const out = await runNode({
			credentials: tokenCredentials(server),
			continueOnFail: true,
			params: [
				{ resource: 'node', operation: 'getNetworkInterfaces', node: 'pve1' },
				{ resource: 'node', operation: 'getStatus', node: 'pve1' },
			],
		});
		expect(out[0].json.error).toMatch(/400/);
		expect(out[0].pairedItem).toEqual({ item: 0 });
		expect(out[1].json.uptime).toBe(100);
		expect(out[1].pairedItem).toEqual({ item: 1 });
	});

	it('never exposes token, password, ticket or CSRF token in errors (also with continueOnFail)', async () => {
		for (const credentials of [tokenCredentials(server), passwordCredentials(server)]) {
			const out = await runNode({
				credentials,
				continueOnFail: true,
				params: { resource: 'node', operation: 'getCertificates', node: 'pve1' },
			});
			const text = JSON.stringify(out);
			expect(text).not.toContain(TOKEN_SECRET);
			expect(text).not.toContain(TICKET);
			expect(text).not.toContain(PASSWORD);
			expect(text).not.toContain(CSRF);
			expect(text).toContain('REDACTED');
			const thrown = await runNode({ credentials, params: { resource: 'node', operation: 'getCertificates', node: 'pve1' } }).catch(
				(e: Error) => e,
			);
			expect(JSON.stringify({ m: (thrown as Error).message, d: (thrown as { description?: string }).description })).not.toContain(TOKEN_SECRET);
			expect((thrown as Error).message).not.toContain(TICKET);
		}
	});
});
