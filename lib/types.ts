export interface Settings {
	IP2LOCATION_API_KEY?: string;
	CACHE_TTL?: string;
	BACKEND?: string;
	API_BACKEND?: string;
	ALLOW_QUERY_IP?: string;
	ALLOWED_ORIGINS?: string;
}

export interface ClientInfoLike {
	address?: string | null;
	geo?: unknown;
}

export interface CacheLike {
	get(key: string): Promise<unknown | undefined>;
	set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
}

export interface FastlyFetchInit extends RequestInit {
	backend?: string;
}

export type FastlyFetch = (input: RequestInfo | URL, init?: FastlyFetchInit) => Promise<Response>;

export type IpData = Record<string, unknown>;

export interface LookupResult {
	data: IpData | null;
	status: 'hit' | 'miss' | 'error' | 'invalid' | 'off';
	ip: string;
	network: string;
	error?: string;
}
