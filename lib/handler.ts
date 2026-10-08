import { HEADER_PREFIX, readConfig } from './config.ts';
import type { Config } from './config.ts';
import { DEFAULT_FIELDS } from './fields.ts';
import { buildHeaders, headerSafe } from './headers.ts';
import { lookupIp } from './lookup.ts';
import type { CacheLike, ClientInfoLike, FastlyFetch, LookupResult, Settings } from './types.ts';

export const DEBUG_PATH = '/__ip2location';

export interface HandlerDeps {
	fetch: FastlyFetch;
	cache?: CacheLike;

	loadSettings(): Promise<Settings>;
}

export function createHandler(deps: HandlerDeps) {
	return async function handler(request: Request, client: ClientInfoLike = {}): Promise<Response> {
		const url = new URL(request.url);
		const settings = await readSettings(deps);
		const config = readConfig(settings);

		const apiFetch: FastlyFetch = (input, init) => deps.fetch(input, { ...init, backend: config.apiBackend });

		const resolve = (ip: string): Promise<LookupResult> =>
			lookupIp(ip, config, {
				fetch: apiFetch,
				apiKey: settings.IP2LOCATION_API_KEY,
				cache: config.ttl > 0 ? deps.cache : undefined,
			});

		try {
			if (url.pathname === DEBUG_PATH) return await handleDebug(request, url, client, config, resolve);
			const result = await resolve(client.address ?? '');
			return await forward(request, config, result, deps);
		} catch (e) {
			console.error(`ip2location enrichment failed: ${(e as Error).message}`);
			return forward(request, config, { data: null, status: 'error', ip: '', network: '', error: 'runtime error' }, deps);
		}
	};
}

async function readSettings(deps: HandlerDeps): Promise<Settings> {
	try {
		return await deps.loadSettings();
	} catch {
		return {};
	}
}

export function stripPrefix(inbound: Headers): Headers {
	const prefix = HEADER_PREFIX.toLowerCase();
	const headers = new Headers();
	inbound.forEach((value, name) => {
		if (name.toLowerCase().startsWith(prefix)) return;
		headers.set(name, value);
	});
	return headers;
}

export function applyEnrichment(headers: Headers, result: LookupResult): void {
	headers.set(`${HEADER_PREFIX}Lookup`, result.status);
	if (result.error !== undefined) headers.set(`${HEADER_PREFIX}Error`, headerSafe(result.error));
	if (!result.data) return;

	for (const [name, value] of Object.entries(buildHeaders(result.data, HEADER_PREFIX, DEFAULT_FIELDS))) {
		headers.set(name, value);
	}
}

async function forward(request: Request, config: Config, result: LookupResult, deps: HandlerDeps): Promise<Response> {
	const headers = stripPrefix(request.headers);
	applyEnrichment(headers, result);

	return deps.fetch(new Request(request, { headers, redirect: 'manual' }), { backend: config.backend });
}

async function handleDebug(request: Request, url: URL, client: ClientInfoLike, config: Config, resolve: (ip: string) => Promise<LookupResult>): Promise<Response> {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'access-control-allow-origin': config.allowedOrigins,
		'access-control-allow-headers': 'content-type',
	};
	if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });

	const override = config.allowQueryIp ? (url.searchParams.get('ip') ?? '').trim() : '';
	const result = await resolve(override !== '' ? override : (client.address ?? ''));
	const emitted = result.data ? buildHeaders(result.data, HEADER_PREFIX, DEFAULT_FIELDS) : {};

	return json(
		{
			ip: result.ip,
			lookup: result.status,
			network: result.network,
			error: result.error ?? null,
			backend: config.backend,
			fastlyGeo: client.geo ?? null,
			headers: emitted,
			data: result.data,
		},
		200,
		headers,
	);
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
	return new Response(JSON.stringify(body), { status, headers });
}
