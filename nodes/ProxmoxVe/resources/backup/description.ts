import type { INodeProperties } from 'n8n-workflow';

import { additionalParameters, commonOptions, nodeLocator, storageLocator } from '../../shared/descriptions';

const R = 'backup';
const show = (ops: string[]) => ({ resource: [R], operation: ops });

export const backupAsyncOps = ['create', 'delete', 'prune'];
export const backupListOps = ['getMany', 'prune', 'getNotBackedUp'];

export const backupDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'getMany',
		options: [
			{ name: 'Create', value: 'create', action: 'Create a backup', description: 'Run vzdump on a node to back up guests now' },
			{ name: 'Delete', value: 'delete', action: 'Delete a backup', description: 'DESTRUCTIVE: permanently deletes a backup archive. Cannot be undone. Use only on explicit request.' },
			{ name: 'Get Many', value: 'getMany', action: 'Get many backups', description: 'List backup archives on a storage' },
			{ name: 'Get Not Backed Up Guests', value: 'getNotBackedUp', action: 'Get guests without a backup job', description: 'List guests that are not covered by any backup job' },
			{ name: 'Prune', value: 'prune', action: 'Prune backups', description: 'Preview which backups a retention policy would keep or remove. Only with "Delete Backups" enabled are backups really deleted (DESTRUCTIVE, use only on explicit request).' },
		],
	},
	nodeLocator(show(['create', 'getMany', 'delete', 'prune'])),
	storageLocator(show(['getMany', 'delete', 'prune'])),
	// ---------- Create
	{
		displayName: 'VMIDs',
		name: 'vmids',
		type: 'string',
		default: '',
		placeholder: '100,101',
		description: 'Comma-separated VMIDs to back up (leave empty and enable "All Guests" in Options to back up every guest on the node)',
		displayOptions: { show: show(['create']) },
	},
	{
		displayName: 'Options',
		name: 'backupOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['create']) },
		options: [
			{ displayName: 'All Guests', name: 'all', type: 'boolean', default: false },
			{ displayName: 'Bandwidth Limit (KiB/s)', name: 'bwlimit', type: 'number', default: 0 },
			{ displayName: 'Compression', name: 'compress', type: 'options', default: 'zstd', options: [
				{ name: 'Gzip', value: 'gzip' },
				{ name: 'LZO', value: 'lzo' },
				{ name: 'None', value: '0' },
				{ name: 'Zstd', value: 'zstd' },
			] },
			{ displayName: 'Exclude VMIDs', name: 'exclude', type: 'string', default: '' },
			{ displayName: 'Mode', name: 'mode', type: 'options', default: 'snapshot', options: [
				{ name: 'Snapshot', value: 'snapshot' },
				{ name: 'Stop', value: 'stop' },
				{ name: 'Suspend', value: 'suspend' },
			] },
			{ displayName: 'Notes Template', name: 'notes-template', type: 'string', default: '' },
			{ displayName: 'Protected', name: 'protected', type: 'boolean', default: false, description: 'Whether to protect the backup from pruning and removal' },
			{ displayName: 'Prune Backups', name: 'prune-backups', type: 'string', default: '', placeholder: 'keep-last=3' },
			{ displayName: 'Remove Old Backups', name: 'remove', type: 'boolean', default: true, description: 'Whether to prune old backups according to the retention settings' },
			{ displayName: 'Storage', name: 'storage', type: 'string', default: '' },
		],
	},
	additionalParameters(show(['create']), 'Other vzdump parameters. Unknown names are rejected by Proxmox VE.'),
	// ---------- Get Many / Delete / Prune
	{
		displayName: 'Filter By VMID',
		name: 'filterVmid',
		type: 'number',
		default: 0,
		description: 'Only backups of this guest (0 = all)',
		displayOptions: { show: show(['getMany', 'prune']) },
	},
	{
		displayName: 'Volume ID',
		name: 'volume',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'local:backup/vzdump-qemu-100-2026_01_01-00_00_00.vma.zst',
		displayOptions: { show: show(['delete']) },
	},
	{
		displayName: 'Retention',
		name: 'pruneBackups',
		type: 'string',
		default: '',
		placeholder: 'keep-last=3,keep-daily=7,keep-weekly=4',
		description: 'Retention policy. Leave empty to use the storage configuration.',
		displayOptions: { show: show(['prune']) },
	},
	{
		displayName: 'Guest Type',
		name: 'pruneType',
		type: 'options',
		default: '',
		options: [
			{ name: 'All', value: '' },
			{ name: 'Container (LXC)', value: 'lxc' },
			{ name: 'VM (QEMU)', value: 'qemu' },
		],
		displayOptions: { show: show(['prune']) },
	},
	{
		displayName: 'Delete Backups',
		name: 'deleteBackups',
		type: 'boolean',
		default: false,
		description:
			'Whether to really delete the backups marked for removal. When disabled (default) the operation only returns a preview. DESTRUCTIVE when enabled: use only on explicit request.',
		displayOptions: { show: show(['prune']) },
	},
	...commonOptions(R, backupAsyncOps, backupListOps),
];
