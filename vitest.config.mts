import { createRequire } from 'node:module';

import { defineConfig } from 'vitest/config';

const require = createRequire(import.meta.url);

export default defineConfig({
	resolve: {
		// Use the CommonJS build of n8n-workflow, like n8n does at runtime
		alias: { 'n8n-workflow': require.resolve('n8n-workflow') },
	},
	test: {
		include: ['test/**/*.test.mts'],
		testTimeout: 30_000,
		hookTimeout: 30_000,
		pool: 'forks',
		server: {
			deps: {
				external: [/node_modules/],
			},
		},
	},
});
