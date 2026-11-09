import type {
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

/**
 * Proxmox VE API credential.
 *
 * - API Token (default): header `Authorization: PVEAPIToken=<user@realm!tokenid>=<secret>`.
 * - Username/Password: the node logs in once per execution (POST /access/ticket, credentials in the
 *   request body) and keeps ticket and CSRFPreventionToken in memory only.
 */
export class ProxmoxVeApi implements ICredentialType {
	name = 'proxmoxVeApi';

	displayName = 'Proxmox VE API';

	icon: Icon = { light: 'file:../icons/proxmoxVe.svg', dark: 'file:../icons/proxmoxVe.dark.svg' };

	documentationUrl = 'https://github.com/FDalCol/n8n-nodes-proxmox-ve#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'https://pve.example.com:8006',
			description:
				'Address of a Proxmox VE node or cluster, without /api2/json. Must use https:// and must not contain credentials, query or fragment.',
		},
		{
			displayName: 'Authentication',
			name: 'authentication',
			type: 'options',
			options: [
				{ name: 'API Token', value: 'apiToken' },
				{ name: 'Username/Password', value: 'password' },
			],
			default: 'apiToken',
		},
		{
			displayName: 'Token ID',
			name: 'tokenId',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'n8n@pve!automation',
			description: 'Full token ID in the format user@realm!tokenid',
			displayOptions: { show: { authentication: ['apiToken'] } },
		},
		{
			displayName: 'Secret',
			name: 'tokenSecret',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'Token secret (UUID shown once when the token is created)',
			displayOptions: { show: { authentication: ['apiToken'] } },
		},
		{
			displayName: 'Username',
			name: 'username',
			type: 'string',
			default: '',
			required: true,
			placeholder: 'n8n@pve',
			description: 'User in the format user@realm (for example root@pam or n8n@pve)',
			displayOptions: { show: { authentication: ['password'] } },
		},
		{
			displayName: 'Password',
			name: 'password',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			displayOptions: { show: { authentication: ['password'] } },
		},
		{
			displayName: 'Allow Self-Signed Certificate',
			name: 'allowSelfSigned',
			type: 'boolean',
			default: false,
			description:
				'Whether to accept self-signed or otherwise invalid TLS certificates. The connection always stays on HTTPS.',
		},
		{
			displayName: 'Allow Insecure HTTP',
			name: 'allowHttp',
			type: 'boolean',
			default: false,
			description:
				'Whether to allow a Base URL starting with http://. Only enable this for a trusted local network: tokens and passwords are then sent unencrypted.',
		},
		{
			displayName:
				'Warning: with plain HTTP the token, password and session ticket travel unencrypted. Use HTTPS whenever possible.',
			name: 'httpNotice',
			type: 'notice',
			default: '',
			displayOptions: { show: { allowHttp: [true] } },
		},
	];

	authenticate = async (
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> => {
		if (credentials.authentication === 'password') {
			// Ticket and CSRF token are added per request by the node transport (kept in memory only).
			return requestOptions;
		}
		const tokenId = String(credentials.tokenId ?? '').trim();
		const secret = String(credentials.tokenSecret ?? '').trim();
		return {
			...requestOptions,
			headers: {
				...(requestOptions.headers ?? {}),
				Authorization: `PVEAPIToken=${tokenId}=${secret}`,
			},
		};
	};

	test: ICredentialTestRequest = {
		request: {
			// https only; http only when explicitly allowed. Anything else resolves to an unreachable
			// .invalid host, so the test fails without contacting any server.
			baseURL:
				'={{ (/^https:\\/\\/[^\\/@?#]+(\\/[^?#@]*)?$/i.test(String($credentials.baseUrl || "").trim()) || ($credentials.allowHttp === true && /^http:\\/\\/[^\\/@?#]+(\\/[^?#@]*)?$/i.test(String($credentials.baseUrl || "").trim()))) ? String($credentials.baseUrl).trim().replace(/\\/+$/, "") + "/api2/json" : "https://base-url-must-use-https-without-credentials-query-or-fragment.invalid" }}',
			url: '={{ $credentials.authentication === "password" ? "/access/ticket" : "/version" }}',
			method: '={{ $credentials.authentication === "password" ? "POST" : "GET" }}' as 'GET',
			body: '={{ $credentials.authentication === "password" ? { username: $credentials.username, password: $credentials.password } : undefined }}' as unknown as undefined,
			headers: {
				Accept: 'application/json',
			},
			skipSslCertificateValidation:
				'={{ $credentials.allowSelfSigned === true }}' as unknown as boolean,
			disableFollowRedirect: true,
		},
		rules: [
			{
				type: 'responseCode',
				properties: {
					value: 401,
					message:
						'Authentication failed (401): check Token ID and Secret, or username (user@realm) and password',
				},
			},
			{
				type: 'responseCode',
				properties: {
					value: 403,
					message:
						'Permission denied (403): the user or token is valid but lacks the required privileges',
				},
			},
		],
	};
}
