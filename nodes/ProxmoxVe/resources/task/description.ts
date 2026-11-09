import type { INodeProperties } from 'n8n-workflow';

import { commonOptions } from '../../shared/descriptions';

const R = 'task';
const show = (ops: string[]) => ({ resource: [R], operation: ops });

export const taskListOps = ['getLog'];

export const taskDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'getStatus',
		options: [
			{ name: 'Get Log', value: 'getLog', action: 'Get the log of a task', description: 'Read the log lines of a task' },
			{ name: 'Get Status', value: 'getStatus', action: 'Get the status of a task', description: 'Read status and exit status of a task' },
			{ name: 'Stop', value: 'stop', action: 'Stop a task', description: 'DESTRUCTIVE: aborts a running task (e.g. a backup or migration), which may leave it incomplete. Use only on explicit request.' },
			{ name: 'Wait For Completion', value: 'waitForCompletion', action: 'Wait for a task to finish', description: 'Wait until a task finishes and return its status; fails if the task fails' },
		],
	},
	{
		displayName: 'Task ID (UPID)',
		name: 'upid',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'UPID:pve1:000ABCDE:0123ABCD:65A1B2C3:qmstart:100:root@pam:',
		description: 'The node is taken from the UPID',
		displayOptions: { show: { resource: [R] } },
	},
	{
		displayName: 'Log Options',
		name: 'logOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['getLog']) },
		options: [
			{ displayName: 'Limit', name: 'limit', type: 'number', default: 50, typeOptions: { minValue: 1 }, description: 'Max number of results to return' },
			{ displayName: 'Start', name: 'start', type: 'number', default: 0, description: 'First line to return' },
		],
	},
	{
		displayName: 'Wait Options',
		name: 'taskWaitOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['waitForCompletion']) },
		options: [
			{ displayName: 'Poll Interval (Seconds)', name: 'pollInterval', type: 'number', default: 2, typeOptions: { minValue: 1 } },
			{ displayName: 'Timeout (Seconds)', name: 'timeout', type: 'number', default: 3600, typeOptions: { minValue: 1, maxValue: 86400 }, description: 'Maximum wait (max 86400 = 24 h)' },
		],
	},
	...commonOptions(R, [], taskListOps),
];
