/**
 * Shared description and handlers for QEMU VMs and LXC containers.
 * The two resources differ only where the Proxmox VE API differs.
 */
import type { IDataObject, INodeProperties, INodePropertyOptions } from 'n8n-workflow';

import {
	additionalParameters,
	commonOptions,
	guestLocator,
	nodeLocator,
	rrdTimeframe,
	storageLocator,
} from './descriptions';
import { data, list, task, type OperationContext, type ResourceHandlers } from './engine';
import { apiPath, validateNodeName, validateStorageId, validateVmid } from './security';

export type GuestKind = 'qemu' | 'lxc';

const SNAPNAME = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const DISK = /^(?:ide|sata|scsi|virtio|efidisk|tpmstate|unused|mp)\d+$|^rootfs$/;

export interface OpDef {
	value: string;
	name: string;
	action: string;
	description: string;
	kinds: GuestKind[];
	async?: GuestKind[];
	list?: boolean;
}

const BOTH: GuestKind[] = ['qemu', 'lxc'];
const QEMU: GuestKind[] = ['qemu'];

function label(kind: GuestKind): string {
	return kind === 'qemu' ? 'VM' : 'container';
}

const OPS = (k: GuestKind): OpDef[] => {
	const L = label(k);
	return [
		{ value: 'clone', name: 'Clone', action: `Clone a ${L}`, description: `Create a copy of a ${L} or template under a new VMID`, kinds: BOTH, async: BOTH },
		{ value: 'convertToTemplate', name: 'Convert To Template', action: `Convert a ${L} to a template`, description: `Convert a stopped ${L} into a template. This cannot be undone: a template cannot be started. Use only on explicit request.`, kinds: BOTH, async: QEMU },
		{ value: 'create', name: 'Create', action: `Create a ${L}`, description: `Create a new ${L}`, kinds: BOTH, async: BOTH },
		{ value: 'createSnapshot', name: 'Create Snapshot', action: `Create a snapshot of a ${L}`, description: `Create a snapshot of a ${L}`, kinds: BOTH, async: BOTH },
		{ value: 'delete', name: 'Delete', action: `Delete a ${L}`, description: `DESTRUCTIVE: permanently destroys the ${L} and all its disks. This cannot be undone. Use only when the user explicitly asks to delete this ${L}.`, kinds: BOTH, async: BOTH },
		{ value: 'deleteSnapshot', name: 'Delete Snapshot', action: `Delete a snapshot of a ${L}`, description: 'DESTRUCTIVE: permanently deletes a snapshot. Use only on explicit request.', kinds: BOTH, async: BOTH },
		{ value: 'get', name: 'Get', action: `Get a ${L}`, description: `Get configuration and current status of a ${L} together`, kinds: BOTH },
		{ value: 'getCloudInit', name: 'Get Cloud-Init', action: 'Get cloud-init parameters of a VM', description: 'Read cloud-init parameters with current and pending values', kinds: QEMU, list: true },
		{ value: 'getCloudInitDump', name: 'Get Cloud-Init Dump', action: 'Get the generated cloud-init config of a VM', description: 'Read the automatically generated cloud-init user, network or meta configuration', kinds: QEMU },
		{ value: 'getConfig', name: 'Get Config', action: `Get the configuration of a ${L}`, description: `Read only the configuration of a ${L}`, kinds: BOTH },
		{ value: 'getMany', name: 'Get Many', action: `Get many ${L}s`, description: `List the ${L}s of a node`, kinds: BOTH, list: true },
		{ value: 'getNextFreeVmid', name: 'Get Next Free VMID', action: 'Get the next free VMID', description: 'Get the next free VMID of the cluster, or check whether a VMID is free', kinds: BOTH },
		{ value: 'getPending', name: 'Get Pending', action: `Get pending changes of a ${L}`, description: 'Read the configuration with current and pending values', kinds: BOTH, list: true },
		{ value: 'getRrdData', name: 'Get RRD Data', action: `Get RRD statistics of a ${L}`, description: `Read CPU, memory, network and disk statistics of a ${L}`, kinds: BOTH, list: true },
		{ value: 'getSnapshotConfig', name: 'Get Snapshot Config', action: `Get the configuration of a snapshot`, description: 'Read the configuration stored in a snapshot', kinds: BOTH },
		{ value: 'getSnapshots', name: 'Get Snapshots', action: `Get snapshots of a ${L}`, description: `List all snapshots of a ${L}`, kinds: BOTH, list: true },
		{ value: 'getStatus', name: 'Get Status', action: `Get the status of a ${L}`, description: `Read the current status (running, stopped, usage) of a ${L}`, kinds: BOTH },
		{ value: 'hibernate', name: 'Hibernate', action: 'Hibernate a VM', description: 'Suspend the VM to disk: RAM is saved to storage and the VM stops. Interrupts the workload. Use only on explicit request.', kinds: QEMU, async: QEMU },
		{ value: 'migrate', name: 'Migrate', action: `Migrate a ${L} to another node`, description: `Move a ${L} to another cluster node. Offline migration stops the guest. Use only on explicit request.`, kinds: BOTH, async: BOTH },
		{ value: 'moveDisk', name: k === 'qemu' ? 'Move Disk' : 'Move Volume', action: `Move a disk of a ${L}`, description: 'Move a disk/volume to another storage. With "Delete Source" the original is removed.', kinds: BOTH, async: BOTH },
		{ value: 'reboot', name: 'Reboot', action: `Reboot a ${L}`, description: `DISRUPTIVE: shuts the ${L} down and starts it again, interrupting its workload. Use only on explicit request.`, kinds: BOTH, async: BOTH },
		{ value: 'regenerateCloudInit', name: 'Regenerate Cloud-Init', action: 'Regenerate the cloud-init drive of a VM', description: 'Regenerate the cloud-init config drive with the current parameters', kinds: QEMU },
		{ value: 'reset', name: 'Reset', action: 'Reset a VM', description: 'DESTRUCTIVE: hard reset of the VM, like pressing the reset button. Unsaved data in the guest is lost. Use only on explicit request.', kinds: QEMU, async: QEMU },
		{ value: 'resizeDisk', name: 'Resize Disk', action: `Resize a disk of a ${L}`, description: 'Grow a disk. Shrinking is not supported by Proxmox VE.', kinds: BOTH, async: BOTH },
		{ value: 'resume', name: 'Resume', action: `Resume a ${L}`, description: `Resume a suspended ${L}`, kinds: BOTH, async: BOTH },
		{ value: 'rollbackSnapshot', name: 'Rollback Snapshot', action: `Roll back a ${L} to a snapshot`, description: `DESTRUCTIVE: reverts the ${L} to the snapshot. All changes since the snapshot are lost. Use only when the user explicitly asks for a rollback.`, kinds: BOTH, async: BOTH },
		{ value: 'shutdown', name: 'Shutdown', action: `Shut down a ${L}`, description: `DISRUPTIVE: clean shutdown of the ${L} (ACPI/agent), stopping its workload. Use only on explicit request.`, kinds: BOTH, async: BOTH },
		{ value: 'start', name: 'Start', action: `Start a ${L}`, description: `Start a ${L}`, kinds: BOTH, async: BOTH },
		{ value: 'stop', name: 'Stop', action: `Stop a ${L}`, description: `DESTRUCTIVE: immediate stop of the ${L}, like pulling the power plug. Unsaved data in the guest can be lost. Use only on explicit request.`, kinds: BOTH, async: BOTH },
		{ value: 'suspend', name: 'Suspend', action: `Suspend a ${L}`, description: k === 'lxc' ? 'Suspend (freeze) the container. Experimental in Proxmox VE. Interrupts the workload.' : 'Pause the VM in memory. Interrupts the workload. Use only on explicit request.', kinds: BOTH, async: BOTH },
		{ value: 'updateCloudInit', name: 'Update Cloud-Init', action: 'Update cloud-init parameters of a VM', description: 'Change cloud-init parameters (user, password, SSH keys, IP configuration, DNS). Applied on the next start or after Regenerate Cloud-Init.', kinds: QEMU, async: QEMU },
		{ value: 'updateConfig', name: 'Update Config', action: `Update the configuration of a ${L}`, description: `Change configuration options of a ${L}. Some changes require a reboot to apply.`, kinds: BOTH, async: QEMU },
		{ value: 'updateSnapshot', name: 'Update Snapshot', action: 'Update the description of a snapshot', description: 'Change the description of a snapshot', kinds: BOTH },
	];
};

