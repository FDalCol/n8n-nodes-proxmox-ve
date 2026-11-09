import type { INodeProperties } from 'n8n-workflow';

import { commonOptions } from '../../shared/descriptions';

const R = 'backupJob';
const show = (ops: string[]) => ({ resource: [R], operation: ops });

export const backupJobAsyncOps = ['runNow'];
export const backupJobListOps = ['getMany'];

export const backupJobDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'getMany',
		options: [
			{ name: 'Get', value: 'get', action: 'Get a backup job', description: 'Read the definition of a scheduled backup job' },
			{ name: 'Get Many', value: 'getMany', action: 'Get many backup jobs', description: 'List scheduled backup jobs' },
			{ name: 'Run Now', value: 'runNow', action: 'Run a backup job now', description: 'Start a scheduled backup job immediately on all its online nodes (like "Run now" in the GUI). Returns one task per node.' },
		],
	},
	{
		displayName: 'Job Name or ID',
		name: 'jobId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getBackupJobs' },
		default: '',
		required: true,
		description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: { show: show(['get', 'runNow']) },
	},
	...commonOptions(R, backupJobAsyncOps, backupJobListOps),
];
