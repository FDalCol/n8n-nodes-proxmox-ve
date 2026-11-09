/**
 * Credential test: the declarative test request is evaluated like n8n does (expressions resolved
 * with $credentials, authenticate() applied, response codes mapped by the rules).
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';

import type { ICredentialDataDecryptedObject, IDataObject, IHttpRequestOptions } from 'n8n-workflow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FakeProxmox } from './helpers/fakeProxmox';
import { credentialType, evalCredentialExpression, passwordCredentials, tokenCredentials } from './helpers/harness';

const requireCjs = createRequire(import.meta.url);
const { httpRequest } = requireCjs(
	join(process.cwd(), 'node_modules', '@n8n', 'backend-network', 'dist', 'http', 'axios', 'request.js'),
) as { httpRequest: (o: IHttpRequestOptions) => Promise<{ statusCode: number; body: IDataObject }> };

let server: FakeProxmox;

beforeAll(async () => {
	server = await new FakeProxmox().start();
});
afterAll(async () => server.stop());

async function testCredential(credentials: ICredentialDataDecryptedObject): Promise<{ status: 'OK' | 'Error'; message: string }> {
	const req = credentialType.test.request as IDataObject;
	const resolved: IDataObject = {};
	for (const [k, v] of Object.entries(req)) resolved[k] = evalCredentialExpression(v, credentials);
	const options = {
		...(resolved as unknown as IHttpRequestOptions),
		url: `${String(resolved.baseURL)}${String(resolved.url)}`,
		baseURL: undefined,
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
	};
	const authenticate = credentialType.authenticate as (c: ICredentialDataDecryptedObject, o: IHttpRequestOptions) => Promise<IHttpRequestOptions>;
	try {
		const res = await httpRequest(await authenticate(credentials, options));
		if (res.statusCode >= 200 && res.statusCode < 300 && res.body && typeof res.body === 'object' && 'data' in res.body) {
			return { status: 'OK', message: 'Connection tested successfully' };
		}
		const rule = credentialType.test.rules?.find((r) => r.type === 'responseCode' && r.properties.value === res.statusCode);
		return { status: 'Error', message: rule ? rule.properties.message : `HTTP ${res.statusCode}` };
	} catch (error) {
		return { status: 'Error', message: (error as Error).message };
	}
}

describe('credential test', () => {
	it('succeeds with a valid API token (GET /version)', async () => {
		server.requests.length = 0;
		expect(await testCredential(tokenCredentials(server))).toEqual({ status: 'OK', message: expect.any(String) });
		expect(server.requests[0]).toMatchObject({ method: 'GET', path: '/version' });
	});

	it('succeeds with valid username/password (login, credentials in the body)', async () => {
		server.requests.length = 0;
		expect((await testCredential(passwordCredentials(server))).status).toBe('OK');
		expect(server.requests[0]).toMatchObject({ method: 'POST', path: '/access/ticket' });
		expect(server.requests[0].query.toString()).toBe('');
	});

	it('reports 401 clearly', async () => {
		expect(await testCredential(tokenCredentials(server, { tokenSecret: 'bad' }))).toEqual({ status: 'Error', message: expect.stringMatching(/Authentication failed \(401\)/) });
		expect(await testCredential(passwordCredentials(server, { password: 'bad' }))).toEqual({ status: 'Error', message: expect.stringMatching(/401/) });
	});

	it('reports 403 clearly', async () => {
		server.forbidAll = true;
		try {
			expect(await testCredential(tokenCredentials(server))).toEqual({ status: 'Error', message: expect.stringMatching(/Permission denied \(403\)/) });
		} finally {
			server.forbidAll = false;
		}
	});

	it('fails on an untrusted certificate unless self-signed certificates are allowed', async () => {
		const res = await testCredential(tokenCredentials(server, { allowSelfSigned: false }));
		expect(res.status).toBe('Error');
		expect(res.message).toMatch(/certificate/i);
	});

	it('never contacts a server over plain http unless explicitly allowed', async () => {
		server.requests.length = 0;
		const http = server.url.replace('https://', 'http://');
		const req = credentialType.test.request as IDataObject;
		expect(evalCredentialExpression(req.baseURL, tokenCredentials(server, { baseUrl: http }))).toMatch(/^https:\/\/base-url-must-use-https.*\.invalid$/);
		expect(evalCredentialExpression(req.baseURL, tokenCredentials(server, { baseUrl: `https://u:p@127.0.0.1` }))).toMatch(/\.invalid$/);
		expect(evalCredentialExpression(req.baseURL, tokenCredentials(server, { baseUrl: `${server.url}/` }))).toBe(`${server.url}/api2/json`);
		expect(evalCredentialExpression(req.baseURL, tokenCredentials(server, { baseUrl: http, allowHttp: true }))).toBe(`${http}/api2/json`);
	});
});
