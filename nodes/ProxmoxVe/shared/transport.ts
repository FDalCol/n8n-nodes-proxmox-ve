import {
	NodeOperationError,
	sleep,
	type ICredentialDataDecryptedObject,
	type IDataObject,
	type IExecuteFunctions,
	type IHttpRequestMethods,
	type IHttpRequestOptions,
	type ILoadOptionsFunctions,
	type INode,
	type IPollFunctions,
} from 'n8n-workflow';

import {
	MAX_RESPONSE_BYTES,
	normalizeBaseUrl,
	redactString,
	redactValue,
	REQUEST_TIMEOUT_MS,
	SecurityError,
} from './security';

export const CREDENTIAL_NAME = 'proxmoxVeApi';

export type ProxmoxContext = IExecuteFunctions | ILoadOptionsFunctions | IPollFunctions;

export type ProxmoxMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface ProxmoxRequestOptions {
	/** Query string parameters (GET and DELETE). */
	qs?: IDataObject;
	/** Form parameters (POST and PUT), sent as application/x-www-form-urlencoded. */
	body?: IDataObject;
	/** Multipart body (uploads). */
	formData?: FormData;
	/** Overall timeout in ms (default 30 s). */
	timeoutMs?: number;
	/** Maximum response size in bytes. */
	maxBytes?: number;
}

export interface ProxmoxCredentials {
	baseUrl: string;
	insecureHttp: boolean;
	authentication: 'apiToken' | 'password';
	tokenId: string;
	tokenSecret: string;
	username: string;
	password: string;
	allowSelfSigned: boolean;
}

interface Session {
	ticket: string;
	csrf: string;
	createdAt: number;
}

interface RawResponse {
	statusCode: number;
	statusMessage: string;
	text: string;
}

/** Re-login after a 401 only when the ticket is older than this (tickets are valid for 2 h). */
const TICKET_REFRESH_AFTER_MS = 60 * 60_000;

export function parseCredentials(raw: ICredentialDataDecryptedObject): ProxmoxCredentials {
	const allowHttp = raw.allowHttp === true;
	const { url, insecureHttp } = normalizeBaseUrl(raw.baseUrl, allowHttp);
	const authentication = raw.authentication === 'password' ? 'password' : 'apiToken';
	const creds: ProxmoxCredentials = {
		baseUrl: url,
		insecureHttp,
		authentication,
		tokenId: String(raw.tokenId ?? '').trim(),
		tokenSecret: String(raw.tokenSecret ?? '').trim(),
		username: String(raw.username ?? '').trim(),
		password: String(raw.password ?? ''),
		allowSelfSigned: raw.allowSelfSigned === true,
	};
	if (authentication === 'apiToken') {
		if (!/^[^\s@!]+@[^\s@!]+![A-Za-z][A-Za-z0-9._-]*$/.test(creds.tokenId)) {
			throw new SecurityError('Token ID must have the format user@realm!tokenid');
		}
		if (creds.tokenSecret === '') throw new SecurityError('Token secret is required');
	} else {
		if (!/^[^\s@]+@[^\s@]+$/.test(creds.username)) {
			throw new SecurityError('Username must have the format user@realm (e.g. root@pam)');
		}
		if (creds.password === '') throw new SecurityError('Password is required');
	}
	return creds;
}

function serializeValue(value: unknown): string | string[] | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value === 'boolean') return value ? '1' : '0';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) {
		return value.map((v) => serializeValue(v)).filter((v): v is string => typeof v === 'string');
	}
	return JSON.stringify(value);
}

export function toFormParams(params: IDataObject = {}): URLSearchParams {
	const out = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		const v = serializeValue(value);
		if (v === undefined) continue;
		if (Array.isArray(v)) v.forEach((item) => out.append(key, item));
		else out.append(key, v);
	}
	return out;
}

export function toQueryParams(params: IDataObject = {}): IDataObject {
	const out: IDataObject = {};
	for (const [key, value] of Object.entries(params)) {
		const v = serializeValue(value);
		if (v !== undefined) out[key] = v;
	}
	return out;
}

/** Decodes the (already buffered) response body; the size is checked again as a safety net. */
function readBody(body: unknown, maxBytes: number): string {
	if (body === undefined || body === null) return '';
	if (typeof body === 'string') {
		if (Buffer.byteLength(body) > maxBytes) throw new SecurityError('Response too large');
		return body;
	}
	if (Buffer.isBuffer(body) || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
		const buf = Buffer.isBuffer(body)
			? body
			: body instanceof ArrayBuffer
				? Buffer.from(body)
				: Buffer.from(body.buffer, body.byteOffset, body.byteLength);
		if (buf.length > maxBytes) throw new SecurityError('Response too large');
		return buf.toString('utf8');
	}
	// Already parsed (should not happen with encoding "arraybuffer")
	return JSON.stringify(body);
}

