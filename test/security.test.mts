import { describe, expect, it } from 'vitest';

import {
	apiPath,
	encodeSegment,
	normalizeBaseUrl,
	redactString,
	redactValue,
	validateApiPath,
} from '../nodes/ProxmoxVe/shared/security';
import { isUpid } from '../nodes/ProxmoxVe/shared/transport';
import { parseUpid } from '../nodes/ProxmoxVe/shared/tasks';

describe('normalizeBaseUrl', () => {
	it('accepts https and strips trailing slashes', () => {
		expect(normalizeBaseUrl('https://pve.example.com:8006///')).toEqual({ url: 'https://pve.example.com:8006', insecureHttp: false });
	});
	it('refuses http unless allowed, and never changes the scheme', () => {
		expect(() => normalizeBaseUrl('http://pve:8006')).toThrow(/Allow Insecure HTTP/);
		expect(normalizeBaseUrl('http://pve:8006', true)).toEqual({ url: 'http://pve:8006', insecureHttp: true });
	});
	it('refuses credentials, query, fragment, other schemes and /api2 paths', () => {
		for (const u of ['https://a:b@pve', 'https://pve/?a=1', 'https://pve/#x', 'ftp://pve', 'https://pve/api2/json', 'pve:8006', '']) {
			expect(() => normalizeBaseUrl(u)).toThrow();
		}
	});
});

describe('validateApiPath', () => {
	it('normalizes valid relative paths', () => {
		expect(validateApiPath('nodes/pve1/status')).toBe('/nodes/pve1/status');
		expect(validateApiPath('/api2/json/cluster/resources')).toBe('/cluster/resources');
		expect(validateApiPath('/nodes/pve1/tasks/UPID:pve1:0001:0002:0003:vzdump::root@pam:/status')).toMatch(/^\/nodes/);
	});
	it('rejects traversal, encoded traversal and absolute URLs', () => {
		for (const p of ['/a/../b', '/a/./b', '/a/%2e%2e/b', '/a/%2E%2e', '/a%2fb', '/a%5cb', '/a/%252e%252e', 'http://x/a', '//x/a', '/a?b', '/a#b', '/a b', '/a\\b', '/api2/extjs/x', '/a//b', '/a/%zz']) {
			expect(() => validateApiPath(p), p).toThrow();
		}
	});
});

describe('path building', () => {
	it('encodes every segment and rejects dot segments', () => {
		expect(apiPath`/nodes/${'pve1'}/storage/${'local'}/content/${'local:iso/x.iso'}`).toBe('/nodes/pve1/storage/local/content/local%3Aiso%2Fx.iso');
		expect(() => encodeSegment('..')).toThrow();
		expect(() => encodeSegment('')).toThrow();
		expect(() => encodeSegment('a\nb')).toThrow();
	});
});

describe('redaction', () => {
	it('removes known secrets and token formats', () => {
		const text = 'Authorization: PVEAPIToken=root@pam!x=1234-abcd; Cookie: PVEAuthCookie=PVE:root@pam:ABC::sig; CSRFPreventionToken: 123:abc password=hunter22 secret-value-42';
		const out = redactString(text, ['secret-value-42']);
		expect(out).not.toMatch(/1234-abcd|PVE:root@pam:ABC|123:abc|hunter22|secret-value-42/);
	});
	it('removes secret keys from objects', () => {
		expect(redactValue({ a: 1, password: 'x', nested: { ticket: 't', ok: 'fine' } })).toEqual({ a: 1, password: '[REDACTED]', nested: { ticket: '[REDACTED]', ok: 'fine' } });
	});
});

describe('UPID', () => {
	it('parses node and type', () => {
		const upid = 'UPID:pve1:0000ABCD:0012ABCD:65A1B2C3:vzdump:100:root@pam:';
		expect(isUpid(upid)).toBe(true);
		expect(parseUpid(upid)).toMatchObject({ node: 'pve1', type: 'vzdump', id: '100', user: 'root@pam' });
		expect(isUpid('UPID:../../:x')).toBe(false);
	});
});
