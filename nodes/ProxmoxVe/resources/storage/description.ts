import type { INodeProperties } from 'n8n-workflow';

import { commonOptions, nodeLocator, rrdTimeframe, storageLocator } from '../../shared/descriptions';

const R = 'storage';
const show = (ops: string[]) => ({ resource: [R], operation: ops });

export const storageAsyncOps = ['upload', 'downloadFromUrl', 'deleteVolume'];
export const storageListOps = ['getMany', 'getContent', 'getRrdData'];

const allOps = ['getMany', 'getStatus', 'getContent', 'upload', 'downloadFromUrl', 'allocateVolume', 'deleteVolume', 'getRrdData'];

const checksumAlgorithms = ['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512'].map((v) => ({ name: v.toUpperCase(), value: v }));

export const storageDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'getMany',
		options: [
			{ name: 'Allocate Volume', value: 'allocateVolume', action: 'Allocate a disk image', description: 'Allocate a new disk image on a storage' },
			{ name: 'Delete Volume', value: 'deleteVolume', action: 'Delete a volume', description: 'DESTRUCTIVE: permanently deletes a volume (disk image, ISO, template or backup) from the storage. Cannot be undone. Use only on explicit request.' },
			{ name: 'Download From URL', value: 'downloadFromUrl', action: 'Download an ISO or template from a URL', description: 'Let Proxmox VE download an ISO image, container template or import image from a URL, with optional checksum verification' },
			{ name: 'Get Content', value: 'getContent', action: 'Get the content of a storage', description: 'List volumes (images, ISOs, templates, backups) on a storage' },
			{ name: 'Get Many', value: 'getMany', action: 'Get many storages', description: 'List storages available on a node with usage' },
			{ name: 'Get RRD Data', value: 'getRrdData', action: 'Get storage RRD statistics', description: 'Read usage statistics of a storage' },
			{ name: 'Get Status', value: 'getStatus', action: 'Get the status of a storage', description: 'Read usage and status of a storage' },
			{ name: 'Upload', value: 'upload', action: 'Upload a file to a storage', description: 'Upload an ISO image, container template or import image from n8n binary data' },
		],
	},
	nodeLocator(show(allOps)),
	storageLocator(show(allOps.filter((o) => o !== 'getMany'))),
	{
		displayName: 'Filters',
		name: 'storageFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: show(['getMany']) },
		options: [
			{ displayName: 'Content Type', name: 'content', type: 'string', default: '', placeholder: 'images,iso', description: 'Only storages that support these content types' },
			{ displayName: 'Enabled Only', name: 'enabled', type: 'boolean', default: false },
		],
	},
	{
		displayName: 'Filters',
		name: 'contentFilters',
		type: 'collection',
		placeholder: 'Add Filter',
		default: {},
		displayOptions: { show: show(['getContent']) },
		options: [
			{
				displayName: 'Content Type',
				name: 'content',
				type: 'options',
				default: 'iso',
				options: [
					{ name: 'Backup', value: 'backup' },
					{ name: 'Container Root Dir', value: 'rootdir' },
					{ name: 'Container Template', value: 'vztmpl' },
					{ name: 'Disk Image', value: 'images' },
					{ name: 'Import', value: 'import' },
					{ name: 'ISO Image', value: 'iso' },
					{ name: 'Snippets', value: 'snippets' },
				],
			},
			{ displayName: 'VMID', name: 'vmid', type: 'number', default: 0, description: 'Only volumes of this guest' },
		],
	},
	{
		displayName: 'Content Type',
		name: 'uploadContent',
		type: 'options',
		default: 'iso',
		options: [
			{ name: 'ISO Image', value: 'iso' },
			{ name: 'Container Template', value: 'vztmpl' },
			{ name: 'Import (OVA/Disk Image)', value: 'import' },
		],
		displayOptions: { show: show(['upload', 'downloadFromUrl']) },
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		description: 'Binary field with the file to upload. The file is held in memory during the upload (timeout 30 minutes).',
		displayOptions: { show: show(['upload']) },
	},
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'https://example.com/debian-13.iso',
		description: 'HTTP(S) URL that Proxmox VE downloads from',
		displayOptions: { show: show(['downloadFromUrl']) },
	},
	{
		displayName: 'File Name',
		name: 'filename',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'debian-13.iso',
		description: 'Target file name on the storage',
		displayOptions: { show: show(['downloadFromUrl']) },
	},
	{
		displayName: 'Options',
		name: 'transferOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['upload', 'downloadFromUrl']) },
		options: [
			{ displayName: 'Checksum', name: 'checksum', type: 'string', default: '', description: 'Expected checksum of the file; the transfer fails if it does not match' },
			{ displayName: 'Checksum Algorithm', name: 'checksum-algorithm', type: 'options', default: 'sha256', options: checksumAlgorithms },
			{ displayName: 'Decompression (Download)', name: 'compression', type: 'options', default: '', options: [
				{ name: 'Bzip2', value: 'bz2' },
				{ name: 'Gzip', value: 'gz' },
				{ name: 'LZO', value: 'lzo' },
				{ name: 'None', value: '' },
				{ name: 'Zstd', value: 'zst' },
			], description: 'Decompress the downloaded file (Download From URL, ISO only)' },
			{ displayName: 'File Name (Upload)', name: 'filename', type: 'string', default: '', description: 'Target file name (Upload). Defaults to the file name of the binary data.' },
			{ displayName: 'Verify Certificates (Download)', name: 'verify-certificates', type: 'boolean', default: true, description: 'Whether Proxmox VE verifies the TLS certificate of the download URL' },
		],
	},
	{
		displayName: 'VMID',
		name: 'allocVmid',
		type: 'number',
		default: 100,
		required: true,
		description: 'Owner VMID of the new volume',
		displayOptions: { show: show(['allocateVolume']) },
	},
	{
		displayName: 'File Name',
		name: 'allocFilename',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'vm-100-disk-1',
		displayOptions: { show: show(['allocateVolume']) },
	},
	{
		displayName: 'Size',
		name: 'allocSize',
		type: 'string',
		default: '4G',
		required: true,
		description: 'Size, e.g. 4G or 512M',
		displayOptions: { show: show(['allocateVolume']) },
	},
	{
		displayName: 'Format',
		name: 'allocFormat',
		type: 'options',
		default: 'raw',
		options: [
			{ name: 'Raw', value: 'raw' },
			{ name: 'QCOW2', value: 'qcow2' },
			{ name: 'Subvol', value: 'subvol' },
			{ name: 'VMDK', value: 'vmdk' },
		],
		displayOptions: { show: show(['allocateVolume']) },
	},
	{
		displayName: 'Volume ID',
		name: 'volume',
		type: 'string',
		default: '',
		required: true,
		placeholder: 'local:iso/debian-13.iso',
		displayOptions: { show: show(['deleteVolume']) },
	},
	...rrdTimeframe(show(['getRrdData'])),
	...commonOptions(R, storageAsyncOps, storageListOps),
];
