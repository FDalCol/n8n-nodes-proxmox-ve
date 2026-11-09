/**
 * Security helpers: base URL validation, API path validation and secret redaction.
 *
 * Every value that crosses into a request URL, an error message or an output item
 * goes through one of these functions.
 */

/** Overall timeout for a single API request (ms). */
export const REQUEST_TIMEOUT_MS = 30_000;
/** Timeout for binary uploads to a storage (ms). Uploads of ISO images can be large. */
export const UPLOAD_TIMEOUT_MS = 30 * 60_000;
/** Maximum accepted size of an API response body (bytes). */
export const MAX_RESPONSE_BYTES = 32 * 1024 * 1024;
/** Maximum number of polling iterations for any wait loop (hard stop). */
export const MAX_POLL_ITERATIONS = 100_000;
/** Maximum wait time for any wait loop (seconds): 24 hours. */
export const MAX_WAIT_SECONDS = 24 * 60 * 60;
/** Minimum polling interval for any wait loop (seconds). */
export const MIN_POLL_INTERVAL_SECONDS = 1;
/** Maximum number of items kept in trigger state. */
export const MAX_STATE_ENTRIES = 5000;
/** Maximum number of entries requested from list endpoints (log lines, journal, cluster log). */
export const MAX_LIST_ENTRIES = 10_000;

export class SecurityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SecurityError';
	}
}

export interface NormalizedBaseUrl {
	/** Origin plus optional path prefix, without trailing slash. */
	url: string;
	insecureHttp: boolean;
}

/**
 * Validates the base URL from the credential.
 * - https only, unless `allowHttp` is explicitly set (http is then used as typed, never upgraded or downgraded)
 * - no embedded credentials, query string or fragment
 * - trailing slashes removed
 */
export function normalizeBaseUrl(raw: unknown, allowHttp = false): NormalizedBaseUrl {
	if (typeof raw !== 'string' || raw.trim() === '') {
		throw new SecurityError('Base URL is required (e.g. https://pve.example.com:8006)');
	}
	const trimmed = raw.trim().replace(/\/+$/, '');
	if (!URL.canParse(trimmed)) {
		throw new SecurityError('Base URL is not a valid URL (e.g. https://pve.example.com:8006)');
	}
	const parsed = new URL(trimmed);
	const protocol = parsed.protocol.toLowerCase();
	if (protocol !== 'https:' && protocol !== 'http:') {
		throw new SecurityError('Base URL must start with https://');
	}
	if (protocol === 'http:' && !allowHttp) {
		throw new SecurityError(
			'Base URL uses http://. Use https:// or explicitly enable "Allow Insecure HTTP" in the credential',
		);
	}
	if (parsed.username !== '' || parsed.password !== '') {
		throw new SecurityError('Base URL must not contain credentials');
	}
	if (parsed.search !== '' || trimmed.includes('?')) {
		throw new SecurityError('Base URL must not contain a query string');
	}
	if (parsed.hash !== '' || trimmed.includes('#')) {
		throw new SecurityError('Base URL must not contain a fragment');
	}
	const path = parsed.pathname.replace(/\/+$/, '');
	if (/\/api2(\/|$)/i.test(path)) {
		throw new SecurityError('Base URL must not include /api2/json, only the server address');
	}
	if (path.split('/').some((s) => s === '..' || s === '.') || /%2e|%2f|%5c|\\/i.test(path)) {
		throw new SecurityError('Base URL path is not allowed');
	}
	return { url: `${protocol}//${parsed.host}${path}`, insecureHttp: protocol === 'http:' };
}

/** True when the string contains ASCII control characters (0-31, 127). */
export function hasControlChars(value: string): boolean {
	for (let i = 0; i < value.length; i++) {
		const c = value.charCodeAt(i);
		if (c < 32 || c === 127) return true;
	}
	return false;
}

