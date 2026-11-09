/**
 * Minimal fake Proxmox VE API server (HTTPS, self-signed certificate) for tests.
 * It checks the API token header, the ticket cookie and the CSRF token like Proxmox VE does.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import selfsigned from 'selfsigned';

/**
 * Generates a throw-away self-signed certificate for 127.0.0.1/localhost in a temporary
 * directory. Nothing is stored in the repository; the directory is removed right away.
 */
async function generateTls(): Promise<{ key: Buffer; cert: Buffer }> {
	const dir = mkdtempSync(join(tmpdir(), 'pve-test-tls-'));
	try {
		const now = new Date();
		const pems = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
			keyType: 'ec',
			notBeforeDate: new Date(now.getTime() - 60_000),
			notAfterDate: new Date(now.getTime() + 24 * 60 * 60_000),
			extensions: [
				{
					name: 'subjectAltName',
					altNames: [
						{ type: 2, value: 'localhost' },
						{ type: 7, ip: '127.0.0.1' },
					],
				},
			],
		});
		writeFileSync(join(dir, 'key.pem'), pems.private, { mode: 0o600 });
		writeFileSync(join(dir, 'cert.pem'), pems.cert);
		return { key: readFileSync(join(dir, 'key.pem')), cert: readFileSync(join(dir, 'cert.pem')) };
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

export const TLS = await generateTls();

export const TOKEN_ID = 'n8n@pve!test';
export const TOKEN_SECRET = '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0';
export const USERNAME = 'n8n@pve';
export const PASSWORD = 'Sup3r-S3cret-Pa55';
export const TICKET = 'PVE:n8n@pve:6789ABCD::QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVo0NTY3ODk=';
export const CSRF = '6789ABCD:Q3NyZlRva2VuVmFsdWUwMTIzNDU2Nzg5';

export interface RecordedRequest {
	method: string;
	/** Path below /api2/json, without query string */
	path: string;
	query: URLSearchParams;
	headers: Record<string, string | string[] | undefined>;
	body: string;
	form: URLSearchParams;
}

export interface Reply {
	status?: number;
	statusMessage?: string;
	data?: unknown;
	errors?: Record<string, string>;
	/** Raw body (overrides data) */
	raw?: string;
	headers?: Record<string, string>;
	delayMs?: number;
	/** Low-level response (e.g. slow streaming); replaces the JSON reply. */
	stream?: (res: import('node:http').ServerResponse) => void;
}

export type Handler = (req: RecordedRequest, params: Record<string, string>) => Reply | Promise<Reply>;

interface Route {
	method: string;
	regex: RegExp;
	names: string[];
	handler: Handler;
}

export interface FakeTask {
	node: string;
	pollsUntilDone: number;
	exitstatus: string;
	log?: string[];
}

let upidCounter = 0x100;

export function makeUpid(node: string, type: string, id = '', user = 'n8n@pve!test'): string {
	upidCounter++;
	const hex = (n: number) => n.toString(16).toUpperCase().padStart(8, '0');
	return `UPID:${node}:${hex(upidCounter)}:${hex(upidCounter * 7)}:${hex(1767225600 + upidCounter)}:${type}:${id}:${user}:`;
}

export class FakeProxmox {
	readonly requests: RecordedRequest[] = [];

	/** Time (ms since epoch) at which the client connection of each request path was closed. */
	readonly socketClosedAt = new Map<string, number>();

	readonly tasks = new Map<string, FakeTask>();

	private routes: Route[] = [];

	private server: https.Server;

	/** When set, every request is answered with 403 (except login). */
	forbidAll = false;

	constructor() {
		this.server = https.createServer({ ...TLS }, (req, res) => {
			const chunks: Buffer[] = [];
			req.on('data', (c: Buffer) => chunks.push(c));
			req.on('end', () => {
				void this.handle(req, res, Buffer.concat(chunks));
			});
		});
		this.installDefaults();
	}

	async start(): Promise<this> {
		await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
		return this;
	}

	async stop(): Promise<void> {
		this.server.closeAllConnections();
		await new Promise<void>((resolve) => this.server.close(() => resolve()));
	}

	get port(): number {
		return (this.server.address() as AddressInfo).port;
	}

	get url(): string {
		return `https://127.0.0.1:${this.port}`;
	}

	on(method: string, pattern: string, handler: Handler): this {
		const names: string[] = [];
		const regex = new RegExp(
			`^${pattern.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{([^}]+)\\?\}/g, (_m, n: string) => {
				names.push(n);
				return '([^/]+)';
			})}$`,
		);
		// Later registrations take precedence
		this.routes.unshift({ method, regex, names, handler });
		return this;
	}

	/** Registers a task that finishes after `polls` status requests. */
	addTask(node: string, type: string, id = '', exitstatus = 'OK', polls = 1, log?: string[]): string {
		const upid = makeUpid(node, type, id);
		this.tasks.set(upid, { node, pollsUntilDone: polls, exitstatus, log });
		return upid;
	}

	requestsTo(method: string, path: string): RecordedRequest[] {
		return this.requests.filter((r) => r.method === method && r.path === path);
	}

