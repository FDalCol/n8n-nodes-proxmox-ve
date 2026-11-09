/**
 * Test harness: minimal IExecuteFunctions / IPollFunctions implementations.
 * HTTP requests go through the real n8n request implementation (@n8n/backend-network),
 * after applying the credential's authenticate() exactly like n8n does.
 */
import { createRequire } from 'node:module';
import { join } from 'node:path';

import {
	NodeApiError,
	type ICredentialDataDecryptedObject,
	type IDataObject,
	type IHttpRequestOptions,
	type INode,
	type INodeExecutionData,
	type JsonObject,
} from 'n8n-workflow';

import { ProxmoxVeApi } from '../../credentials/ProxmoxVeApi.credentials';
import { ProxmoxVe } from '../../nodes/ProxmoxVe/ProxmoxVe.node';
import { ProxmoxVeTrigger } from '../../nodes/ProxmoxVeTrigger/ProxmoxVeTrigger.node';
import { PASSWORD, TOKEN_ID, TOKEN_SECRET, USERNAME, type FakeProxmox } from './fakeProxmox';

const requireCjs = createRequire(import.meta.url);
const { httpRequest } = requireCjs(
	join(process.cwd(), 'node_modules', '@n8n', 'backend-network', 'dist', 'http', 'axios', 'request.js'),
) as { httpRequest: (o: IHttpRequestOptions) => Promise<unknown> };

export type Params = Record<string, unknown>;

export function tokenCredentials(server: FakeProxmox, extra: IDataObject = {}): ICredentialDataDecryptedObject {
	return {
		baseUrl: server.url,
		authentication: 'apiToken',
		tokenId: TOKEN_ID,
		tokenSecret: TOKEN_SECRET,
		allowSelfSigned: true,
		allowHttp: false,
		...extra,
	};
}

export function passwordCredentials(server: FakeProxmox, extra: IDataObject = {}): ICredentialDataDecryptedObject {
	return {
		baseUrl: server.url,
		authentication: 'password',
		username: USERNAME,
		password: PASSWORD,
		allowSelfSigned: true,
		allowHttp: false,
		...extra,
	};
}

const credentialType = new ProxmoxVeApi();

export const sentRequests: IHttpRequestOptions[] = [];

/** Same flow as n8n-core: authenticate() then the outbound request; errors wrapped in NodeApiError. */
async function httpRequestWithAuthentication(
	node: INode,
	credentials: ICredentialDataDecryptedObject,
	options: IHttpRequestOptions,
): Promise<unknown> {
	const authenticate = credentialType.authenticate as (
		c: ICredentialDataDecryptedObject,
		o: IHttpRequestOptions,
	) => Promise<IHttpRequestOptions>;
	const authed = await authenticate(credentials, { ...options });
	sentRequests.push(authed);
	try {
		return await httpRequest(authed);
	} catch (error) {
		throw new NodeApiError(node, error as JsonObject);
	}
}

function getParam(params: Params, name: string, fallback: unknown, options?: { extractValue?: boolean }): unknown {
	let value = name in params ? params[name] : fallback;
	if (options?.extractValue && value && typeof value === 'object' && '__rl' in (value as IDataObject)) {
		value = (value as IDataObject).value;
	}
	return value;
}

const NODE: INode = {
	id: 'node-1',
	name: 'Proxmox VE',
	type: 'n8n-nodes-proxmox-ve.proxmoxVe',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

export interface RunOptions {
	credentials: ICredentialDataDecryptedObject;
	params: Params | Params[];
	items?: INodeExecutionData[];
	continueOnFail?: boolean;
	binary?: Record<string, { data: Buffer; fileName: string; mimeType?: string }>;
	/** Simulates the execution cancel signal of n8n. */
	cancelSignal?: AbortSignal;
}

export function executeContext(opts: RunOptions) {
	const items = opts.items ?? (Array.isArray(opts.params) ? opts.params.map(() => ({ json: {} })) : [{ json: {} }]);
	const paramsFor = (i: number): Params => (Array.isArray(opts.params) ? (opts.params[i] ?? {}) : opts.params);
	const ctx = {
		getInputData: () => items,
		getNode: () => NODE,
		getCredentials: async () => opts.credentials,
		continueOnFail: () => opts.continueOnFail === true,
		getExecutionCancelSignal: () => opts.cancelSignal,
		getNodeParameter: (name: string, i: number, fallback?: unknown, options?: { extractValue?: boolean }) =>
			getParam(paramsFor(i), name, fallback, options),
		helpers: {
			httpRequestWithAuthentication: async function (_type: string, o: IHttpRequestOptions) {
				return await httpRequestWithAuthentication(NODE, opts.credentials, o);
			},
			assertBinaryData: (_i: number, prop: string) => {
				const b = opts.binary?.[prop];
				if (!b) throw new Error(`No binary data property "${prop}"`);
				return { data: b.data.toString('base64'), fileName: b.fileName, mimeType: b.mimeType ?? 'application/octet-stream' };
			},
			getBinaryDataBuffer: async (_i: number, prop: string) => {
				const b = opts.binary?.[prop];
				if (!b) throw new Error(`No binary data property "${prop}"`);
				return b.data;
			},
		},
	};
	return ctx;
}

export async function runNode(opts: RunOptions): Promise<INodeExecutionData[]> {
	const node = new ProxmoxVe();
	const ctx = executeContext(opts);
	const result = await node.execute.call(ctx as never);
	return result[0];
}

export async function runNodeJson(opts: RunOptions): Promise<IDataObject[]> {
	return (await runNode(opts)).map((i) => i.json);
}

export interface PollOptions {
	credentials: ICredentialDataDecryptedObject;
	params: Params;
	mode?: 'manual' | 'trigger';
	staticData: IDataObject;
}

export async function poll(opts: PollOptions): Promise<IDataObject[] | null> {
	const trigger = new ProxmoxVeTrigger();
	const ctx = {
		getNode: () => ({ ...NODE, name: 'Proxmox VE Trigger', type: 'n8n-nodes-proxmox-ve.proxmoxVeTrigger' }),
		getMode: () => opts.mode ?? 'trigger',
		getCredentials: async () => opts.credentials,
		getWorkflowStaticData: () => opts.staticData,
		getNodeParameter: (name: string, fallback?: unknown) => getParam(opts.params, name, fallback),
		helpers: {
			httpRequestWithAuthentication: async function (_type: string, o: IHttpRequestOptions) {
				return await httpRequestWithAuthentication(NODE, opts.credentials, o);
			},
		},
	};
	const result = await trigger.poll.call(ctx as never);
	return result ? result[0].map((i) => i.json) : null;
}

/** Evaluates an n8n "={{ ... }}" expression of the credential test with $credentials. */
export function evalCredentialExpression(expr: unknown, credentials: ICredentialDataDecryptedObject): unknown {
	if (typeof expr !== 'string' || !expr.startsWith('={{')) return expr;
	const code = expr.slice(3, -2);
	// eslint-disable-next-line @typescript-eslint/no-implied-eval
	return new Function('$credentials', `return (${code});`)(credentials);
}

export { httpRequestWithAuthentication, NODE, credentialType };
