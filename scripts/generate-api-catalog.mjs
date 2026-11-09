#!/usr/bin/env node
/**
 * Generates the API catalog used by the "API Read" resource and the parameter lists used to
 * validate "Additional Parameters", from the official Proxmox VE API schema (apidoc.js).
 *
 * Only paths, parameter names, types, enums and required flags are extracted. No description
 * text from apidoc.js is copied into the repository or the package.
 *
 * Usage:
 *   node scripts/generate-api-catalog.mjs             # regenerate from .cache/apidoc.js if present
 *   node scripts/generate-api-catalog.mjs --download  # download apidoc.js into .cache/ first
 *
 * When .cache/apidoc.js is missing and --download is not given, the committed generated files are
 * kept unchanged so the build works offline.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import https from 'node:https';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const cacheFile = join(root, '.cache', 'apidoc.js');
const outDir = join(root, 'nodes', 'ProxmoxVe', 'generated');
const SOURCE_URL = 'https://pve.proxmox.com/pve-docs/api-viewer/apidoc.js';

/** GET endpoints that only work as WebSocket upgrades and cannot be called over plain HTTP. */
const EXCLUDED_GET = /\/(vncwebsocket|mtunnelwebsocket)$/;

/** Write endpoints whose parameter names are used to validate "Additional Parameters". */
const WRITE_ENDPOINTS = [
	'POST /nodes/{node}/qemu',
	'POST /nodes/{node}/qemu/{vmid}/config',
	'POST /nodes/{node}/lxc',
	'PUT /nodes/{node}/lxc/{vmid}/config',
	'POST /nodes/{node}/vzdump',
	'POST /cluster/backup',
	'PUT /cluster/backup/{id}',
	'PUT /cluster/firewall/options',
	'PUT /nodes/{node}/firewall/options',
	'PUT /nodes/{node}/qemu/{vmid}/firewall/options',
	'PUT /nodes/{node}/lxc/{vmid}/firewall/options',
	'POST /cluster/firewall/rules',
	'PUT /cluster/firewall/rules/{pos}',
];

function download(url, dest) {
	return new Promise((resolve, reject) => {
		const req = https.get(url, { timeout: 60_000 }, (res) => {
			if (res.statusCode !== 200) {
				res.resume();
				reject(new Error(`Download failed: HTTP ${res.statusCode} (redirects are not followed)`));
				return;
			}
			const chunks = [];
			let size = 0;
			res.on('data', (c) => {
				size += c.length;
				if (size > 50 * 1024 * 1024) req.destroy(new Error('apidoc.js too large'));
				chunks.push(c);
			});
			res.on('end', () => {
				mkdirSync(dirname(dest), { recursive: true });
				writeFileSync(dest, Buffer.concat(chunks));
				resolve();
			});
		});
		req.on('timeout', () => req.destroy(new Error('Download timed out')));
		req.on('error', reject);
	});
}

/** Extracts the `apiSchema` array literal from apidoc.js without evaluating any code. */
function extractSchema(source) {
	const marker = 'apiSchema = ';
	const start = source.indexOf(marker);
	if (start < 0) throw new Error('apiSchema not found in apidoc.js');
	let i = start + marker.length;
	let depth = 0;
	let inString = false;
	let escaped = false;
	let end = -1;
	for (let j = i; j < source.length; j++) {
		const c = source[j];
		if (inString) {
			if (escaped) escaped = false;
			else if (c === '\\') escaped = true;
			else if (c === '"') inString = false;
			continue;
		}
		if (c === '"') inString = true;
		else if (c === '[' || c === '{') depth++;
		else if (c === ']' || c === '}') {
			depth--;
			if (depth === 0) {
				end = j + 1;
				break;
			}
		}
	}
	if (end < 0) throw new Error('Unterminated apiSchema literal');
	return JSON.parse(source.slice(i, end));
}

function collectProperties(parameters) {
	if (!parameters) return {};
	const props = { ...(parameters.properties ?? {}) };
	// Some endpoints (e.g. HA rules) use allOf/oneOf: merge all variants
	for (const part of parameters.allOf ?? []) {
		Object.assign(props, part.properties ?? {});
		for (const variant of part.oneOf ?? []) {
			for (const [name, p] of Object.entries(variant.properties ?? {})) {
				props[name] = props[name] ?? { ...p, optional: 1 };
			}
		}
	}
	for (const variant of parameters.oneOf ?? []) {
		for (const [name, p] of Object.entries(variant.properties ?? {})) {
			props[name] = props[name] ?? { ...p, optional: 1 };
		}
	}
	return props;
}

function compactParam(name, p, location) {
	const out = { n: name, t: String(p.type ?? 'string'), r: p.optional ? 0 : 1 };
	if (location) out.in = location;
	if (Array.isArray(p.enum)) out.e = p.enum.map(String);
	return out;
}

function main() {
	const args = process.argv.slice(2);
	return (async () => {
		if (args.includes('--download')) {
			process.stdout.write(`Downloading ${SOURCE_URL}\n`);
			await download(SOURCE_URL, cacheFile);
		}
		if (!existsSync(cacheFile)) {
			process.stdout.write('API catalog: .cache/apidoc.js not found, keeping committed generated files\n');
			if (!existsSync(join(outDir, 'apiCatalog.json'))) {
				throw new Error('Generated catalog missing: run "npm run generate:api -- --download"');
			}
			return;
		}
		const schema = extractSchema(readFileSync(cacheFile, 'utf8'));
		const endpoints = new Map();
		(function walk(nodes) {
			for (const n of nodes ?? []) {
				if (n.info) for (const [method, info] of Object.entries(n.info)) endpoints.set(`${method} ${n.path}`, info);
				walk(n.children);
			}
		})(schema);

		const catalog = [];
		for (const [key, info] of endpoints) {
			const [method, path] = key.split(' ');
			if (method !== 'GET' || EXCLUDED_GET.test(path)) continue;
			const pathParams = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
			const props = collectProperties(info.parameters);
			const params = [];
			for (const name of pathParams) params.push(compactParam(name, { type: 'string', ...(props[name] ?? {}), optional: 0 }, 'path'));
			for (const [name, p] of Object.entries(props).sort(([a], [b]) => a.localeCompare(b))) {
				if (pathParams.includes(name)) continue;
				params.push(compactParam(name, p, 'query'));
			}
			catalog.push({ p: path, params });
		}
		catalog.sort((a, b) => a.p.localeCompare(b.p));

		const writeParams = {};
		for (const key of WRITE_ENDPOINTS) {
			const info = endpoints.get(key);
			if (!info) throw new Error(`Endpoint not found in schema: ${key}`);
			const path = key.split(' ')[1];
			const pathParams = [...path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]);
			writeParams[key] = Object.entries(collectProperties(info.parameters))
				.filter(([name]) => !pathParams.includes(name))
				.sort(([a], [b]) => a.localeCompare(b))
				.map(([name, p]) => compactParam(name, p));
		}

		mkdirSync(outDir, { recursive: true });
		writeFileSync(join(outDir, 'apiCatalog.json'), JSON.stringify(catalog) + '\n');
		writeFileSync(join(outDir, 'writeParams.json'), JSON.stringify(writeParams) + '\n');
		process.stdout.write(`API catalog: ${catalog.length} GET endpoints, ${WRITE_ENDPOINTS.length} write parameter lists\n`);
	})();
}

main().catch((error) => {
	process.stderr.write(`${error.message}\n`);
	process.exit(1);
});
