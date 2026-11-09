import type { INodeProperties } from 'n8n-workflow';

import { additionalParameters, commonOptions, nodeLocator, storageLocator } from '../../shared/descriptions';

const R = 'backup';
const show = (ops: string[]) => ({ resource: [R], operation: ops });

export const backupAsyncOps = ['create', 'restore', 'delete', 'prune', 'runJob'];
export const backupListOps = ['getMany', 'prune', 'getJobs', 'getNotBackedUp'];

const jobFields: INodeProperties['options'] = [
	{ displayName: 'All Guests', name: 'all', type: 'boolean', default: false, description: 'Whether to back up all guests (use Exclude to skip some)' },
	{ displayName: 'Comment', name: 'comment', type: 'string', default: '' },
	{ displayName: 'Compression', name: 'compress', type: 'options', default: 'zstd', options: [
		{ name: 'None', value: '0' },
		{ name: 'Gzip', value: 'gzip' },
		{ name: 'LZO', value: 'lzo' },
		{ name: 'Zstd', value: 'zstd' },
	] },
	{ displayName: 'Enabled', name: 'enabled', type: 'boolean', default: true },
	{ displayName: 'Exclude VMIDs', name: 'exclude', type: 'string', default: '', placeholder: '105,106' },
	{ displayName: 'Mail To', name: 'mailto', type: 'string', default: '' },
	{ displayName: 'Mode', name: 'mode', type: 'options', default: 'snapshot', options: [
		{ name: 'Snapshot', value: 'snapshot' },
		{ name: 'Suspend', value: 'suspend' },
		{ name: 'Stop', value: 'stop' },
	] },
	{ displayName: 'Node', name: 'node', type: 'string', default: '', description: 'Only run the job on this node' },
	{ displayName: 'Notes Template', name: 'notes-template', type: 'string', default: '', placeholder: '{{guestname}}' },
	{ displayName: 'Pool', name: 'pool', type: 'string', default: '' },
	{ displayName: 'Prune Backups', name: 'prune-backups', type: 'string', default: '', placeholder: 'keep-last=3,keep-daily=7' },
	{ displayName: 'Schedule', name: 'schedule', type: 'string', default: '', placeholder: 'sun 01:00', description: 'Calendar event, e.g. "daily", "sat 02:00" or "*-*-* 21:00"' },
	{ displayName: 'Storage', name: 'storage', type: 'string', default: '' },
	{ displayName: 'VMIDs', name: 'vmid', type: 'string', default: '', placeholder: '100,101' },
];

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
			{ name: 'Create Job', value: 'createJob', action: 'Create a backup job', description: 'Create a scheduled backup job' },
			{ name: 'Delete', value: 'delete', action: 'Delete a backup', description: 'DESTRUCTIVE: permanently deletes a backup archive. Cannot be undone. Use only on explicit request.' },
			{ name: 'Delete Job', value: 'deleteJob', action: 'Delete a backup job', description: 'DESTRUCTIVE: deletes a scheduled backup job; guests are no longer backed up by it. Use only on explicit request.' },
			{ name: 'Get Job', value: 'getJob', action: 'Get a backup job', description: 'Read the definition of a backup job' },
			{ name: 'Get Jobs', value: 'getJobs', action: 'Get backup jobs', description: 'List scheduled backup jobs' },
			{ name: 'Get Many', value: 'getMany', action: 'Get many backups', description: 'List backup archives on a storage' },
			{ name: 'Get Not Backed Up Guests', value: 'getNotBackedUp', action: 'Get guests without a backup job', description: 'List guests that are not covered by any backup job' },
			{ name: 'Prune', value: 'prune', action: 'Prune backups', description: 'Preview which backups a retention policy would keep or remove. Only with "Delete Backups" enabled are backups really deleted (DESTRUCTIVE, use only on explicit request).' },
			{ name: 'Restore', value: 'restore', action: 'Restore a backup', description: 'DESTRUCTIVE when "Force" is enabled: restores a backup archive into a new VM or container; with Force an existing guest with the same VMID is overwritten. Use only on explicit request.' },
			{ name: 'Run Job Now', value: 'runJob', action: 'Run a backup job now', description: 'Start a scheduled backup job immediately on all its online nodes (like "Run now" in the GUI)' },
			{ name: 'Update Job', value: 'updateJob', action: 'Update a backup job', description: 'Change a scheduled backup job' },
		],
	},
	nodeLocator(show(['create', 'restore', 'getMany', 'delete', 'prune'])),
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
				{ name: 'None', value: '0' },
				{ name: 'Gzip', value: 'gzip' },
				{ name: 'LZO', value: 'lzo' },
				{ name: 'Zstd', value: 'zstd' },
			] },
			{ displayName: 'Exclude VMIDs', name: 'exclude', type: 'string', default: '' },
			{ displayName: 'Mode', name: 'mode', type: 'options', default: 'snapshot', options: [
				{ name: 'Snapshot', value: 'snapshot' },
				{ name: 'Suspend', value: 'suspend' },
				{ name: 'Stop', value: 'stop' },
			] },
			{ displayName: 'Notes Template', name: 'notes-template', type: 'string', default: '' },
			{ displayName: 'Protected', name: 'protected', type: 'boolean', default: false, description: 'Whether to protect the backup from pruning and removal' },
			{ displayName: 'Prune Backups', name: 'prune-backups', type: 'string', default: '', placeholder: 'keep-last=3' },
			{ displayName: 'Remove Old Backups', name: 'remove', type: 'boolean', default: true, description: 'Whether to prune old backups according to the retention settings' },
			{ displayName: 'Storage', name: 'storage', type: 'string', default: '' },
		],
	},
	additionalParameters(show(['create']), 'Other vzdump parameters (validated against the Proxmox VE API)'),
	// ---------- Restore
	{
		displayName: 'Guest Type',
		name: 'guestType',
		type: 'options',
		default: 'qemu',
		options: [
			{ name: 'VM (QEMU)', value: 'qemu' },
			{ name: 'Container (LXC)', value: 'lxc' },
		],
		displayOptions: { show: show(['restore']) },
	},
	{
		displayName: 'Target VMID',
		name: 'targetVmid',
		type: 'number',
		default: 0,
		required: true,
		description: 'VMID of the restored guest',
		displayOptions: { show: show(['restore']) },
	},
	{
		displayName: 'Archive',
		name: 'archive',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'local:backup/vzdump-qemu-100-2026_01_01-00_00_00.vma.zst',
		description: 'Volume ID of the backup archive',
		displayOptions: { show: show(['restore']) },
	},
	{
		displayName: 'Force (Overwrite Existing Guest)',
		name: 'force',
		type: 'boolean',
		default: false,
		description:
			'Whether to overwrite an existing VM or container with the same VMID. DESTRUCTIVE: the existing guest and its disks are replaced by the backup. Leave disabled unless the user explicitly asks to overwrite.',
		displayOptions: { show: show(['restore']) },
	},
	{
		displayName: 'Restore Options',
		name: 'restoreOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['restore']) },
		options: [
			{ displayName: 'Bandwidth Limit (KiB/s)', name: 'bwlimit', type: 'number', default: 0 },
			{ displayName: 'Live Restore (VM)', name: 'live-restore', type: 'boolean', default: false, description: 'Whether to start the VM while restoring (PBS backups, VM only)' },
			{ displayName: 'Pool', name: 'pool', type: 'string', default: '' },
			{ displayName: 'Start After Restore', name: 'start', type: 'boolean', default: false },
			{ displayName: 'Storage', name: 'storage', type: 'string', default: '', description: 'Target storage for the disks' },
			{ displayName: 'Unique', name: 'unique', type: 'boolean', default: false, description: 'Whether to assign new random MAC addresses' },
		],
	},
	// ---------- Get Many / Delete
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
	// ---------- Prune
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
			{ name: 'VM (QEMU)', value: 'qemu' },
			{ name: 'Container (LXC)', value: 'lxc' },
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
	// ---------- Jobs
	{
		displayName: 'Job Name or ID',
		name: 'jobId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getBackupJobs' },
		default: '',
		required: true,
		description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: { show: show(['getJob', 'updateJob', 'deleteJob', 'runJob']) },
	},
	{
		displayName: 'Job Fields',
		name: 'jobFields',
		type: 'collection',
		placeholder: 'Add Field',
		default: {},
		displayOptions: { show: show(['createJob', 'updateJob']) },
		options: jobFields,
	},
	additionalParameters(show(['createJob']), 'Other backup job parameters (validated against the Proxmox VE API)', 'jobAdditionalCreate'),
	additionalParameters(show(['updateJob']), 'Other backup job parameters (validated against the Proxmox VE API)', 'jobAdditionalUpdate'),
	...commonOptions(R, backupAsyncOps, backupListOps),
];
