import type { INodeProperties } from 'n8n-workflow';

import { commonOptions } from '../../shared/descriptions';

const R = 'access';
const show = (ops: string[]) => ({ resource: [R], operation: ops });

export const accessListOps = ['getUsers', 'getGroups', 'getRoles', 'getAcl', 'getApiTokens'];

export const accessDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'getUsers',
		options: [
			{ name: 'Get API Tokens', value: 'getApiTokens', action: 'Get API tokens of a user', description: 'List the API tokens of a user (IDs and settings only, never secrets)' },
			{ name: 'Get Effective Permissions', value: 'getPermissions', action: 'Get effective permissions', description: 'Read the effective permissions of the current or a given user/token' },
			{ name: 'Get Groups', value: 'getGroups', action: 'Get groups', description: 'List user groups' },
			{ name: 'Get Permissions (ACL)', value: 'getAcl', action: 'Get the access control list', description: 'List ACL entries (only those you are allowed to see)' },
			{ name: 'Get Roles', value: 'getRoles', action: 'Get roles', description: 'List roles and their privileges' },
			{ name: 'Get Users', value: 'getUsers', action: 'Get users', description: 'List users' },
		],
	},
	{
		displayName: 'User ID',
		name: 'userid',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'n8n@pve',
		displayOptions: { show: show(['getApiTokens']) },
	},
	{
		displayName: 'Options',
		name: 'userOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['getUsers']) },
		options: [
			{ displayName: 'Enabled Only', name: 'enabled', type: 'boolean', default: false },
			{ displayName: 'Full', name: 'full', type: 'boolean', default: false, description: 'Whether to include groups and token IDs' },
		],
	},
	{
		displayName: 'Options',
		name: 'permissionOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['getPermissions']) },
		options: [
			{ displayName: 'Path', name: 'path', type: 'string', default: '', placeholder: '/vms/100' },
			{ displayName: 'User or Token ID', name: 'userid', type: 'string', default: '', placeholder: 'n8n@pve!automation' },
		],
	},
	...commonOptions(R, [], accessListOps),
];
