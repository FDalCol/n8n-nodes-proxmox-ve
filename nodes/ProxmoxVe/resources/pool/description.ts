import type { INodeProperties } from 'n8n-workflow';

import { commonOptions } from '../../shared/descriptions';

const R = 'pool';
const show = (ops: string[]) => ({ resource: [R], operation: ops });

export const poolListOps = ['getMany'];

export const poolDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'getMany',
		options: [
			{ name: 'Create', value: 'create', action: 'Create a pool', description: 'Create a resource pool' },
			{ name: 'Delete', value: 'delete', action: 'Delete a pool', description: 'DESTRUCTIVE: delete a resource pool (it must be empty). Permissions granted on the pool are lost. Use only on explicit request.' },
			{ name: 'Get Many', value: 'getMany', action: 'Get many pools', description: 'List resource pools, or one pool with its members' },
			{ name: 'Update', value: 'update', action: 'Update a pool', description: 'Change the comment or add/remove members of a pool' },
		],
	},
	{
		displayName: 'Pool ID',
		name: 'poolid',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: show(['create', 'update', 'delete']) },
	},
	{
		displayName: 'Filters',
		name: 'poolFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: show(['getMany']) },
		options: [
			{ displayName: 'Pool ID', name: 'poolid', type: 'string', default: '', description: 'Only this pool (with its members)' },
			{ displayName: 'Member Type', name: 'type', type: 'options', default: 'qemu', options: [
				{ name: 'VM', value: 'qemu' },
				{ name: 'Container', value: 'lxc' },
				{ name: 'Storage', value: 'storage' },
			] },
		],
	},
	{
		displayName: 'Comment',
		name: 'comment',
		type: 'string',
		default: '',
		displayOptions: { show: show(['create']) },
	},
	{
		displayName: 'Update Fields',
		name: 'poolFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['update']) },
		options: [
			{ displayName: 'Allow Move', name: 'allow-move', type: 'boolean', default: false, description: 'Whether guests may be moved from another pool' },
			{ displayName: 'Comment', name: 'comment', type: 'string', default: '' },
			{ displayName: 'Remove Listed Members', name: 'delete', type: 'boolean', default: false, description: 'Whether to remove the listed VMs/storages instead of adding them' },
			{ displayName: 'Storages', name: 'storage', type: 'string', default: '', placeholder: 'local,local-lvm' },
			{ displayName: 'VMIDs', name: 'vms', type: 'string', default: '', placeholder: '100,101' },
		],
	},
	...commonOptions(R, [], poolListOps),
];
