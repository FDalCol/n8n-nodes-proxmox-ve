import type { INodeProperties } from 'n8n-workflow';

import { additionalParameters, commonOptions, guestLocator, nodeLocator } from '../../shared/descriptions';

const R = 'firewall';
const show = (ops: string[]) => ({ resource: [R], operation: ops });

export const firewallListOps = ['getRules', 'getAliases', 'getIpsets', 'getIpsetEntries'];

const LOCKOUT =
	'WARNING: a wrong firewall change can block access to the node, the Proxmox VE GUI/API (port 8006), SSH or the guest. Use only when the user explicitly asks for this exact change.';

const withLockoutWarning = (text: string): string => [text, LOCKOUT].join(' ');

const allOps = [
	'getRules', 'getRule', 'createRule', 'updateRule', 'deleteRule',
	'getAliases', 'getAlias', 'createAlias', 'updateAlias', 'deleteAlias',
	'getIpsets', 'getIpsetEntries', 'createIpset', 'deleteIpset', 'addIpsetEntry', 'updateIpsetEntry', 'removeIpsetEntry',
	'getOptions', 'updateOptions',
];

const ruleFields: INodeProperties['options'] = [
	{ displayName: 'Comment', name: 'comment', type: 'string', default: '' },
	{ displayName: 'Destination', name: 'dest', type: 'string', default: '', placeholder: '10.0.0.0/24 or +ipset or alias' },
	{ displayName: 'Destination Port', name: 'dport', type: 'string', default: '', placeholder: '22 or 8000:8100' },
	{ displayName: 'Enable', name: 'enable', type: 'boolean', default: true },
	{ displayName: 'ICMP Type', name: 'icmp-type', type: 'string', default: '' },
	{ displayName: 'Interface', name: 'iface', type: 'string', default: '', placeholder: 'net0' },
	{ displayName: 'Log Level', name: 'log', type: 'options', default: 'nolog', options: ['nolog', 'emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug'].map((v) => ({ name: v, value: v })) },
	{ displayName: 'Macro', name: 'macro', type: 'string', default: '', placeholder: 'SSH' },
	{ displayName: 'Position', name: 'pos', type: 'number', default: 0, description: 'Insert at this position (Create)' },
	{ displayName: 'Protocol', name: 'proto', type: 'string', default: '', placeholder: 'tcp' },
	{ displayName: 'Source', name: 'source', type: 'string', default: '' },
	{ displayName: 'Source Port', name: 'sport', type: 'string', default: '' },
];