function tooLargeMessage(maxBytes: number): string {
	return `Response too large (more than ${Math.round(maxBytes / 1024 / 1024)} MiB), aborted`;
}

function describeNetworkError(error: unknown): { message: string; description?: string } {
	const e = error as {
		code?: string;
		message?: string;
		description?: string;
		cause?: { code?: string; message?: string; cause?: { code?: string; message?: string } };
		context?: { data?: { code?: string } };
	};
	const haystack = [
		e?.code,
		e?.cause?.code,
		e?.cause?.cause?.code,
		e?.context?.data?.code,
		e?.message,
		e?.description,
		e?.cause?.message,
		e?.cause?.cause?.message,
	]
		.filter((x) => typeof x === 'string')
		.join(' ');
	if (/CERT|SELF_SIGNED|UNABLE_TO_VERIFY|UNABLE_TO_GET_ISSUER|certificate|ERR_TLS_CERT/i.test(haystack)) {
		return {
			message: 'TLS certificate of the Proxmox VE server is not trusted (self-signed, expired or wrong host name)',
			description:
				'Install a trusted certificate on Proxmox VE or enable "Allow Self-Signed Certificate" in the credential. The connection is never downgraded to HTTP.',
		};
	}
	if (/EPROTO|wrong version number|SSL routines|ERR_SSL/i.test(haystack)) {
		return {
			message: 'TLS handshake with the Proxmox VE server failed',
			description: 'Check that the Base URL uses https:// and the port serves HTTPS (default 8006).',
		};
	}
	if (/ECONNREFUSED/.test(haystack)) return { message: 'Connection refused by the Proxmox VE server', description: 'Check host and port of the Base URL.' };
	if (/ENOTFOUND|EAI_AGAIN/.test(haystack)) return { message: 'Proxmox VE host not found', description: 'Check the host name of the Base URL.' };
	if (/ETIMEDOUT|ECONNABORTED|timeout/i.test(haystack)) return { message: 'Request to Proxmox VE timed out' };
	if (/ECONNRESET|socket hang up/i.test(haystack)) return { message: 'Connection to Proxmox VE was reset' };
	if (/cancel|abort/i.test(haystack)) return { message: 'Request to Proxmox VE was cancelled' };
	return { message: 'Request to Proxmox VE failed', description: typeof e?.message === 'string' ? e.message : undefined };
}

function formatParamErrors(errors: unknown): string | undefined {
	if (!errors || typeof errors !== 'object') return undefined;
	const lines = Object.entries(errors as Record<string, unknown>).map(
		([param, msg]) => `${param}: ${typeof msg === 'string' ? msg.trim() : JSON.stringify(msg)}`,
	);
	return lines.length ? `Invalid parameters:\n${lines.join('\n')}` : undefined;
}

/**
 * HTTP client for one execution. Every request goes through
 * `helpers.httpRequestWithAuthentication` with redirects disabled, a hard timeout and a
 * response size limit. With Username/Password the client logs in once and keeps the ticket in memory.
 */
export class ProxmoxClient {
	private session: Session | undefined;

	private loginPromise: Promise<void> | undefined;

	private readonly secrets: string[] = [];

	constructor(
		private readonly ctx: ProxmoxContext,
		readonly credentials: ProxmoxCredentials,
	) {
		for (const s of [credentials.tokenSecret, credentials.password]) if (s) this.secrets.push(s);
		if (credentials.tokenId) this.secrets.push(`${credentials.tokenId}=${credentials.tokenSecret}`);
	}

	static async create(ctx: ProxmoxContext): Promise<ProxmoxClient> {
		const raw = await ctx.getCredentials(CREDENTIAL_NAME);
		try {
			return new ProxmoxClient(ctx, parseCredentials(raw));
		} catch (error) {
			throw new NodeOperationError(ctx.getNode(), (error as Error).message);
		}
	}

	get node(): INode {
		return this.ctx.getNode();
	}

	/** Known secret values, used for redaction. */
	getSecrets(): readonly string[] {
		return this.secrets;
	}

	redact(text: string): string {
		return redactString(text, this.secrets);
	}

	redactValue<T>(value: T): T {
		return redactValue(value, this.secrets);
	}

	error(message: string, description?: string): NodeOperationError {
		return new NodeOperationError(this.node, this.redact(message), {
			description: description ? this.redact(description) : undefined,
		});
	}

	async get<T = unknown>(path: string, qs?: IDataObject, opts: ProxmoxRequestOptions = {}): Promise<T> {
		return await this.request<T>('GET', path, { ...opts, qs });
	}

