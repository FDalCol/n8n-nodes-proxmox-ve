import catalogJson from '../generated/apiCatalog.json';

export interface CatalogParam {
	/** name */
	n: string;
	/** type (string, integer, number, boolean, array ...) */
	t: string;
	/** required: 1 or 0 */
	r: number;
	/** location */
	in?: 'path' | 'query';
	/** enum values */
	e?: string[];
}

export interface CatalogEndpoint {
	/** path template relative to /api2/json */
	p: string;
	params: CatalogParam[];
}

/** All GET endpoints of the Proxmox VE API (generated at build time from apidoc.js, names and types only). */
export const API_CATALOG: readonly CatalogEndpoint[] = catalogJson as CatalogEndpoint[];

const BY_PATH = new Map(API_CATALOG.map((e) => [e.p, e]));

export function findEndpoint(path: string): CatalogEndpoint | undefined {
	return BY_PATH.get(path);
}
