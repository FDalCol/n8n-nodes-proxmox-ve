import type { INodeProperties } from 'n8n-workflow';

import { API_VIEWER_URL, commonOptions } from '../../shared/descriptions';

const R = 'apiRead';
const show = { resource: [R], operation: ['get'] };

export const apiReadDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'get',
		options: [
			{
				name: 'Get',
				value: 'get',
				action: 'Read an endpoint',
				description: 'Call any read-only (GET) endpoint of the Proxmox VE API. Only GET is ever sent.',
			},
		],
	},
	{
		displayName: `Read-only access to every GET endpoint of the Proxmox VE API. Parameters and returned fields are documented in the <a href="${API_VIEWER_URL}" target="_blank">official API Viewer</a>.`,
		name: 'apiReadNotice',
		type: 'notice',
		default: '',
		displayOptions: { show },
	},
	{
		displayName: 'Endpoint',
		name: 'endpoint',
		type: 'resourceLocator',
		default: { mode: 'list', value: '' },
		required: true,
		description: 'GET endpoint path below the API root, e.g. /nodes/{node}/qemu',
		displayOptions: { show },
		modes: [
			{
				displayName: 'From List',
				name: 'list',
				type: 'list',
				typeOptions: { searchListMethod: 'searchApiEndpoints', searchable: true },
			},
			{
				displayName: 'Path',
				name: 'path',
				type: 'string',
				placeholder: '/nodes/{node}/qemu',
				validation: [
					{ type: 'regex', properties: { regex: '^/[A-Za-z0-9_{}/.-]*$', errorMessage: 'Use a path template such as /nodes/{node}/qemu' } },
				],
			},
		],
	},
	{
		displayName: 'Path Parameters',
		name: 'pathParameters',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Path Parameter',
		default: {},
		description: 'Values for the {placeholders} in the endpoint path',
		displayOptions: { show },
		options: [
			{
				name: 'parameter',
				displayName: 'Parameter',
				values: [
					{
						displayName: 'Name or ID',
						name: 'name',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getApiPathParams', loadOptionsDependsOn: ['endpoint.value'] },
						default: '',
						description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					},
					{ displayName: 'Value', name: 'value', type: 'string', default: '' },
				],
			},
		],
	},
	{
		displayName: 'Query Parameters',
		name: 'queryParameters',
		type: 'fixedCollection',
		typeOptions: { multipleValues: true },
		placeholder: 'Add Query Parameter',
		default: {},
		displayOptions: { show },
		options: [
			{
				name: 'parameter',
				displayName: 'Parameter',
				values: [
					{
						displayName: 'Name or ID',
						name: 'name',
						type: 'options',
						typeOptions: { loadOptionsMethod: 'getApiQueryParams', loadOptionsDependsOn: ['endpoint.value'] },
						default: '',
						description: 'Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
					},
					{ displayName: 'Value', name: 'value', type: 'string', default: '' },
				],
			},
		],
	},
	...commonOptions(R, [], ['get']),
];
