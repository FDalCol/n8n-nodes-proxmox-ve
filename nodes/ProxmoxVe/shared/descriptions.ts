import type { IDisplayOptions, INodeProperties } from 'n8n-workflow';

type Show = NonNullable<IDisplayOptions['show']>;

interface FieldOptions {
	name?: string;
	displayName?: string;
	required?: boolean;
	description?: string;
}

export function nodeLocator(show: Show, opts: FieldOptions = {}): INodeProperties {
	return {
		displayName: opts.displayName ?? 'Node',
		name: opts.name ?? 'node',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: opts.required ?? true,
		description: opts.description ?? 'Proxmox VE cluster node',
		displayOptions: { show },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchNodes', searchable: true },
			},
			{
				displayName: 'Name',
				name: 'id',
				type: 'string',
				placeholder: 'pve1',
				validation: [
					{
						type: 'regex',
						properties: { regex: '^[A-Za-z0-9][A-Za-z0-9.-]*$', errorMessage: 'Not a valid node name' },
					},
				],
			},
		],
	};
}

export function guestLocator(kind: 'qemu' | 'lxc' | 'any', show: Show, opts: FieldOptions = {}): INodeProperties {
	const method = kind === 'qemu' ? 'searchVms' : kind === 'lxc' ? 'searchContainers' : 'searchGuests';
	const label = kind === 'qemu' ? 'VM' : kind === 'lxc' ? 'Container' : 'Guest';
	return {
		displayName: opts.displayName ?? `${label} ID`,
		name: opts.name ?? 'vmid',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: opts.required ?? true,
		description: opts.description ?? `${label} (VMID). The list shows the guests of the selected node.`,
		displayOptions: { show },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: method, searchable: true },
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: '100',
				validation: [
					{ type: 'regex', properties: { regex: '^[1-9][0-9]{2,8}$', errorMessage: 'VMID must be a number between 100 and 999999999' } },
				],
			},
		],
	};
}

export function storageLocator(show: Show, opts: FieldOptions = {}): INodeProperties {
	return {
		displayName: opts.displayName ?? 'Storage',
		name: opts.name ?? 'storage',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: opts.required ?? true,
		description: opts.description ?? 'Storage ID. The list shows the storages available on the selected node.',
		displayOptions: { show },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchStorages', searchable: true },
			},
			{
				displayName: 'ID',
				name: 'id',
				type: 'string',
				placeholder: 'local',
				validation: [
					{ type: 'regex', properties: { regex: '^[A-Za-z][A-Za-z0-9._-]*$', errorMessage: 'Not a valid storage ID' } },
				],
			},
		],
	};
}

/** Wait For Completion and Split Into Items options for one resource. */
export function commonOptions(resource: string, asyncOps: string[], listOps: string[]): INodeProperties[] {
	const props: INodeProperties[] = [];
	if (asyncOps.length) {
		props.push(
			{
				displayName: 'Wait For Completion',
				name: 'waitForCompletion',
				type: 'boolean',
				default: false,
				description:
					'Whether to wait until the Proxmox VE task finishes and return its status and exit status. The node fails if the task fails.',
				displayOptions: { show: { resource: [resource], operation: asyncOps } },
			},
			{
				displayName: 'Wait Options',
				name: 'waitOptions',
				type: 'collection',
				placeholder: 'Add Option',
				default: {},
				displayOptions: { show: { resource: [resource], operation: asyncOps, waitForCompletion: [true] } },
				options: [
					{
						displayName: 'Poll Interval (Seconds)',
						name: 'pollInterval',
						type: 'number',
						default: 2,
						typeOptions: { minValue: 1 },
						description: 'Seconds between status checks (minimum 1)',
					},
					{
						displayName: 'Timeout (Seconds)',
						name: 'timeout',
						type: 'number',
						default: 3600,
						typeOptions: { minValue: 1, maxValue: 86400 },
						description: 'Maximum time to wait (maximum 86400 = 24 h). The task keeps running after a timeout.',
					},
				],
			},
		);
	}
	if (listOps.length) {
		props.push({
			displayName: 'Split Into Items',
			name: 'splitIntoItems',
			type: 'boolean',
			default: true,
			description: 'Whether to output one item per list entry. If disabled, one item with a "data" array is returned.',
			displayOptions: { show: { resource: [resource], operation: listOps } },
		});
	}
	return props;
}

export function additionalParameters(show: Show, description: string, name = 'additionalParameters'): INodeProperties {
	return {
		displayName: 'Additional Parameters',
		name,
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Parameter',
		default: {},
		description,
		displayOptions: { show },
		options: [
			{
				name: 'parameter',
				displayName: 'Parameter',
				values: [
					{ displayName: 'Name', name: 'name', type: 'string', default: '', placeholder: 'net0' },
					{ displayName: 'Value', name: 'value', type: 'string', default: '', placeholder: 'virtio,bridge=vmbr0' },
				],
			},
		],
	};
}

export const rrdTimeframe = (show: Show): INodeProperties[] => [
	{
		displayName: 'Timeframe',
		name: 'timeframe',
		type: 'options',
		options: [
			{ name: 'Day', value: 'day' },
			{ name: 'Hour', value: 'hour' },
			{ name: 'Month', value: 'month' },
			{ name: 'Week', value: 'week' },
			{ name: 'Year', value: 'year' },
		],
		default: 'hour',
		displayOptions: { show },
	},
	{
		displayName: 'Consolidation Function',
		name: 'cf',
		type: 'options',
		options: [
			{ name: 'Average', value: 'AVERAGE' },
			{ name: 'Max', value: 'MAX' },
		],
		default: 'AVERAGE',
		displayOptions: { show },
	},
];

export const API_VIEWER_URL = 'https://pve.proxmox.com/pve-docs/api-viewer/';
