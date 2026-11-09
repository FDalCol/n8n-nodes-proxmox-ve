import {
	NodeConnectionTypes,
	NodeOperationError,
	type IExecuteFunctions,
	type INodeExecutionData,
	type INodeType,
	type INodeTypeDescription,
} from 'n8n-workflow';

import { accessDescription } from './resources/access/description';
import { accessHandlers } from './resources/access/execute';
import { backupDescription } from './resources/backup/description';
import { backupHandlers } from './resources/backup/execute';
import { backupJobDescription } from './resources/backupJob/description';
import { backupJobHandlers } from './resources/backupJob/execute';
import { clusterDescription } from './resources/cluster/description';
import { clusterHandlers } from './resources/cluster/execute';
import { containerDescription } from './resources/container/description';
import { containerHandlers } from './resources/container/execute';
import { customApiCallDescription } from './resources/customApiCall/description';
import { customApiCallHandlers } from './resources/customApiCall/execute';
import { guestAgentDescription } from './resources/guestAgent/description';
import { guestAgentHandlers } from './resources/guestAgent/execute';
import { haDescription } from './resources/ha/description';
import { haHandlers } from './resources/ha/execute';
import { nodeDescription } from './resources/node/description';
import { nodeHandlers } from './resources/node/execute';
import { poolDescription } from './resources/pool/description';
import { poolHandlers } from './resources/pool/execute';
import { replicationDescription } from './resources/replication/description';
import { replicationHandlers } from './resources/replication/execute';
import { storageDescription } from './resources/storage/description';
import { storageHandlers } from './resources/storage/execute';
import { taskDescription } from './resources/task/description';
import { taskHandlers } from './resources/task/execute';
import { vmDescription } from './resources/vm/description';
import { vmHandlers } from './resources/vm/execute';
import { finalize, OperationContext, safeError, type ResourceHandlers } from './shared/engine';
import { listSearch, loadOptions } from './shared/methods';
import { ProxmoxClient } from './shared/transport';

const HANDLERS: Record<string, ResourceHandlers> = {
	node: nodeHandlers,
	vm: vmHandlers,
	container: containerHandlers,
	guestAgent: guestAgentHandlers,
	storage: storageHandlers,
	backup: backupHandlers,
	backupJob: backupJobHandlers,
	cluster: clusterHandlers,
	ha: haHandlers,
	pool: poolHandlers,
	replication: replicationHandlers,
	access: accessHandlers,
	task: taskHandlers,
	customApiCall: customApiCallHandlers,
};

export class ProxmoxVe implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Proxmox VE',
		name: 'proxmoxVe',
		icon: { light: 'file:../../icons/proxmoxVe.svg', dark: 'file:../../icons/proxmoxVe.dark.svg' },
		group: ['transform'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Manage Proxmox VE nodes, VMs, containers, storage, backups, cluster and tasks',
		defaults: {
			name: 'Proxmox VE',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'proxmoxVeApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Access', value: 'access', description: 'Users, groups, roles, permissions and API tokens (read-only)' },
					{ name: 'Backup', value: 'backup', description: 'Create, list, delete and prune backups' },
					{ name: 'Backup Job', value: 'backupJob', description: 'Read scheduled backup jobs and run them now' },
					{ name: 'Cluster', value: 'cluster', description: 'Cluster status, resources, tasks, log, options and version' },
					{ name: 'Container (LXC)', value: 'container', description: 'LXC containers' },
					{ name: 'Custom API Call', value: 'customApiCall', description: 'Any request to the Proxmox VE API (high risk)' },
					{ name: 'Guest Agent', value: 'guestAgent', description: 'QEMU guest agent commands inside VMs' },
					{ name: 'High Availability', value: 'ha', description: 'HA resources, rules (9.x), groups (8.x) and status' },
					{ name: 'Node', value: 'node', description: 'Cluster nodes, services, updates, logs, network and disks' },
					{ name: 'Pool', value: 'pool', description: 'Resource pools' },
					{ name: 'Replication', value: 'replication', description: 'Storage replication jobs' },
					{ name: 'Storage', value: 'storage', description: 'Storages, content, uploads and downloads' },
					{ name: 'Task', value: 'task', description: 'Task status, log, stop and wait' },
					{ name: 'VM (QEMU)', value: 'vm', description: 'QEMU virtual machines' },
				],
				default: 'vm',
			},
			...nodeDescription,
			...vmDescription,
			...containerDescription,
			...guestAgentDescription,
			...storageDescription,
			...backupDescription,
			...backupJobDescription,
			...clusterDescription,
			...haDescription,
			...poolDescription,
			...replicationDescription,
			...accessDescription,
			...taskDescription,
			...customApiCallDescription,
		],
	};

	methods = { listSearch, loadOptions };

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const output: INodeExecutionData[] = [];
		let client: ProxmoxClient | undefined;

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				client = client ?? (await ProxmoxClient.create(this));
				const resource = this.getNodeParameter('resource', itemIndex) as string;
				const operation = this.getNodeParameter('operation', itemIndex) as string;
				const handler = HANDLERS[resource]?.[operation];
				if (!handler) {
					throw new NodeOperationError(this.getNode(), `Unsupported operation "${operation}" for resource "${resource}"`, { itemIndex });
				}
				const ctx = new OperationContext(this, client, itemIndex);
				output.push(...(await finalize(ctx, await handler(ctx))));
			} catch (error) {
				const { message, description } = safeError(client, error);
				if (this.continueOnFail()) {
					output.push({
						json: description ? { error: message, details: description } : { error: message },
						pairedItem: { item: itemIndex },
					});
					continue;
				}
				throw new NodeOperationError(this.getNode(), message, { itemIndex, description });
			}
		}
		return [output];
	}
}
