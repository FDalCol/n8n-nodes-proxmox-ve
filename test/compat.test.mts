/**
 * Every runtime value imported from n8n-workflow must exist in the oldest supported
 * n8n-workflow version (the devDependency, pinned to the version shipped with n8n 2.45.0).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const root = process.cwd();
const requireCjs = createRequire(import.meta.url);
const MIN_N8N_WORKFLOW = '2.45.0';

function sourceFiles(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) return sourceFiles(full);
		return full.endsWith('.ts') && !full.endsWith('.d.ts') ? [full] : [];
	});
}

/** Names imported as values (not `type`) from 'n8n-workflow'. */
function valueImports(): Map<string, string[]> {
	const used = new Map<string, string[]>();
	for (const file of [...sourceFiles(join(root, 'nodes')), ...sourceFiles(join(root, 'credentials'))]) {
		const src = readFileSync(file, 'utf8');
		for (const m of src.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+'n8n-workflow'/g)) {
			if (m[1]) continue;
			for (const raw of m[2].split(',')) {
				const spec = raw.trim();
				if (!spec || spec.startsWith('type ')) continue;
				const name = spec.split(/\s+as\s+/)[0].trim();
				used.set(name, [...(used.get(name) ?? []), file.slice(root.length + 1)]);
			}
		}
		expect(src, `${file} must not use namespace or default imports of n8n-workflow`).not.toMatch(
			/import\s+\*\s+as\s+\w+\s+from\s+'n8n-workflow'|import\s+\w+\s+from\s+'n8n-workflow'/,
		);
	}
	return used;
}

describe('n8n-workflow compatibility', () => {
	it('tests run against the minimum supported n8n-workflow version', () => {
		const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { devDependencies: Record<string, string> };
		expect(pkg.devDependencies['n8n-workflow']).toBe(MIN_N8N_WORKFLOW);
		expect((requireCjs('n8n-workflow/package.json') as { version: string }).version).toBe(MIN_N8N_WORKFLOW);
	});

	it('every value imported from n8n-workflow exists in the minimum version', () => {
		const workflow = requireCjs('n8n-workflow') as Record<string, unknown>;
		const used = valueImports();
		expect(used.size).toBeGreaterThan(0);
		const missing = [...used.keys()].filter((name) => workflow[name] === undefined);
		expect(missing, `missing in n8n-workflow ${MIN_N8N_WORKFLOW}: ${missing.map((n) => `${n} (${used.get(n)?.join(', ')})`).join('; ')}`).toEqual([]);
	});

	it('the built package only requires exports that exist in the minimum version', () => {
		const workflow = requireCjs('n8n-workflow') as Record<string, unknown>;
		const dist = join(root, 'dist');
		let files: string[] = [];
		try {
			files = sourceFilesJs(dist);
		} catch {
			return; // dist not built yet (npm test before npm run build)
		}
		const missing = new Set<string>();
		for (const file of files) {
			const src = readFileSync(file, 'utf8');
			const alias = /const (\w+) = require\("n8n-workflow"\)/.exec(src)?.[1];
			if (!alias) continue;
			for (const m of src.matchAll(new RegExp(`${alias}\\.(\\w+)`, 'g'))) {
				if (workflow[m[1]] === undefined) missing.add(`${m[1]} (${file.slice(root.length + 1)})`);
			}
		}
		expect([...missing]).toEqual([]);
	});
});

function sourceFilesJs(dir: string): string[] {
	return readdirSync(dir).flatMap((name) => {
		const full = join(dir, name);
		if (statSync(full).isDirectory()) return sourceFilesJs(full);
		return full.endsWith('.js') ? [full] : [];
	});
}
