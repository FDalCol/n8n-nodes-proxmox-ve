import type { INodeProperties } from 'n8n-workflow';

import { API_VIEWER_URL, commonOptions } from '../../shared/descriptions';

const R = 'customApiCall';
const show = { resource: [R], operation: ['call'] };

export const customApiCallDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'call',
		options: [
			{
				name: 'Call',
				value: 'call',
				action: 'Make a custom API call',
				description:
					'HIGH RISK: sends any request (GET, POST, PUT, DELETE) to the Proxmox VE API. Write methods can change or destroy anything the credential is allowed to touch. Use only when the user explicitly asks for this exact call; prefer the dedicated operations.',
			},
		],
	},
	{
		displayName: `Sends a request to any path under /api2/json. Absolute URLs and paths outside the API are rejected. See the <a href="${API_VIEWER_URL}" target="_blank">API Viewer</a>.`,
		name: 'customNotice',
		type: 'notice',
		default: '',
		displayOptions: { show },
	},
	{
		displayName: 'Method',
		name: 'method',
		type: 'options',
		default: 'GET',
		options: [
			{ name: 'DELETE', value: 'DELETE' },
			{ name: 'GET', value: 'GET' },
			{ name: 'POST', value: 'POST' },
			{ name: 'PUT', value: 'PUT' },
		],
		displayOptions: { show },
	},
	{
		displayName: 'Path',
		name: 'path',
		type: 'string',
		default: '',
		required: true,
		placeholder: '/nodes/pve1/status',
		description: 'Path below the API root (the /api2/… prefix is added automatically)',
		displayOptions: { show },
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
					{ displayName: 'Name', name: 'name', type: 'string', default: '' },
					{ displayName: 'Value', name: 'value', type: 'string', default: '' },
				],
			},
		],
	},
	{
		displayName: 'Body (JSON)',
		name: 'body',
		type: 'json',
		default: '{}',
		description: 'Parameters for POST/PUT as a flat JSON object; sent form-encoded like the Proxmox VE GUI does',
		displayOptions: { show: { ...show, method: ['POST', 'PUT'] } },
	},
	...commonOptions(R, ['call'], ['call']),
];