// ';' is not allowed: it is never needed by the API and enables "..;" tricks on some proxies.
const SAFE_PATH = /^[A-Za-z0-9\-._~:@!$&'()*+,=%/]*$/;

/** Names that must never be used as parameter or object keys (prototype pollution). */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** True for a safe parameter name: not empty, not __proto__/constructor/prototype. */
export function isSafeKey(key: string): boolean {
	return key !== '' && !FORBIDDEN_KEYS.has(key.toLowerCase());
}

/**
 * True when a value, read as a path, contains a "." or ".." segment (also "..;x"), either
 * literally or after one round of percent-decoding ("%2e%2e", "%2F" ...).
 */
export function hasTraversal(value: string): boolean {
	const variants = [value];
	try {
		variants.push(decodeURIComponent(value));
	} catch {
		// not valid percent-encoding: only the raw value can be interpreted
	}
	return variants.some((v) => v.split(/[/\\]/).some((part) => /^\.\.?(;.*)?$/.test(part)));
}

/**
 * Percent-escapes allowed in Custom API Call paths: printable ASCII only, never ".", "/", "\",
 * "%" (double encoding) or ";". Bytes >= 0x80 (e.g. overlong UTF-8 "%c0%ae") are rejected.
 */
function hasForbiddenEscape(path: string): boolean {
	for (const m of path.matchAll(/%([0-9a-f]{2})/gi)) {
		const code = parseInt(m[1], 16);
		if (code < 0x20 || code >= 0x7f || [0x25, 0x2e, 0x2f, 0x3b, 0x5c].includes(code)) return true;
	}
	return /%(?![0-9a-f]{2})/i.test(path);
}

/**
 * Validates a user supplied API path (Custom API Call).
 * The path is relative to /api2/json. Absolute URLs, traversal (also encoded),
 * query strings, fragments and anything outside the API are rejected.
 * Returns the normalized path starting with "/".
 */
export function validateApiPath(raw: unknown): string {
	if (typeof raw !== 'string') throw new SecurityError('Path must be a string');
	let path = raw.trim();
	if (path === '') throw new SecurityError('Path is required');
	if (/^[a-z][a-z0-9+.-]*:/i.test(path) || path.startsWith('//')) {
		throw new SecurityError('Absolute URLs are not allowed, use a path relative to /api2/json');
	}
	if (hasControlChars(path) || /[\s\\]/.test(path)) {
		throw new SecurityError('Path contains forbidden characters');
	}
	if (path.includes('?') || path.includes('#')) {
		throw new SecurityError('Path must not contain a query string or fragment, use Query Parameters');
	}
	if (!SAFE_PATH.test(path)) throw new SecurityError('Path contains forbidden characters');
	// Reject encoded '.', '/', '\', '%' (double encoding), ';', non-ASCII bytes (overlong UTF-8) and malformed escapes
	if (hasForbiddenEscape(path)) {
		throw new SecurityError('Encoded path separators or traversal sequences are not allowed');
	}
	if (!path.startsWith('/')) path = `/${path}`;
	if (/^\/api2\/json(\/|$)/i.test(path)) path = path.slice('/api2/json'.length) || '/';
	if (/^\/api2(\/|$)/i.test(path)) throw new SecurityError('Only paths under /api2/json are allowed');
	if (path.includes('//')) throw new SecurityError('Empty path segments are not allowed');
	const segments = path.split('/');
	// Encoded dots and slashes are rejected above, so a literal check is sufficient here
	for (const seg of segments) {
		if (/^\.\.?(;.*)?$/.test(seg)) {
			throw new SecurityError('Path traversal is not allowed');
		}
	}
	if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
	return path;
}

/**
 * Encodes a single path segment value (node name, VMID, volume ID, UPID ...).
 * Rejects empty values and anything that contains a "." / ".." path part, literally or
 * percent-encoded ("pve/../..", "%2e%2e", "..;", "100/../../access").
 */
export function encodeSegment(value: unknown, label = 'value'): string {
	const str = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
	if (str === '') throw new SecurityError(`${label} is required`);
	if (hasTraversal(str)) throw new SecurityError(`${label} is not valid`);
	if (hasControlChars(str)) throw new SecurityError(`${label} contains control characters`);
	return encodeURIComponent(str);
}

/** Tagged template that builds an API path, encoding every interpolated value as one segment. */
export function apiPath(strings: TemplateStringsArray, ...values: unknown[]): string {
	let out = strings[0];
	values.forEach((v, idx) => {
		out += encodeSegment(v) + strings[idx + 1];
	});
	return out;
}

const NODE_NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;

export function validateNodeName(value: unknown): string {
	const str = typeof value === 'string' ? value.trim() : '';
	if (!NODE_NAME.test(str)) throw new SecurityError(`Invalid node name "${String(value).slice(0, 64)}"`);
	return str;
}

export function validateVmid(value: unknown): number {
	const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
	if (!Number.isInteger(n) || n < 100 || n > 999_999_999) {
		throw new SecurityError(`Invalid VMID "${String(value).slice(0, 32)}" (must be an integer between 100 and 999999999)`);
	}
	return n;
}

const STORAGE_ID = /^[a-z][a-z0-9\-_.]*[a-z0-9]$/i;

export function validateStorageId(value: unknown): string {
	const str = typeof value === 'string' ? value.trim() : '';
	if (!STORAGE_ID.test(str)) throw new SecurityError(`Invalid storage ID "${String(value).slice(0, 64)}"`);
	return str;
}

// ---------------------------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------------------------

export const REDACTED = '[REDACTED]';

// Every pattern is bounded so that redaction stays linear on large untrusted text (no ReDoS).
const SECRET_PATTERNS: RegExp[] = [
	/PVEAPIToken\s{0,8}[=:]\s{0,8}[^\s"',;]{1,512}/gi,
	/PVEAuthCookie\s{0,8}[=:]\s{0,8}[^\s"',;]{1,1024}/gi,
	/CSRFPreventionToken["']?\s{0,8}[=:]\s{0,8}["']?[^\s"',;}]{1,512}/gi,
	/PVE:[^\s"',;:]{1,256}:[0-9A-Fa-f]{8}::[A-Za-z0-9+/=]{20,2048}/g, // ticket: PVE:user@realm:TIME::signature
	/("?(?:password|cipassword|ticket|secret|token-secret|tokensecret)"?\s{0,8}[:=]\s{0,8})("[^"\n]{0,1024}"|[^\s,;&}"]{1,1024})/gi,
	/(Authorization\s{0,8}[:=]\s{0,8})[^\r\n,;"]{1,1024}/gi,
];

/**
 * Removes secrets from a string. Known secret values are replaced verbatim (also URL encoded),
 * well-known token formats are replaced by pattern.
 */
export function redactString(text: string, secrets: readonly string[] = []): string {
	let out = text;
	for (const secret of secrets) {
		if (!secret) continue;
		const variants = new Set([secret, encodeURIComponent(secret)]);
		for (const v of variants) out = out.split(v).join(REDACTED);
	}
	for (const re of SECRET_PATTERNS) {
		out = out.replace(re, (match, prefix?: string) =>
			typeof prefix === 'string' && match.startsWith(prefix) ? `${prefix}${REDACTED}` : REDACTED,
		);
	}
	return out;
}

const SECRET_KEYS = new Set([
	'password',
	'cipassword',
	'ticket',
	'csrfpreventiontoken',
	'secret',
	'tokensecret',
	'token-secret',
	'authorization',
	'cookie',
]);

/** Keys whose values are secrets (exact names, plus anything containing "password" or "secret"). */
function isSecretKey(key: string): boolean {
	const k = key.toLowerCase();
	return SECRET_KEYS.has(k) || k.includes('password') || k.includes('secret');
}

/** Deep copy of a value with secret keys removed and secret values redacted. */
export function redactValue<T>(value: T, secrets: readonly string[] = [], depth = 0): T {
	// Deeper structures are not returned unchecked: they are replaced
	if (depth > 32) return (value !== null && typeof value === 'object' ? '[TRUNCATED]' : redactValue(value, secrets, 0)) as T;
	if (typeof value === 'string') return redactString(value, secrets) as unknown as T;
	if (Array.isArray(value)) return value.map((v) => redactValue(v, secrets, depth + 1)) as unknown as T;
	if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
		const out: Record<string, unknown> = {};
		const entries = Object.entries(value as Record<string, unknown>);
		// Key/value lists such as cloud-init settings: [{ key: 'cipassword', value: '...', pending: '...' }]
		const keyField = (value as Record<string, unknown>).key;
		const sensitivePair = typeof keyField === 'string' && isSecretKey(keyField);
		for (const [k, v] of entries) {
			if (k === '__proto__') continue; // never copy a prototype from untrusted data
			const hide = isSecretKey(k) || (sensitivePair && (k === 'value' || k === 'pending'));
			if (hide && v !== null && v !== undefined && v !== '') {
				out[k] = REDACTED;
			} else {
				out[k] = redactValue(v, secrets, depth + 1);
			}
		}
		return out as T;
	}
	return value;
}