	async post<T = unknown>(path: string, body?: IDataObject, opts: ProxmoxRequestOptions = {}): Promise<T> {
		return await this.request<T>('POST', path, { ...opts, body });
	}

	async put<T = unknown>(path: string, body?: IDataObject, opts: ProxmoxRequestOptions = {}): Promise<T> {
		return await this.request<T>('PUT', path, { ...opts, body });
	}

	async delete<T = unknown>(path: string, qs?: IDataObject, opts: ProxmoxRequestOptions = {}): Promise<T> {
		return await this.request<T>('DELETE', path, { ...opts, qs });
	}

	/** Performs a request and returns the `data` member of the Proxmox VE response. */
	async request<T = unknown>(
		method: ProxmoxMethod,
		path: string,
		opts: ProxmoxRequestOptions = {},
	): Promise<T> {
		this.assertInternalPath(path);
		this.throwIfCancelled();
		if (this.credentials.authentication === 'password') await this.ensureSession();
		let res = await this.send(method, path, opts);
		if (
			res.statusCode === 401 &&
			this.credentials.authentication === 'password' &&
			this.session &&
			Date.now() - this.session.createdAt > TICKET_REFRESH_AFTER_MS &&
			!opts.formData
		) {
			this.session = undefined;
			await this.ensureSession();
			res = await this.send(method, path, opts);
		}
		return this.handleResponse<T>(res);
	}