export const firewallDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'getRules',
		options: [
			{ name: 'Add IP Set Entry', value: 'addIpsetEntry', action: 'Add an entry to an IP set', description: withLockoutWarning('Add an IP or network to an IP set.') },
			{ name: 'Create Alias', value: 'createAlias', action: 'Create a firewall alias', description: withLockoutWarning('Create an IP/network alias.') },
			{ name: 'Create IP Set', value: 'createIpset', action: 'Create an IP set', description: withLockoutWarning('Create an IP set.') },
			{ name: 'Create Rule', value: 'createRule', action: 'Create a firewall rule', description: withLockoutWarning('Create a firewall rule.') },
			{ name: 'Delete Alias', value: 'deleteAlias', action: 'Delete a firewall alias', description: withLockoutWarning('Delete an alias.') },
			{ name: 'Delete IP Set', value: 'deleteIpset', action: 'Delete an IP set', description: withLockoutWarning('Delete an IP set.') },
			{ name: 'Delete Rule', value: 'deleteRule', action: 'Delete a firewall rule', description: withLockoutWarning('Delete a firewall rule.') },
			{ name: 'Get Alias', value: 'getAlias', action: 'Get a firewall alias', description: 'Read an alias' },
			{ name: 'Get Aliases', value: 'getAliases', action: 'Get firewall aliases', description: 'List aliases (cluster, VM or container)' },
			{ name: 'Get IP Set Entries', value: 'getIpsetEntries', action: 'Get the entries of an IP set', description: 'List the content of an IP set' },
			{ name: 'Get IP Sets', value: 'getIpsets', action: 'Get IP sets', description: 'List IP sets (cluster, VM or container)' },
			{ name: 'Get Options', value: 'getOptions', action: 'Get firewall options', description: 'Read firewall options' },
			{ name: 'Get Rule', value: 'getRule', action: 'Get a firewall rule', description: 'Read a firewall rule' },
			{ name: 'Get Rules', value: 'getRules', action: 'Get firewall rules', description: 'List firewall rules' },
			{ name: 'Remove IP Set Entry', value: 'removeIpsetEntry', action: 'Remove an entry from an IP set', description: withLockoutWarning('Remove an IP or network from an IP set.') },
			{ name: 'Update Alias', value: 'updateAlias', action: 'Update a firewall alias', description: withLockoutWarning('Change an alias.') },
			{ name: 'Update IP Set Entry', value: 'updateIpsetEntry', action: 'Update an IP set entry', description: withLockoutWarning('Change an IP set entry.') },
			{ name: 'Update Options', value: 'updateOptions', action: 'Update firewall options', description: withLockoutWarning('Change firewall options, e.g. enable the firewall or set the default policy.') },
			{ name: 'Update Rule', value: 'updateRule', action: 'Update a firewall rule', description: withLockoutWarning('Change or move a firewall rule.') },
		],
	},
	{
		displayName: 'Level',
		name: 'scope',
		type: 'options',
		default: 'cluster',
		options: [
			{ name: 'Cluster (Datacenter)', value: 'cluster' },
			{ name: 'Node', value: 'node', description: 'Rules and options only' },
			{ name: 'VM', value: 'vm' },
			{ name: 'Container', value: 'container' },
		],
		displayOptions: { show: { resource: [R] } },
	},
	nodeLocator({ resource: [R], operation: allOps, scope: ['node', 'vm', 'container'] }),
	guestLocator('qemu', { resource: [R], operation: allOps, scope: ['vm'] }),
	guestLocator('lxc', { resource: [R], operation: allOps, scope: ['container'] }, { name: 'ctid' }),
	{
		displayName: 'Rule Position',
		name: 'pos',
		type: 'number',
		default: 0,
		required: true,
		description: 'Position of the rule (see Get Rules)',
		displayOptions: { show: show(['getRule', 'updateRule', 'deleteRule']) },
	},
	{
		displayName: 'Direction',
		name: 'ruleType',
		type: 'options',
		default: 'in',
		options: [
			{ name: 'In', value: 'in' },
			{ name: 'Out', value: 'out' },
			{ name: 'Forward', value: 'forward' },
			{ name: 'Security Group', value: 'group' },
		],
		displayOptions: { show: show(['createRule']) },
	},
	{
		displayName: 'Action',
		name: 'action',
		type: 'string',
		default: 'ACCEPT',
		required: true,
		description: 'ACCEPT, DROP, REJECT or the name of a security group',
		displayOptions: { show: show(['createRule']) },
	},
	{
		displayName: 'Rule Fields',
		name: 'ruleFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['createRule', 'updateRule']) },
		options: [
			...(ruleFields ?? []),
			{ displayName: 'Action (Update)', name: 'action', type: 'string', default: '' },
			{ displayName: 'Delete Settings (Update)', name: 'delete', type: 'string', default: '', placeholder: 'dport,comment' },
			{ displayName: 'Digest', name: 'digest', type: 'string', default: '' },
			{ displayName: 'Direction (Update)', name: 'type', type: 'options', default: 'in', options: [
				{ name: 'In', value: 'in' },
				{ name: 'Out', value: 'out' },
				{ name: 'Forward', value: 'forward' },
				{ name: 'Security Group', value: 'group' },
			] },
			{ displayName: 'Move To Position (Update)', name: 'moveto', type: 'number', default: 0 },
		],
	},
	{
		displayName: 'Alias Name',
		name: 'aliasName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: show(['getAlias', 'createAlias', 'updateAlias', 'deleteAlias']) },
	},
	{
		displayName: 'IP Set Name',
		name: 'ipsetName',
		type: 'string',
		default: '',
		required: true,
		displayOptions: { show: show(['getIpsetEntries', 'createIpset', 'deleteIpset', 'addIpsetEntry', 'updateIpsetEntry', 'removeIpsetEntry']) },
	},
	{
		displayName: 'CIDR',
		name: 'cidr',
		type: 'string',
		default: '',
		required: true,
		placeholder: '10.0.0.0/24',
		description: 'IP address or network (for IP set entries also an alias name)',
		displayOptions: { show: show(['createAlias', 'updateAlias', 'addIpsetEntry', 'updateIpsetEntry', 'removeIpsetEntry']) },
	},
	{
		displayName: 'Extra Fields',
		name: 'extraFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['createAlias', 'updateAlias', 'createIpset', 'deleteIpset', 'addIpsetEntry', 'updateIpsetEntry']) },
		options: [
			{ displayName: 'Comment', name: 'comment', type: 'string', default: '' },
			{ displayName: 'Force (Delete IP Set)', name: 'force', type: 'boolean', default: false, description: 'Whether to delete the IP set even if it still has entries' },
			{ displayName: 'No Match (IP Set Entry)', name: 'nomatch', type: 'boolean', default: false, description: 'Whether the entry excludes the address instead of matching it' },
			{ displayName: 'Rename To (Alias)', name: 'rename', type: 'string', default: '' },
		],
	},
	additionalParameters(
		show(['updateOptions']),
		'Firewall options to set, e.g. enable=1, policy_in=DROP (validated against the Proxmox VE API for the selected level)',
		'firewallOptions',
	),
	...commonOptions(R, [], firewallListOps),
];