export function guestOperations(kind: GuestKind): { ops: OpDef[]; asyncOps: string[]; listOps: string[] } {
	const ops = OPS(kind).filter((o) => o.kinds.includes(kind));
	return {
		ops,
		asyncOps: ops.filter((o) => o.async?.includes(kind)).map((o) => o.value),
		listOps: ops.filter((o) => o.list).map((o) => o.value),
	};
}

export function guestDescription(kind: GuestKind, resource: string): INodeProperties[] {
	const { ops, asyncOps, listOps } = guestOperations(kind);
	const all = ops.map((o) => o.value);
	const show = (values: string[]) => ({ resource: [resource], operation: values });
	const without = (...ex: string[]) => all.filter((v) => !ex.includes(v));
	const snapshotOps = ['createSnapshot', 'getSnapshotConfig', 'updateSnapshot', 'rollbackSnapshot', 'deleteSnapshot'];

	const props: INodeProperties[] = [
		{
			displayName: 'Operation',
			name: 'operation',
			type: 'options',
			noDataExpression: true,
			displayOptions: { show: { resource: [resource] } },
			default: 'getMany',
			options: ops.map<INodePropertyOptions>((o) => ({
				name: o.name,
				value: o.value,
				action: o.action,
				description: o.description,
			})),
		},
		nodeLocator(show(without('getNextFreeVmid'))),
		guestLocator(kind, show(without('getMany', 'create', 'getNextFreeVmid'))),
		// ---------------- Create
		{
			displayName: 'New VMID',
			name: 'newVmid',
			type: 'number',
			default: 0,
			required: true,
			description: 'VMID of the new guest (100-999999999). Use "Get Next Free VMID" to obtain a free one.',
			displayOptions: { show: show(['create', 'clone']) },
		},
	];

	if (kind === 'lxc') {
		props.push(
			{
				displayName: 'OS Template',
				name: 'ostemplate',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'local:vztmpl/debian-12-standard_12.7-1_amd64.tar.zst',
				description: 'Volume ID of the container template',
				displayOptions: { show: show(['create']) },
			},
			{
				displayName: 'Create Fields',
				name: 'createFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: show(['create']) },
				options: [
					{ displayName: 'Cores', name: 'cores', type: 'number', default: 1, typeOptions: { minValue: 1 } },
					{ displayName: 'Hostname', name: 'hostname', type: 'string', default: '' },
					{ displayName: 'Memory (MiB)', name: 'memory', type: 'number', default: 512, typeOptions: { minValue: 16 } },
					{ displayName: 'Network (Net0)', name: 'net0', type: 'string', default: '', placeholder: 'name=eth0,bridge=vmbr0,ip=dhcp' },
					{ displayName: 'Password', name: 'password', type: 'string', typeOptions: { password: true }, default: '', description: 'Root password inside the container' },
					{ displayName: 'Pool', name: 'pool', type: 'string', default: '' },
					{ displayName: 'Root Filesystem', name: 'rootfs', type: 'string', default: '', placeholder: 'local-lvm:8', description: 'Storage and size in GiB, e.g. local-lvm:8' },
					{ displayName: 'SSH Public Keys', name: 'ssh-public-keys', type: 'string', typeOptions: { rows: 3 }, default: '' },
					{ displayName: 'Start After Create', name: 'start', type: 'boolean', default: false },
					{ displayName: 'Storage', name: 'storage', type: 'string', default: '', placeholder: 'local-lvm' },
					{ displayName: 'Unprivileged', name: 'unprivileged', type: 'boolean', default: true },
				],
			},
		);
	} else {
		props.push({
			displayName: 'Create Fields',
			name: 'createFields',
			type: 'collection',
			placeholder: 'Add Field',
			default: {},
			displayOptions: { show: show(['create']) },
			options: [
				{ displayName: 'Cores', name: 'cores', type: 'number', default: 1, typeOptions: { minValue: 1 } },
				{ displayName: 'Memory (MiB)', name: 'memory', type: 'number', default: 2048, typeOptions: { minValue: 16 } },
				{ displayName: 'Name', name: 'name', type: 'string', default: '' },
				{ displayName: 'Network (Net0)', name: 'net0', type: 'string', default: '', placeholder: 'virtio,bridge=vmbr0' },
				{ displayName: 'OS Type', name: 'ostype', type: 'options', default: 'l26', options: [
					{ name: 'Linux 2.6+', value: 'l26' },
					{ name: 'Other', value: 'other' },
					{ name: 'Solaris', value: 'solaris' },
					{ name: 'Windows 10/2016/2019', value: 'win10' },
					{ name: 'Windows 11/2022/2025', value: 'win11' },
				] },
				{ displayName: 'Pool', name: 'pool', type: 'string', default: '' },
				{ displayName: 'SCSI0 Disk', name: 'scsi0', type: 'string', default: '', placeholder: 'local-lvm:32', description: 'Storage and size in GiB, e.g. local-lvm:32' },
				{ displayName: 'Sockets', name: 'sockets', type: 'number', default: 1, typeOptions: { minValue: 1 } },
				{ displayName: 'Start After Create', name: 'start', type: 'boolean', default: false },
			],
		});
	}

	props.push(
		additionalParameters(
			show(['create']),
			'Any other parameter of the create endpoint (validated against the Proxmox VE API), e.g. ide2, boot, agent, net1',
		),
		additionalParameters(
			show(['updateConfig']),
			'Configuration options to set (validated against the Proxmox VE API), e.g. memory=4096, cores=4, net0=...',
		),
		{
			displayName: 'Update Fields',
			name: 'updateOptions',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			displayOptions: { show: show(['updateConfig']) },
			options: [
				{ displayName: 'Delete Settings', name: 'delete', type: 'string', default: '', placeholder: 'net1,ide2', description: 'Comma-separated list of settings to remove' },
				{ displayName: 'Digest', name: 'digest', type: 'string', default: '', description: 'Only apply if the current configuration has this digest (prevents concurrent modifications)' },
			],
		},
		// ---------------- Get Config
		{
			displayName: 'Options',
			name: 'configOptions',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			displayOptions: { show: show(['getConfig', 'get']) },
			options: [
				{ displayName: 'Current Only', name: 'current', type: 'boolean', default: false, description: 'Whether to return the current values instead of the pending ones' },
				{ displayName: 'Snapshot', name: 'snapshot', type: 'string', default: '', description: 'Return the configuration of this snapshot' },
			],
		},
		{
			displayName: 'Get Many Options',
			name: 'listOptions',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			displayOptions: { show: show(['getMany']) },
			options:
				kind === 'qemu'
					? [{ displayName: 'Full', name: 'full', type: 'boolean', default: false, description: 'Whether to determine the full status of active VMs (slower)' }]
					: [{ displayName: 'Running Only', name: 'runningOnly', type: 'boolean', default: false, description: 'Whether to return only running containers' }],
		},
		// ---------------- Power
		{
			displayName: 'Options',
			name: 'powerOptions',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			displayOptions: { show: show(['start', 'stop', 'shutdown', 'reboot', 'reset', 'suspend', 'hibernate', 'resume', 'delete']) },
			options: [
				...(kind === 'lxc'
					? [{ displayName: 'Debug (Start)', name: 'debug', type: 'boolean' as const, default: false, description: 'Whether to start with debug log level (Start only)' }]
					: []),
				{ displayName: 'Destroy Unreferenced Disks (Delete)', name: 'destroy-unreferenced-disks', type: 'boolean', default: false, description: 'Whether to also destroy disks not referenced in the config but with a matching VMID (Delete only)' },
				...(kind === 'lxc'
					? [{ displayName: 'Force (Delete)', name: 'force', type: 'boolean' as const, default: false, description: 'Whether to stop a running container before deleting it (Delete only)' }]
					: []),
				{ displayName: 'Force Stop (Shutdown)', name: 'forceStop', type: 'boolean', default: false, description: 'Whether to hard stop the guest if the shutdown does not finish within the timeout (Shutdown only)' },
				{ displayName: 'Overrule Shutdown (Stop)', name: 'overrule-shutdown', type: 'boolean', default: false, description: 'Whether to abort running shutdown tasks before stopping (Stop only)' },
				{ displayName: 'Purge (Delete)', name: 'purge', type: 'boolean', default: false, description: 'Whether to also remove the guest from backup jobs, replication jobs and HA (Delete only)' },
				{ displayName: 'Skip Lock', name: 'skiplock', type: 'boolean', default: false, description: 'Whether to ignore locks (root@pam only)' },
				...(kind === 'qemu'
					? [{ displayName: 'State Storage (Hibernate)', name: 'statestorage', type: 'string' as const, default: '', description: 'Storage for the saved RAM state (Hibernate only)' }]
					: []),
				{ displayName: 'Timeout (Seconds)', name: 'timeout', type: 'number', default: 0, description: 'Timeout for Start/Stop/Shutdown/Reboot (0 = Proxmox VE default)' },
			],
		},
		// ---------------- Clone
		{
			displayName: 'Clone Options',
			name: 'cloneOptions',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			displayOptions: { show: show(['clone']) },
			options: [
				{ displayName: 'Bandwidth Limit (KiB/s)', name: 'bwlimit', type: 'number', default: 0 },
				{ displayName: 'Description', name: 'description', type: 'string', default: '' },
				...(kind === 'qemu'
					? [
							{ displayName: 'Format', name: 'format', type: 'options' as const, default: 'raw', options: [
								{ name: 'Raw', value: 'raw' },
								{ name: 'QCOW2', value: 'qcow2' },
								{ name: 'VMDK', value: 'vmdk' },
							] },
						]
					: []),
				{ displayName: 'Full Clone', name: 'full', type: 'boolean', default: false, description: 'Whether to create a full copy instead of a linked clone' },
				{ displayName: kind === 'qemu' ? 'Name' : 'Hostname', name: kind === 'qemu' ? 'name' : 'hostname', type: 'string', default: '' },
				{ displayName: 'Pool', name: 'pool', type: 'string', default: '' },
				{ displayName: 'Snapshot Name', name: 'snapname', type: 'string', default: '' },
				{ displayName: 'Target Node', name: 'target', type: 'string', default: '', description: 'Node of the clone (only for shared storage)' },
				{ displayName: 'Target Storage', name: 'storage', type: 'string', default: '' },
			],
		},
		// ---------------- Migrate
		nodeLocator(show(['migrate']), { name: 'targetNode', displayName: 'Target Node', description: 'Node to migrate to' }),
		{
			displayName: 'Migrate Options',
			name: 'migrateOptions',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			displayOptions: { show: show(['migrate']) },
			options:
				kind === 'qemu'
					? [
							{ displayName: 'Bandwidth Limit (KiB/s)', name: 'bwlimit', type: 'number', default: 0 },
							{ displayName: 'Migration Network (CIDR)', name: 'migration_network', type: 'string', default: '' },
							{ displayName: 'Online', name: 'online', type: 'boolean', default: false, description: 'Whether to live migrate a running VM' },
							{ displayName: 'Target Storage', name: 'targetstorage', type: 'string', default: '', description: 'Storage mapping, e.g. local-lvm or source:target' },
							{ displayName: 'With Local Disks', name: 'with-local-disks', type: 'boolean', default: false },
						]
					: [
							{ displayName: 'Bandwidth Limit (KiB/s)', name: 'bwlimit', type: 'number', default: 0 },
							{ displayName: 'Online', name: 'online', type: 'boolean', default: false },
							{ displayName: 'Restart Mode', name: 'restart', type: 'boolean', default: false, description: 'Whether to use restart migration (stops and restarts the container)' },
							{ displayName: 'Target Storage', name: 'target-storage', type: 'string', default: '' },
							{ displayName: 'Timeout (Seconds)', name: 'timeout', type: 'number', default: 180, description: 'Shutdown timeout for restart migration' },
						],
		},
		// ---------------- Template
		...(kind === 'qemu'
			? [
					{
						displayName: 'Disk',
						name: 'templateDisk',
						type: 'string' as const,
						default: '',
						placeholder: 'scsi0',
						description: 'Only convert this disk to a base image (leave empty for the whole VM)',
						displayOptions: { show: show(['convertToTemplate']) },
					},
				]
			: []),
		// ---------------- Disks
		kind === 'qemu'
			? {
					displayName: 'Disk',
					name: 'disk',
					type: 'string',
					default: 'scsi0',
					required: true,
					description: 'Disk key, e.g. scsi0, virtio0, sata0',
					displayOptions: { show: show(['resizeDisk', 'moveDisk']) },
				}
			: {
					displayName: 'Volume',
					name: 'disk',
					type: 'string',
					default: 'rootfs',
					required: true,
					description: 'Volume key, e.g. rootfs or mp0',
					displayOptions: { show: show(['resizeDisk', 'moveDisk']) },
				},
		{
			displayName: 'Size',
			name: 'size',
			type: 'string',
			default: '+1G',
			required: true,
			description: 'New size (e.g. 50G) or increment with "+" (e.g. +10G). Shrinking is not supported.',
			displayOptions: { show: show(['resizeDisk']) },
		},
		storageLocator(show(['moveDisk']), { name: 'targetStorage', displayName: 'Target Storage', description: 'Storage to move the disk to' }),
		{
			displayName: 'Move Options',
			name: 'moveOptions',
			type: 'collection',
			placeholder: 'Add Option',
			default: {},
			displayOptions: { show: show(['moveDisk']) },
			options: [
				{ displayName: 'Bandwidth Limit (KiB/s)', name: 'bwlimit', type: 'number', default: 0 },
				{ displayName: 'Delete Source', name: 'delete', type: 'boolean', default: false, description: 'Whether to delete the original disk after a successful copy' },
				...(kind === 'qemu'
					? [
							{ displayName: 'Format', name: 'format', type: 'options' as const, default: 'raw', options: [
								{ name: 'Raw', value: 'raw' },
								{ name: 'QCOW2', value: 'qcow2' },
								{ name: 'VMDK', value: 'vmdk' },
							] },
						]
					: []),
			],
		},
		...rrdTimeframe(show(['getRrdData'])),
		// ---------------- Snapshots
		{
			displayName: 'Snapshot Name',
			name: 'snapname',
			type: 'string',
			default: '',
			required: true,
			description: 'Snapshot name (letters, digits, "_" and "-", starting with a letter)',
			displayOptions: { show: show(snapshotOps) },
		},
		{
			displayName: 'Description',
			name: 'snapshotDescription',
			type: 'string',
			default: '',
			displayOptions: { show: show(['createSnapshot', 'updateSnapshot']) },
		},
		...(kind === 'qemu'
			? [
					{
						displayName: 'Include RAM',
						name: 'vmstate',
						type: 'boolean' as const,
						default: false,
						description: 'Whether to save the RAM state of a running VM',
						displayOptions: { show: show(['createSnapshot']) },
					},
				]
			: []),
		{
			displayName: 'Start After Rollback',
			name: 'startAfterRollback',
			type: 'boolean',
			default: false,
			displayOptions: { show: show(['rollbackSnapshot']) },
		},
		{
			displayName: 'Force',
			name: 'forceDeleteSnapshot',
			type: 'boolean',
			default: false,
			description: 'Whether to remove the snapshot from the config even if removing disk snapshots fails',
			displayOptions: { show: show(['deleteSnapshot']) },
		},
		{
			displayName: 'Check VMID',
			name: 'checkVmid',
			type: 'number',
			default: 0,
			description: 'If set, check whether this VMID is free instead of returning the next free one',
			displayOptions: { show: show(['getNextFreeVmid']) },
		},
	);

	if (kind === 'qemu') {
		props.push(
			{
				displayName: 'Type',
				name: 'cloudInitType',
				type: 'options',
				default: 'user',
				options: [
					{ name: 'User', value: 'user' },
					{ name: 'Network', value: 'network' },
					{ name: 'Meta', value: 'meta' },
				],
				displayOptions: { show: show(['getCloudInitDump']) },
			},
			{
				displayName: 'Cloud-Init Fields',
				name: 'cloudInitFields',
				type: 'collection',
				placeholder: 'Add Field',
				default: {},
				displayOptions: { show: show(['updateCloudInit']) },
				options: [
					{ displayName: 'IP Config 0', name: 'ipconfig0', type: 'string', default: '', placeholder: 'ip=dhcp or ip=10.0.0.10/24,gw=10.0.0.1' },
					{ displayName: 'IP Config 1', name: 'ipconfig1', type: 'string', default: '' },
					{ displayName: 'Nameserver', name: 'nameserver', type: 'string', default: '' },
					{ displayName: 'Password', name: 'cipassword', type: 'string', typeOptions: { password: true }, default: '' },
					{ displayName: 'Search Domain', name: 'searchdomain', type: 'string', default: '' },
					{ displayName: 'SSH Public Keys', name: 'sshkeys', type: 'string', typeOptions: { rows: 4 }, default: '', description: 'One OpenSSH public key per line' },
					{ displayName: 'Type', name: 'citype', type: 'options', default: 'nocloud', options: [
						{ name: 'Config Drive 2', value: 'configdrive2' },
						{ name: 'NoCloud', value: 'nocloud' },
						{ name: 'OpenNebula', value: 'opennebula' },
					] },
					{ displayName: 'Upgrade Packages', name: 'ciupgrade', type: 'boolean', default: true },
					{ displayName: 'User', name: 'ciuser', type: 'string', default: '' },
				],
			},
		);
	}

	props.push(...commonOptions(resource, asyncOps, listOps));
	return props;
}