	private installDefaults(): void {
		this.on('POST', '/access/ticket', (req) => {
			let username = req.form.get('username');
			let password = req.form.get('password');
			if (!username && req.body.startsWith('{')) {
				const json = JSON.parse(req.body) as { username?: string; password?: string };
				username = json.username ?? null;
				password = json.password ?? null;
			}
			if (username === USERNAME && password === PASSWORD) {
				return { data: { ticket: TICKET, CSRFPreventionToken: CSRF, username: USERNAME } };
			}
			return { status: 401, statusMessage: 'authentication failure' };
		});
		this.on('GET', '/version', () => ({ data: { version: '9.2.9', release: '9.2', repoid: 'abcdef12' } }));
		this.on('GET', '/nodes/{node}/tasks/{upid}/status', (_req, p) => {
			const t = this.tasks.get(p.upid);
			if (!t) return { status: 500, statusMessage: 'no such task' };
			if (t.pollsUntilDone > 0) {
				t.pollsUntilDone--;
				return { data: { upid: p.upid, node: t.node, status: 'running', type: p.upid.split(':')[5] } };
			}
			return { data: { upid: p.upid, node: t.node, status: 'stopped', exitstatus: t.exitstatus, type: p.upid.split(':')[5] } };
		});
		this.on('GET', '/nodes/{node}/tasks/{upid}/log', (_req, p) => {
			const t = this.tasks.get(p.upid);
			return { data: (t?.log ?? ['task started', 'task finished']).map((line, i) => ({ n: i + 1, t: line })) };
		});
	}

	private isAuthorized(req: RecordedRequest): { ok: boolean; reason?: string } {
		const auth = req.headers.authorization;
		if (typeof auth === 'string') {
			return auth === `PVEAPIToken=${TOKEN_ID}=${TOKEN_SECRET}` ? { ok: true } : { ok: false, reason: 'invalid token value!' };
		}
		const cookie = String(req.headers.cookie ?? '');
		if (cookie.includes(`PVEAuthCookie=${TICKET}`)) {
			if (req.method !== 'GET' && req.headers.csrfpreventiontoken !== CSRF) {
				return { ok: false, reason: 'Permission denied - invalid csrf token' };
			}
			return { ok: true };
		}
		return { ok: false, reason: 'No ticket' };
	}

	private async handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, raw: Buffer) {
		const url = new URL(req.url ?? '/', 'https://localhost');
		const prefix = '/api2/json';
		const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) || '/' : url.pathname;
		const body = raw.toString('utf8');
		const contentType = String(req.headers['content-type'] ?? '');
		const recorded: RecordedRequest = {
			method: String(req.method),
			path,
			query: url.searchParams,
			headers: req.headers,
			body,
			form: contentType.includes('application/x-www-form-urlencoded') ? new URLSearchParams(body) : new URLSearchParams(),
		};
		this.requests.push(recorded);
		req.socket.once('close', () => this.socketClosedAt.set(path, Date.now()));

		const send = (reply: Reply) => {
			const status = reply.status ?? 200;
			const payload =
				reply.raw !== undefined
					? reply.raw
					: JSON.stringify(status >= 400 ? { data: null, ...(reply.errors ? { errors: reply.errors } : {}) } : { data: reply.data ?? null });
			res.writeHead(status, reply.statusMessage ?? (status === 200 ? 'OK' : 'Error'), {
				'Content-Type': 'application/json;charset=UTF-8',
				...(reply.headers ?? {}),
			});
			res.end(payload);
		};

		if (!url.pathname.startsWith(prefix)) return send({ status: 404, statusMessage: 'Not Found' });
		const isLogin = recorded.method === 'POST' && path === '/access/ticket';
		if (!isLogin) {
			const auth = this.isAuthorized(recorded);
			if (!auth.ok) return send({ status: 401, statusMessage: auth.reason });
			if (this.forbidAll) return send({ status: 403, statusMessage: 'Permission check failed (/, Sys.Audit)' });
		}
		for (const route of this.routes) {
			if (route.method !== recorded.method) continue;
			const m = route.regex.exec(path);
			if (!m) continue;
			const params: Record<string, string> = {};
			route.names.forEach((n, i) => (params[n] = decodeURIComponent(m[i + 1])));
			const reply = await route.handler(recorded, params);
			if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
			if (reply.stream) return reply.stream(res);
			return send(reply);
		}
		return send({ status: 501, statusMessage: `Method '${recorded.method} ${path}' not implemented` });
	}
}

/** A second HTTPS server that must never receive anything (redirect target). */
export class Trap {
	readonly hits: Array<{ url: string; headers: Record<string, unknown> }> = [];

	private server = https.createServer({ ...TLS }, (req, res) => {
		this.hits.push({ url: String(req.url), headers: req.headers });
		res.writeHead(200, { 'Content-Type': 'application/json' });
		res.end('{"data":"stolen"}');
	});

	async start(): Promise<this> {
		await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
		return this;
	}

	get url(): string {
		return `https://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
	}

	async stop(): Promise<void> {
		this.server.closeAllConnections();
		await new Promise<void>((resolve) => this.server.close(() => resolve()));
	}
}
