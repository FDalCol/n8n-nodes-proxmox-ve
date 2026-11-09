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

const SAFE_PATH = /^[A-Za-z0-9\-._~:@!$&'()*+,;=%/]*$/;

/**
 * Validates a user supplied API path (Custom API Call, API Read).
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
	// Reject percent-encodings of '.', '/', '\' and '%' (also double encoded) and malformed escapes
	if (/%(2e|2f|5c|25|00)/i.test(path) || /%(?![0-9a-f]{2})/i.test(path)) {
		throw new SecurityError('Encoded path separators or traversal sequences are not allowed');
	}
	if (!path.startsWith('/')) path = `/${path}`;
	if (/^\/api2\/json(\/|$)/i.test(path)) path = path.slice('/api2/json'.length) || '/';
	if (/^\/api2(\/|$)/i.test(path)) throw new SecurityError('Only paths under /api2/json are allowed');
	if (path.includes('//')) throw new SecurityError('Empty path segments are not allowed');
	const segments = path.split('/');
	// Encoded dots and slashes are rejected above, so a literal check is sufficient here
	for (const seg of segments) {
		if (seg === '.' || seg === '..') {
			throw new SecurityError('Path traversal is not allowed');
		}
	}
	if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
	return path;
}

/**
 * Encodes a single path segment value (node name, VMID, volume ID, UPID ...).
 * Rejects empty values and "." / "..".
 */
export function encodeSegment(value: unknown, label = 'value'): string {
	const str = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : '';
	if (str === '') throw new SecurityError(`${label} is required`);
	if (str === '.' || str === '..') throw new SecurityError(`${label} is not valid`);
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

const SECRET_PATTERNS: RegExp[] = [
	/PVEAPIToken\s*[=:]\s*[^\s"',;]+/gi,
	/PVEAuthCookie\s*[=:]\s*[^\s"',;]+/gi,
	/CSRFPreventionToken["']?\s*[=:]\s*["']?[^\s"',;}]+/gi,
	/PVE:[^\s"',;]*::[A-Za-z0-9+/=]{20,}/g, // ticket format
	/("?(?:password|cipassword|ticket|secret|token-secret|tokensecret)"?\s*[:=]\s*)("[^"]*"|[^\s,;&}]+)/gi,
	/(Authorization\s*[:=]\s*)[^\r\n,;"]+/gi,
];

/**
 * Removes secrets from a string. Known secret values are replaced verbatim (also URL encoded),
 * well-known token formats are replaced by pattern.
 */
export function redactString(text: string, secrets: readonly string[] = []): string {
	let out = text;
	for (const secret of secrets) {
		if (!secret || secret.length < 4) continue;
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

/** Deep copy of a value with secret keys removed and secret values redacted. */
export function redactValue<T>(value: T, secrets: readonly string[] = [], depth = 0): T {
	if (depth > 32) return value;
	if (typeof value === 'string') return redactString(value, secrets) as unknown as T;
	if (Array.isArray(value)) return value.map((v) => redactValue(v, secrets, depth + 1)) as unknown as T;
	if (value && typeof value === 'object' && !Buffer.isBuffer(value)) {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
			if (SECRET_KEYS.has(k.toLowerCase()) && v !== null && v !== undefined && v !== '') {
				out[k] = REDACTED;
			} else {
				out[k] = redactValue(v, secrets, depth + 1);
			}
		}
		return out as T;
	}
	return value;
}
