import type { INodeProperties } from 'n8n-workflow';

import { commonOptions } from '../../shared/descriptions';

const R = 'ha';
const show = (ops: string[]) => ({ resource: [R], operation: ops });

export const haListOps = ['getResources', 'getRules', 'getGroups', 'getStatus'];

const HA_WARNING =
	'Changes the High Availability configuration: the HA manager may start, stop, migrate or relocate guests automatically. Use only on explicit request.';

const withHaWarning = (text: string): string => [text, HA_WARNING].join(' ');

export const haDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'getResources',
		options: [
			{ name: 'Add Resource', value: 'addResource', action: 'Add an HA resource', description: withHaWarning('Put a guest under HA management.') },
			{ name: 'Create Group (8.x)', value: 'createGroup', action: 'Create an HA group', description: withHaWarning('Create an HA group (Proxmox VE 8.x; replaced by HA rules in 9.x).') },
			{ name: 'Create Rule (9.x)', value: 'createRule', action: 'Create an HA rule', description: withHaWarning('Create a node or resource affinity rule (Proxmox VE 9.x).') },
			{ name: 'Delete Group (8.x)', value: 'deleteGroup', action: 'Delete an HA group', description: withHaWarning('DESTRUCTIVE: delete an HA group (Proxmox VE 8.x).') },
			{ name: 'Delete Rule (9.x)', value: 'deleteRule', action: 'Delete an HA rule', description: withHaWarning('DESTRUCTIVE: delete an HA rule (Proxmox VE 9.x).') },
			{ name: 'Get Group (8.x)', value: 'getGroup', action: 'Get an HA group', description: 'Read an HA group (Proxmox VE 8.x, deprecated in 9.x)' },
			{ name: 'Get Groups (8.x)', value: 'getGroups', action: 'Get HA groups', description: 'List HA groups (Proxmox VE 8.x, deprecated in 9.x)' },
			{ name: 'Get Manager Status', value: 'getManagerStatus', action: 'Get the full HA manager status', description: 'Read the full HA manager status including LRM status' },
			{ name: 'Get Resource', value: 'getResource', action: 'Get an HA resource', description: 'Read the HA configuration of a resource' },
			{ name: 'Get Resources', value: 'getResources', action: 'Get HA resources', description: 'List HA managed resources' },
			{ name: 'Get Rule (9.x)', value: 'getRule', action: 'Get an HA rule', description: 'Read an HA rule (Proxmox VE 9.x)' },
			{ name: 'Get Rules (9.x)', value: 'getRules', action: 'Get HA rules', description: 'List HA rules (Proxmox VE 9.x)' },
			{ name: 'Get Status', value: 'getStatus', action: 'Get HA status', description: 'Read the current HA manager status' },
			{ name: 'Remove Resource', value: 'removeResource', action: 'Remove an HA resource', description: withHaWarning('DESTRUCTIVE: remove a guest from HA management; it is no longer restarted or relocated on failures.') },
			{ name: 'Update Group (8.x)', value: 'updateGroup', action: 'Update an HA group', description: withHaWarning('Change an HA group (Proxmox VE 8.x).') },
			{ name: 'Update Resource', value: 'updateResource', action: 'Update an HA resource', description: withHaWarning('Change the HA configuration of a resource (e.g. requested state).') },
			{ name: 'Update Rule (9.x)', value: 'updateRule', action: 'Update an HA rule', description: withHaWarning('Change an HA rule (Proxmox VE 9.x).') },
		],
	},
	{
		displayName: 'Resource ID',
		name: 'sid',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'vm:100',
		description: 'HA resource ID, e.g. vm:100 or ct:101 (a plain VMID means vm:VMID)',
		displayOptions: { show: show(['getResource', 'addResource', 'updateResource', 'removeResource']) },
	},
	{
		displayName: 'Filter Type',
		name: 'filterType',
		type: 'options',
		default: '',
		options: [
			{ name: 'All', value: '' },
			{ name: 'VM', value: 'vm' },
			{ name: 'Container', value: 'ct' },
		],
		displayOptions: { show: show(['getResources']) },
	},
	{
		displayName: 'Resource Fields',
		name: 'resourceFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['addResource', 'updateResource']) },
		options: [
			{ displayName: 'Comment', name: 'comment', type: 'string', default: '' },
			{ displayName: 'Failback (9.x)', name: 'failback', type: 'boolean', default: true, description: 'Whether the resource moves back to the highest priority node (Proxmox VE 9.x)' },
			{ displayName: 'Group (8.x)', name: 'group', type: 'string', default: '', description: 'HA group (Proxmox VE 8.x)' },
			{ displayName: 'Max Relocate', name: 'max_relocate', type: 'number', default: 1 },
			{ displayName: 'Max Restart', name: 'max_restart', type: 'number', default: 1 },
			{ displayName: 'Requested State', name: 'state', type: 'options', default: 'started', options: [
				{ name: 'Disabled', value: 'disabled' },
				{ name: 'Ignored', value: 'ignored' },
				{ name: 'Started', value: 'started' },
				{ name: 'Stopped', value: 'stopped' },
			] },
		],
	},
	{
		displayName: 'Purge (9.x)',
		name: 'purge',
		type: 'boolean',
		default: true,
		description: 'Whether to also remove the resource from HA rules (Proxmox VE 9.x)',
		displayOptions: { show: show(['removeResource']) },
	},
	{
		displayName: 'Rule ID',
		name: 'rule',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: show(['getRule', 'createRule', 'updateRule', 'deleteRule']) },
	},
	{
		displayName: 'Rule Type',
		name: 'ruleType',
		type: 'options',
		default: 'node-affinity',
		options: [
			{ name: 'Node Affinity', value: 'node-affinity' },
			{ name: 'Resource Affinity', value: 'resource-affinity' },
		],
		displayOptions: { show: show(['createRule', 'updateRule']) },
	},
	{
		displayName: 'Rule Fields',
		name: 'ruleFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['createRule', 'updateRule']) },
		options: [
			{ displayName: 'Affinity', name: 'affinity', type: 'options', default: 'positive', options: [
				{ name: 'Positive', value: 'positive' },
				{ name: 'Negative', value: 'negative' },
			] },
			{ displayName: 'Comment', name: 'comment', type: 'string', default: '' },
			{ displayName: 'Disable', name: 'disable', type: 'boolean', default: false },
			{ displayName: 'Nodes (Node Affinity)', name: 'nodes', type: 'string', default: '', placeholder: 'pve1:2,pve2:1' },
			{ displayName: 'Resources', name: 'resources', type: 'string', default: '', placeholder: 'vm:100,ct:101' },
			{ displayName: 'Strict (Node Affinity)', name: 'strict', type: 'boolean', default: false },
		],
	},
	{
		displayName: 'Group Name',
		name: 'group',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: show(['getGroup', 'createGroup', 'updateGroup', 'deleteGroup']) },
	},
	{
		displayName: 'Group Fields',
		name: 'groupFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['createGroup', 'updateGroup']) },
		options: [
			{ displayName: 'Comment', name: 'comment', type: 'string', default: '' },
			{ displayName: 'No Failback', name: 'nofailback', type: 'boolean', default: false },
			{ displayName: 'Nodes', name: 'nodes', type: 'string', default: '', placeholder: 'pve1:2,pve2:1' },
			{ displayName: 'Restricted', name: 'restricted', type: 'boolean', default: false },
		],
	},
	...commonOptions(R, [], haListOps),
];