// -------------------------------------------------------------------------------------------------
// Handlers
// -------------------------------------------------------------------------------------------------

function pick(source: IDataObject, keys: string[]): IDataObject {
	const out: IDataObject = {};
	for (const k of keys) {
		const v = source[k];
		if (v === undefined || v === '' || v === null) continue;
		if ((k === 'timeout' || k === 'bwlimit') && v === 0) continue;
		out[k] = v;
	}
	return out;
}

function snapname(ctx: OperationContext): string {
	const s = ctx.str('snapname');
	if (!SNAPNAME.test(s)) throw ctx.client.error('Invalid snapshot name');
	return s;
}

function diskKey(ctx: OperationContext): string {
	const d = ctx.str('disk');
	if (!DISK.test(d)) throw ctx.client.error(`Invalid disk "${d.slice(0, 32)}"`);
	return d;
}

const POWER_KEYS: Record<GuestKind, Record<string, string[]>> = {
	qemu: {
		start: ['skiplock', 'timeout'],
		stop: ['skiplock', 'timeout', 'overrule-shutdown'],
		shutdown: ['skiplock', 'timeout', 'forceStop'],
		reboot: ['timeout'],
		reset: ['skiplock'],
		suspend: ['skiplock'],
		hibernate: ['skiplock', 'statestorage'],
		resume: ['skiplock'],
		delete: ['skiplock', 'purge', 'destroy-unreferenced-disks'],
	},
	lxc: {
		start: ['skiplock', 'debug'],
		stop: ['skiplock', 'overrule-shutdown'],
		shutdown: ['timeout', 'forceStop'],
		reboot: ['timeout'],
		suspend: [],
		resume: [],
		delete: ['force', 'purge', 'destroy-unreferenced-disks'],
	},
};

