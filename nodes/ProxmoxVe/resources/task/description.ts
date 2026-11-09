import type { INodeProperties } from 'n8n-workflow';

import { commonOptions, nodeLocator } from '../../shared/descriptions';

const R = 'task';
const show = (ops: string[]) => ({ resource: [R], operation: ops });

export const taskListOps = ['getMany', 'getLog'];

const UPID_OPS = ['getStatus', 'getLog', 'stop', 'waitForCompletion'];
const SEARCH_OPS = ['getMany', 'getLast'];

export const taskDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'getMany',
		options: [
			{ name: 'Get Last', value: 'getLast', action: 'Get the most recent matching task', description: 'Return the most recent task that matches the filters, e.g. the last vzdump backup of a VM' },
			{ name: 'Get Log', value: 'getLog', action: 'Get the log of a task', description: 'Read the log lines of a task' },
			{ name: 'Get Many', value: 'getMany', action: 'Get many tasks', description: 'List recent tasks, newest first, filtered by node, type, VMID, user, errors, running state and time range' },
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
		description:
			'Task ID: the "upid" field returned by asynchronous operations (e.g. VM Start, Backup Create) or by Task → Get Many / Get Last. The node is taken from the UPID.',
		displayOptions: { show: show(UPID_OPS) },
	},
	nodeLocator(show(SEARCH_OPS), {
		name: 'filterNode',
		required: false,
		description: 'Only tasks of this node (leave empty for the whole cluster). With a node, older finished tasks are found too.',
	}),
	{
		displayName: 'Filters',
		name: 'taskFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: show(SEARCH_OPS) },
		options: [
			{ displayName: 'Errors Only', name: 'errorsOnly', type: 'boolean', default: false, description: 'Whether to return only finished tasks that failed' },
			{ displayName: 'Running Only', name: 'runningOnly', type: 'boolean', default: false, description: 'Whether to return only tasks that are still running' },
			{ displayName: 'Since', name: 'since', type: 'dateTime', default: '', description: 'Only tasks started at or after this time' },
			{ displayName: 'Type', name: 'type', type: 'string', default: '', placeholder: 'vzdump', description: 'Task type, e.g. vzdump (backup), qmstart, qmigrate, vzstart' },
			{ displayName: 'Until', name: 'until', type: 'dateTime', default: '', description: 'Only tasks started at or before this time' },
			{ displayName: 'User', name: 'user', type: 'string', default: '', placeholder: 'root@pam', description: 'Only tasks started by this user (also matches its API tokens)' },
			{ displayName: 'VMID', name: 'vmid', type: 'number', default: 0, description: 'Only tasks of this guest (0 = all)' },
		],
	},
	{
		displayName: 'Limit',
		name: 'limit',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1, maxValue: 1000 },
		description: 'Max number of results to return',
		displayOptions: { show: show(['getMany']) },
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