	private assertInternalPath(path: string): void {
		if (
			!path.startsWith('/') ||
			path.startsWith('//') ||
			/[?#\\\s]/.test(path) ||
			path.split('/').some((s) => s === '.' || s === '..')
		) {
			throw this.error('Invalid API path');
		}
	}

	private async ensureSession(): Promise<void> {
		if (this.session) return;
		if (!this.loginPromise) {
			this.loginPromise = this.login().finally(() => {
				this.loginPromise = undefined;
			});
		}
		await this.loginPromise;
	}

	private async login(): Promise<void> {
		const res = await this.send(
			'POST',
			'/access/ticket',
			{ body: { username: this.credentials.username, password: this.credentials.password } },
			false,
		);
		if (res.statusCode === 401) {
			throw this.error('Login failed (401): check username (user@realm) and password');
		}
		const data = this.handleResponse<IDataObject>(res);
		if (data && (data.NeedTFA || (typeof data.ticket === 'string' && data.ticket.includes('!tfa!')))) {
			throw this.error(
				'Login requires two-factor authentication, which is not supported. Use an API token instead.',
			);
		}
		const ticket = typeof data?.ticket === 'string' ? data.ticket : '';
		const csrf = typeof data?.CSRFPreventionToken === 'string' ? data.CSRFPreventionToken : '';
		if (!ticket || !csrf) throw this.error('Login failed: the server did not return a ticket');
		this.secrets.push(ticket, csrf);
		this.session = { ticket, csrf, createdAt: Date.now() };
	}

	private async send(
		method: ProxmoxMethod,
		path: string,
		opts: ProxmoxRequestOptions,
		withSession = true,
	): Promise<RawResponse> {
		const headers: IDataObject = { Accept: 'application/json' };
		if (withSession && this.session) {
			headers.Cookie = `PVEAuthCookie=${this.session.ticket}`;
			if (method !== 'GET') headers.CSRFPreventionToken = this.session.csrf;
		}
		const timeoutMs = opts.timeoutMs ?? REQUEST_TIMEOUT_MS;
		const maxBytes = opts.maxBytes ?? MAX_RESPONSE_BYTES;
		// The response is buffered by n8n. This bounds the request without any timer of ours
		// (n8n 2.45 replaces a node-supplied abortSignal with the execution cancel signal):
		// - `timeout`: n8n closes the connection when the server sends nothing for timeoutMs,
		//   before or after the headers (with buffering it stays active until the body is complete);
		// - `maxResponseBodyBytes`: n8n closes the connection as soon as the body exceeds the limit.
		const options: IHttpRequestOptions = {
			method: method as IHttpRequestMethods,
			url: `${this.credentials.baseUrl}/api2/json${path}`,
			headers,
			encoding: 'arraybuffer',
			maxResponseBodyBytes: maxBytes,
			json: false,
			returnFullResponse: true,
			ignoreHttpStatusErrors: true,
			disableFollowRedirect: true,
			sendCredentialsOnCrossOriginRedirect: false,
			skipSslCertificateValidation: this.credentials.allowSelfSigned,
			timeout: timeoutMs,
			arrayFormat: 'repeat',
		};
		if (method === 'GET' || method === 'DELETE') {
			const qs = toQueryParams({ ...(opts.body ?? {}), ...(opts.qs ?? {}) });
			if (Object.keys(qs).length) options.qs = qs;
		} else if (opts.formData) {
			options.body = opts.formData;
		} else {
			const form = toFormParams(opts.body);
			if (opts.qs && Object.keys(opts.qs).length) options.qs = toQueryParams(opts.qs);
			if ([...form.keys()].length) options.body = form;
			else headers['Content-Type'] = 'application/x-www-form-urlencoded';
		}

		let response: { body?: unknown; statusCode?: number; statusMessage?: string };
		try {
			response = (await this.ctx.helpers.httpRequestWithAuthentication.call(
				this.ctx,
				CREDENTIAL_NAME,
				options,
			)) as typeof response;
		} catch (error) {
			const e = error as { code?: string; message?: string; cause?: { code?: string; message?: string } };
			const detail = `${e?.code ?? ''} ${e?.cause?.code ?? ''} ${e?.message ?? ''} ${e?.cause?.message ?? ''}`;
			if (/ERR_RESPONSE_TOO_LARGE|maximum allowed size|maxContentLength/i.test(detail)) {
				throw this.error(tooLargeMessage(maxBytes));
			}
			if (/ECONNABORTED|ETIMEDOUT|timeout of \d+ms exceeded/i.test(detail)) {
				throw this.error(`Request to Proxmox VE timed out after ${Math.round(timeoutMs / 1000)} s`);
			}
			const { message, description } = describeNetworkError(error);
			throw this.error(message, description);
		}
		const statusCode = Number(response?.statusCode ?? 0);
		if (statusCode >= 300 && statusCode < 400) {
			throw this.error(
				`The server answered with a redirect (HTTP ${statusCode}). Redirects are never followed.`,
				'Check that the Base URL points directly to the Proxmox VE API (https://host:8006).',
			);
		}
		let text: string;
		try {
			text = readBody(response?.body, maxBytes);
		} catch {
			throw this.error(tooLargeMessage(maxBytes));
		}
		return { statusCode, statusMessage: String(response?.statusMessage ?? ''), text };
	}

	/** True when the user cancelled the execution (n8n versions that expose the signal). */
	isCancelled(): boolean {
		const getSignal = (this.ctx as { getExecutionCancelSignal?: () => AbortSignal | undefined })
			.getExecutionCancelSignal;
		return typeof getSignal === 'function' && getSignal.call(this.ctx)?.aborted === true;
	}

	throwIfCancelled(): void {
		if (this.isCancelled()) throw this.error('Execution was cancelled');
	}

	/** Waits between polls; stops early when the execution is cancelled. */
	async pause(ms: number): Promise<void> {
		this.throwIfCancelled();
		await sleep(ms);
		this.throwIfCancelled();
	}

	private handleResponse<T>(res: RawResponse): T {
		let parsed: unknown;
		if (res.text.trim() !== '') {
			try {
				parsed = JSON.parse(res.text);
			} catch {
				parsed = undefined;
			}
		}
		if (res.statusCode < 200 || res.statusCode >= 300) {
			const body = (parsed ?? {}) as IDataObject;
			const reason =
				res.statusMessage.trim() ||
				(typeof body.message === 'string' ? body.message.trim() : '') ||
				'Request failed';
			const details = formatParamErrors(body.errors);
			let hint: string | undefined;
			if (res.statusCode === 401) {
				hint = 'Authentication failed: check the credential (token ID/secret or username/password).';
			} else if (res.statusCode === 403) {
				hint = 'Permission denied: the user or token lacks the privileges required by this endpoint.';
			} else if (res.statusCode === 501) {
				hint = 'The endpoint or method is not implemented by this Proxmox VE version.';
			}
			throw this.error(
				`Proxmox VE API error ${res.statusCode}: ${reason}`,
				[details, hint].filter(Boolean).join('\n') || undefined,
			);
		}
		if (parsed === undefined || parsed === null || typeof parsed !== 'object') {
			throw this.error(
				'Invalid response from the server (not a Proxmox VE API JSON response)',
				'Check that the Base URL points to the Proxmox VE API (https://host:8006).',
			);
		}
		return (parsed as { data?: T }).data as T;
	}
}

/** Returns true when the value looks like a Proxmox VE task ID (UPID). */
export function isUpid(value: unknown): value is string {
	return typeof value === 'string' && /^UPID:[^:\s]+:[0-9A-Fa-f]{8}:[0-9A-Fa-f]{8,}:[0-9A-Fa-f]{8}:[^:\s]*:[^:\s]*:[^:\s]+:$/.test(value);
}