export function guestHandlers(kind: GuestKind): ResourceHandlers {
	const base = (ctx: OperationContext) => apiPath`/nodes/${ctx.node()}/${kind}/${ctx.vmid()}`;
	const power = (op: string, path: string) => async (ctx: OperationContext) => {
		const opts = pick(ctx.collection('powerOptions'), POWER_KEYS[kind][op] ?? []);
		return task(await ctx.client.post(`${base(ctx)}/status/${path}`, opts));
	};
	const createKey = kind === 'qemu' ? 'POST /nodes/{node}/qemu' : 'POST /nodes/{node}/lxc';
	const configKey = kind === 'qemu' ? 'POST /nodes/{node}/qemu/{vmid}/config' : 'PUT /nodes/{node}/lxc/{vmid}/config';

	const handlers: ResourceHandlers = {
		getMany: async (ctx) => {
			const opts = ctx.collection('listOptions');
			const node = ctx.node();
			const result = await ctx.client.get<IDataObject[]>(apiPath`/nodes/${node}/${kind}`, kind === 'qemu' ? pick(opts, ['full']) : {});
			let rows = Array.isArray(result) ? result : [];
			if (opts.runningOnly === true) rows = rows.filter((r) => r.status === 'running');
			return list(rows.map((r) => ({ ...r, node, type: kind })));
		},
		get: async (ctx) => {
			const node = ctx.node();
			const vmid = ctx.vmid();
			const path = apiPath`/nodes/${node}/${kind}/${vmid}`;
			const config = await ctx.client.get(`${path}/config`, pick(ctx.collection('configOptions'), ['current', 'snapshot']));
			const status = await ctx.client.get(`${path}/status/current`);
			return data({ vmid, node, type: kind, config, status });
		},
		getStatus: async (ctx) => data(await ctx.client.get(`${base(ctx)}/status/current`)),
		getConfig: async (ctx) =>
			data(await ctx.client.get(`${base(ctx)}/config`, pick(ctx.collection('configOptions'), ['current', 'snapshot']))),
		getPending: async (ctx) => list(await ctx.client.get(`${base(ctx)}/pending`)),
		create: async (ctx) => {
			const node = ctx.node();
			const vmid = validateVmid(ctx.param('newVmid'));
			const fields = ctx.collection('createFields');
			const body: IDataObject = { vmid, ...fields };
			if (kind === 'lxc') body.ostemplate = ctx.str('ostemplate');
			Object.assign(body, ctx.additional(createKey, 'additionalParameters', Object.keys(body)));
			return task(await ctx.client.post(apiPath`/nodes/${node}/${kind}`, body), { vmid, node });
		},
		updateConfig: async (ctx) => {
			const body: IDataObject = {
				...ctx.additional(configKey),
				...pick(ctx.collection('updateOptions'), ['delete', 'digest']),
			};
			if (Object.keys(body).length === 0) throw ctx.client.error('Nothing to update: add at least one parameter');
			const path = `${base(ctx)}/config`;
			if (kind === 'qemu') return task(await ctx.client.post(path, body));
			await ctx.client.put(path, body);
			return data({ success: true });
		},
		delete: async (ctx) => {
			const opts = pick(ctx.collection('powerOptions'), POWER_KEYS[kind].delete);
			return task(await ctx.client.delete(base(ctx), opts));
		},
		start: power('start', 'start'),
		stop: power('stop', 'stop'),
		shutdown: power('shutdown', 'shutdown'),
		reboot: power('reboot', 'reboot'),
		suspend: power('suspend', 'suspend'),
		resume: power('resume', 'resume'),
		clone: async (ctx) => {
			const newid = validateVmid(ctx.param('newVmid'));
			const opts = pick(ctx.collection('cloneOptions'), ['bwlimit', 'description', 'format', 'full', 'name', 'hostname', 'pool', 'snapname', 'target', 'storage']);
			if (opts.target) opts.target = validateNodeName(opts.target);
			if (opts.storage) opts.storage = validateStorageId(opts.storage);
			return task(await ctx.client.post(`${base(ctx)}/clone`, { newid, ...opts }), { newid });
		},
		migrate: async (ctx) => {
			const target = ctx.node('targetNode');
			const opts = pick(ctx.collection('migrateOptions'), [
				'bwlimit', 'migration_network', 'online', 'targetstorage', 'with-local-disks', 'restart', 'target-storage', 'timeout',
			]);
			return task(await ctx.client.post(`${base(ctx)}/migrate`, { target, ...opts }), { target });
		},
		convertToTemplate: async (ctx) => {
			const body: IDataObject = {};
			if (kind === 'qemu') {
				const disk = ctx.optStr('templateDisk');
				if (disk) {
					if (!DISK.test(disk)) throw ctx.client.error('Invalid disk');
					body.disk = disk;
				}
			}
			return task(await ctx.client.post(`${base(ctx)}/template`, body));
		},
		resizeDisk: async (ctx) => {
			const size = ctx.str('size');
			if (!/^\+?\d+(\.\d+)?[KMGT]?$/.test(size)) throw ctx.client.error('Invalid size, use e.g. 50G or +10G');
			return task(await ctx.client.put(`${base(ctx)}/resize`, { disk: diskKey(ctx), size }));
		},
		moveDisk: async (ctx) => {
			const storage = ctx.storage('targetStorage');
			const opts = pick(ctx.collection('moveOptions'), ['bwlimit', 'delete', 'format']);
			const disk = diskKey(ctx);
			if (kind === 'qemu') return task(await ctx.client.post(`${base(ctx)}/move_disk`, { disk, storage, ...opts }));
			return task(await ctx.client.post(`${base(ctx)}/move_volume`, { volume: disk, storage, ...opts }));
		},
		getRrdData: async (ctx) =>
			list(await ctx.client.get(`${base(ctx)}/rrddata`, { timeframe: ctx.str('timeframe'), cf: ctx.str('cf') })),
		getSnapshots: async (ctx) => list(await ctx.client.get(`${base(ctx)}/snapshot`)),
		createSnapshot: async (ctx) => {
			const body: IDataObject = { snapname: snapname(ctx) };
			const description = ctx.optStr('snapshotDescription');
			if (description) body.description = description;
			if (kind === 'qemu' && ctx.bool('vmstate')) body.vmstate = true;
			return task(await ctx.client.post(`${base(ctx)}/snapshot`, body), { snapname: body.snapname as string });
		},
		getSnapshotConfig: async (ctx) =>
			data(await ctx.client.get(`${base(ctx)}${apiPath`/snapshot/${snapname(ctx)}/config`}`)),
		updateSnapshot: async (ctx) => {
			await ctx.client.put(`${base(ctx)}${apiPath`/snapshot/${snapname(ctx)}/config`}`, {
				description: ctx.str('snapshotDescription'),
			});
			return data({ success: true });
		},
		rollbackSnapshot: async (ctx) => {
			const body: IDataObject = {};
			if (ctx.bool('startAfterRollback')) body.start = true;
			return task(await ctx.client.post(`${base(ctx)}${apiPath`/snapshot/${snapname(ctx)}/rollback`}`, body));
		},
		deleteSnapshot: async (ctx) => {
			const qs: IDataObject = {};
			if (ctx.bool('forceDeleteSnapshot')) qs.force = true;
			return task(await ctx.client.delete(`${base(ctx)}${apiPath`/snapshot/${snapname(ctx)}`}`, qs));
		},
		getNextFreeVmid: async (ctx) => {
			const check = Number(ctx.param('checkVmid', 0));
			const qs: IDataObject = {};
			if (check) qs.vmid = validateVmid(check);
			const vmid = await ctx.client.get('/cluster/nextid', qs);
			return data({ vmid: Number(vmid), free: true });
		},
	};

	if (kind === 'qemu') {
		Object.assign(handlers, {
			reset: power('reset', 'reset'),
			hibernate: async (ctx: OperationContext) => {
				const opts = pick(ctx.collection('powerOptions'), POWER_KEYS.qemu.hibernate);
				return task(await ctx.client.post(`${base(ctx)}/status/suspend`, { todisk: true, ...opts }));
			},
			getCloudInit: async (ctx: OperationContext) => list(await ctx.client.get(`${base(ctx)}/cloudinit`)),
			getCloudInitDump: async (ctx: OperationContext) => {
				const type = ctx.str('cloudInitType');
				if (!['user', 'network', 'meta'].includes(type)) throw ctx.client.error('Invalid cloud-init type');
				return data({ type, content: await ctx.client.get(`${base(ctx)}/cloudinit/dump`, { type }) });
			},
			updateCloudInit: async (ctx: OperationContext) => {
				const fields = ctx.collection('cloudInitFields');
				if (Object.keys(fields).length === 0) throw ctx.client.error('Nothing to update: add at least one cloud-init field');
				// Proxmox VE expects sshkeys URL-encoded
				if (typeof fields.sshkeys === 'string') fields.sshkeys = encodeURIComponent(fields.sshkeys.replace(/\r\n/g, '\n'));
				return task(await ctx.client.post(`${base(ctx)}/config`, fields));
			},
			regenerateCloudInit: async (ctx: OperationContext) => {
				await ctx.client.put(`${base(ctx)}/cloudinit`);
				return data({ success: true });
			},
		});
	}
	return handlers;
}
