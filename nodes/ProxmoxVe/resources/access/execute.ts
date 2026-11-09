import type { IDataObject } from 'n8n-workflow';

import { data, list, type ResourceHandlers } from '../../shared/engine';
import { apiPath } from '../../shared/security';

const USERID = /^[^\s@:/!]+@[A-Za-z][A-Za-z0-9._-]*$/;
const TOKEN_SECRET_KEYS = ['value', 'secret', 'token', 'full-tokenid-secret'];

/** Removes any secret material from token entries (the API does not return it, this is defense in depth). */
function stripTokenSecrets(entry: unknown): unknown {
	if (!entry || typeof entry !== 'object') return entry;
	const out: IDataObject = { ...(entry as IDataObject) };
	for (const k of TOKEN_SECRET_KEYS) delete out[k];
	return out;
}

export const accessHandlers: ResourceHandlers = {
	getUsers: async (ctx) => {
		const o = ctx.collection('userOptions');
		const users = await ctx.client.get<IDataObject[]>('/access/users', o);
		return list(
			(Array.isArray(users) ? users : []).map((u) =>
				Array.isArray(u.tokens) ? { ...u, tokens: (u.tokens as unknown[]).map(stripTokenSecrets) as IDataObject[] } : u,
			),
		);
	},
	getGroups: async (ctx) => list(await ctx.client.get('/access/groups')),
	getRoles: async (ctx) => list(await ctx.client.get('/access/roles')),
	getAcl: async (ctx) => list(await ctx.client.get('/access/acl')),
	getPermissions: async (ctx) => {
		const o = ctx.collection('permissionOptions');
		const qs: IDataObject = {};
		if (o.path) {
			if (!/^\/[A-Za-z0-9/_.@!-]*$/.test(String(o.path))) throw ctx.client.error('Invalid ACL path');
			qs.path = o.path;
		}
		if (o.userid) qs.userid = o.userid;
		return data(await ctx.client.get('/access/permissions', qs));
	},
	getApiTokens: async (ctx) => {
		const userid = ctx.str('userid');
		if (!USERID.test(userid)) throw ctx.client.error('Invalid user ID, use user@realm');
		const tokens = await ctx.client.get<unknown[]>(apiPath`/access/users/${userid}/token`);
		return list((Array.isArray(tokens) ? tokens : []).map((t) => ({ userid, ...(stripTokenSecrets(t) as IDataObject) })));
	},
};
