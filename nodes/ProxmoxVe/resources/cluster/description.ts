import type { INodeProperties } from 'n8n-workflow';

import { commonOptions } from '../../shared/descriptions';

const R = 'cluster';
const show = (ops: string[]) => ({ resource: [R], operation: ops });

export const clusterListOps = ['getStatus', 'getResources', 'getTasks', 'getLog'];

export const clusterDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'getStatus',
		options: [
			{ name: 'Get Backup Info', value: 'getBackupInfo', action: 'Get backup info of a backup job', description: 'Guests included in a backup job and the backup status of their disks (included_volumes endpoint)' },
			{ name: 'Get Log', value: 'getLog', action: 'Get the cluster log', description: 'Read recent cluster log entries' },
			{ name: 'Get Options', value: 'getOptions', action: 'Get datacenter options', description: 'Read datacenter options (some require Sys.Audit on /)' },
			{ name: 'Get Resources', value: 'getResources', action: 'Get cluster resources', description: 'List all VMs, containers, storages and nodes of the cluster with status and usage' },
			{ name: 'Get Status', value: 'getStatus', action: 'Get cluster status', description: 'Read cluster and quorum status with the list of nodes' },
			{ name: 'Get Tasks', value: 'getTasks', action: 'Get recent cluster tasks', description: 'List recent tasks of the whole cluster' },
			{ name: 'Get Version', value: 'getVersion', action: 'Get the API version', description: 'Read Proxmox VE version and release (GET /version)' },
		],
	},
	{
		displayName: 'Type',
		name: 'resourceType',
		type: 'options',
		default: '',
		options: [
			{ name: 'All', value: '' },
			{ name: 'Node', value: 'node' },
			{ name: 'SDN', value: 'sdn' },
			{ name: 'Storage', value: 'storage' },
			{ name: 'VM/Container', value: 'vm' },
		],
		displayOptions: { show: show(['getResources']) },
	},
	{
		displayName: 'Max Entries',
		name: 'max',
		type: 'number',
		default: 50,
		typeOptions: { minValue: 1 },
		description: 'Max number of results to return',
		displayOptions: { show: show(['getLog']) },
	},
	{
		displayName: 'Backup Job Name or ID',
		name: 'jobId',
		type: 'options',
		typeOptions: { loadOptionsMethod: 'getBackupJobs' },
		default: '',
		required: true,
		description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
		displayOptions: { show: show(['getBackupInfo']) },
	},
	...commonOptions(R, [], clusterListOps),
];
