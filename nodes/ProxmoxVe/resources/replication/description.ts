import type { INodeProperties } from 'n8n-workflow';

import { commonOptions } from '../../shared/descriptions';

const R = 'replication';
const show = (ops: string[]) => ({ resource: [R], operation: ops });

export const replicationAsyncOps = ['runNow'];
export const replicationListOps = ['getMany'];

const jobFields: INodeProperties['options'] = [
	{ displayName: 'Comment', name: 'comment', type: 'string', default: '' },
	{ displayName: 'Disable', name: 'disable', type: 'boolean', default: false },
	{ displayName: 'Rate Limit (MB/s)', name: 'rate', type: 'number', default: 0 },
	{ displayName: 'Schedule', name: 'schedule', type: 'string', default: '', placeholder: '*/15', description: 'Calendar event (default every 15 minutes)' },
];

export const replicationDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'getMany',
		options: [
			{ name: 'Create', value: 'create', action: 'Create a replication job', description: 'Create a storage replication job for a guest' },
			{ name: 'Delete', value: 'delete', action: 'Delete a replication job', description: 'DESTRUCTIVE: mark a replication job for removal; replicated volumes on the target are removed unless "Keep" is set. Use only on explicit request.' },
			{ name: 'Get', value: 'get', action: 'Get a replication job', description: 'Read a replication job' },
			{ name: 'Get Many', value: 'getMany', action: 'Get many replication jobs', description: 'List replication jobs' },
			{ name: 'Run Now', value: 'runNow', action: 'Run a replication job now', description: 'Schedule a replication job to start as soon as possible' },
			{ name: 'Update', value: 'update', action: 'Update a replication job', description: 'Change a replication job' },
		],
	},
	{
		displayName: 'Job ID',
		name: 'jobId',
		type: 'string',
		default: '',
		required: true,
		placeholder: '100-0',
		description: 'Replication job ID in the format VMID-number, e.g. 100-0',
		displayOptions: { show: show(['get', 'create', 'update', 'delete', 'runNow']) },
	},
	{
		displayName: 'Target Node',
		name: 'target',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'pve2',
		displayOptions: { show: show(['create']) },
	},
	{
		displayName: 'Job Fields',
		name: 'jobFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['create', 'update']) },
		options: jobFields,
	},
	{
		displayName: 'Delete Options',
		name: 'deleteOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['delete']) },
		options: [
			{ displayName: 'Force', name: 'force', type: 'boolean', default: false, description: 'Whether to remove the job immediately without cleanup' },
			{ displayName: 'Keep Replicated Volumes', name: 'keep', type: 'boolean', default: false },
		],
	},
	...commonOptions(R, replicationAsyncOps, replicationListOps),
];
