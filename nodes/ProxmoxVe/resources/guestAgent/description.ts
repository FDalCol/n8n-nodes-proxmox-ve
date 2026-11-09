import type { INodeProperties } from 'n8n-workflow';

import { commonOptions, guestLocator, nodeLocator } from '../../shared/descriptions';

const R = 'guestAgent';
const show = (ops: string[]) => ({ resource: [R], operation: ops });

export const guestAgentListOps = ['getNetworkInterfaces', 'getFilesystems'];

const allOps = [
	'ping',
	'getInfo',
	'getOsInfo',
	'getNetworkInterfaces',
	'getFilesystems',
	'exec',
	'getExecStatus',
	'fileRead',
	'fileWrite',
	'fsFreeze',
	'fsThaw',
	'fsFreezeStatus',
	'shutdown',
];

export const guestAgentDescription: INodeProperties[] = [
	{
		displayName: 'Operation',
		name: 'operation',
		type: 'options',
		noDataExpression: true,
		displayOptions: { show: { resource: [R] } },
		default: 'ping',
		options: [
			{
				name: 'Exec',
				value: 'exec',
				action: 'Run a command inside a VM',
				description:
					'HIGH RISK: runs an arbitrary command inside the VM operating system via the QEMU guest agent, usually as root/SYSTEM. It can read, change or destroy any data in the guest. Use only when the user explicitly asks to run this exact command.',
			},
			{ name: 'File Read', value: 'fileRead', action: 'Read a file inside a VM', description: 'Read a file from the VM file system via the guest agent (max 16 MiB). May expose sensitive data.' },
			{
				name: 'File Write',
				value: 'fileWrite',
				action: 'Write a file inside a VM',
				description:
					'HIGH RISK: creates or overwrites a file inside the VM via the guest agent, usually as root/SYSTEM. Overwriting system files can break the guest. Use only when the user explicitly asks to write this file.',
			},
			{ name: 'FS Freeze', value: 'fsFreeze', action: 'Freeze guest file systems', description: 'DISRUPTIVE: freezes all guest file systems; writes block until FS Thaw. Use only on explicit request.' },
			{ name: 'FS Freeze Status', value: 'fsFreezeStatus', action: 'Get guest file system freeze status', description: 'Read whether the guest file systems are frozen' },
			{ name: 'FS Thaw', value: 'fsThaw', action: 'Thaw guest file systems', description: 'Unfreeze guest file systems' },
			{ name: 'Get Exec Status', value: 'getExecStatus', action: 'Get the status of a guest command', description: 'Read exit code and output of a command started with Exec' },
			{ name: 'Get Filesystems', value: 'getFilesystems', action: 'Get guest file systems', description: 'List mounted file systems of the guest' },
			{ name: 'Get Info', value: 'getInfo', action: 'Get guest agent info', description: 'Read guest agent version and supported commands' },
			{ name: 'Get Network Interfaces', value: 'getNetworkInterfaces', action: 'Get guest network interfaces', description: 'List network interfaces and IP addresses reported by the guest' },
			{ name: 'Get OS Info', value: 'getOsInfo', action: 'Get guest operating system info', description: 'Read operating system name, version and kernel of the guest' },
			{ name: 'Ping', value: 'ping', action: 'Ping the guest agent', description: 'Check whether the QEMU guest agent responds' },
			{ name: 'Shutdown', value: 'shutdown', action: 'Shut down a VM via the guest agent', description: 'DISRUPTIVE: asks the guest OS to shut down through the agent, stopping its workload. Use only on explicit request.' },
		],
	},
	nodeLocator(show(allOps)),
	guestLocator('qemu', show(allOps)),
	{
		displayName: 'Command',
		name: 'command',
		type: 'string',
		default: '',
		required: true,
		placeholder: '/usr/bin/uptime',
		description: 'Program to run (full path recommended). Arguments go into "Arguments", one per entry. No shell is involved.',
		displayOptions: { show: show(['exec']) },
	},
	{
		displayName: 'Arguments',
		name: 'arguments',
		type: 'string',
		typeOptions: { multipleValues: true, multipleValueButtonText: 'Add Argument' },
		default: [],
		displayOptions: { show: show(['exec']) },
	},
	{
		displayName: 'Input Data',
		name: 'inputData',
		type: 'string',
		typeOptions: { rows: 3 },
		default: '',
		description: 'Data passed to the standard input of the command',
		displayOptions: { show: show(['exec']) },
	},
	{
		displayName: 'Wait For Result',
		name: 'waitForResult',
		type: 'boolean',
		default: true,
		description: 'Whether to wait until the command exits (polling exec-status) and return exit code and output',
		displayOptions: { show: show(['exec']) },
	},
	{
		displayName: 'Wait Options',
		name: 'execWaitOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: { ...show(['exec']), waitForResult: [true] } },
		options: [
			{ displayName: 'Poll Interval (Seconds)', name: 'pollInterval', type: 'number', default: 1, typeOptions: { minValue: 1 } },
			{ displayName: 'Timeout (Seconds)', name: 'timeout', type: 'number', default: 60, typeOptions: { minValue: 1, maxValue: 86400 }, description: 'Maximum wait (max 86400 = 24 h). The command keeps running after a timeout.' },
		],
	},
	{
		displayName: 'PID',
		name: 'pid',
		type: 'number',
		default: 0,
		required: true,
		description: 'Process ID returned by Exec',
		displayOptions: { show: show(['getExecStatus']) },
	},
	{
		displayName: 'File Path',
		name: 'file',
		type: 'string',
		default: '',
		required: true,
		placeholder: '/etc/hostname',
		description: 'Absolute path of the file inside the guest',
		displayOptions: { show: show(['fileRead', 'fileWrite']) },
	},
	{
		displayName: 'Read Options',
		name: 'readOptions',
		type: 'collection',
		placeholder: 'Add Option',
		default: {},
		displayOptions: { show: show(['fileRead']) },
		options: [
			{ displayName: 'Count (Bytes, 9.x)', name: 'count', type: 'number', default: 0, description: 'Number of bytes to read (Proxmox VE 9.x, 0 = whole file)' },
			{ displayName: 'Offset (Bytes, 9.x)', name: 'offset', type: 'number', default: 0, description: 'Start reading at this byte offset (Proxmox VE 9.x)' },
		],
	},
	{
		displayName: 'Content Source',
		name: 'contentSource',
		type: 'options',
		default: 'text',
		options: [
			{ name: 'Text', value: 'text' },
			{ name: 'Binary Data', value: 'binary' },
		],
		displayOptions: { show: show(['fileWrite']) },
	},
	{
		displayName: 'Content',
		name: 'content',
		type: 'string',
		typeOptions: { rows: 5 },
		default: '',
		description: 'Text to write (max 61440 characters)',
		displayOptions: { show: { ...show(['fileWrite']), contentSource: ['text'] } },
	},
	{
		displayName: 'Input Binary Field',
		name: 'binaryPropertyName',
		type: 'string',
		default: 'data',
		required: true,
		description: 'Name of the binary field with the file content (max 45 KiB, sent base64 encoded)',
		displayOptions: { show: { ...show(['fileWrite']), contentSource: ['binary'] } },
	},
	...commonOptions(R, [], guestAgentListOps),
];
