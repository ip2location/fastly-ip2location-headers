import { afterEach, describe, expect, test } from 'bun:test';
import { MemoryCache } from '../lib/memory-cache.ts';
import { createHandler } from '../lib/handler.ts';
import type { CacheLike, ClientInfoLike, Settings } from '../lib/types.ts';
import { FASTLY_GEO, MY_PAYLOAD, VPN_PAYLOAD, installFetch, jsonResponse, makeSettings } from './helpers.ts';

const P = 'X-IP2Location-';

const active: Array<() => void> = [];

afterEach(() => {
	while (active.length > 0) active.pop()!();
});

interface Setup {
	api?: () => Response;
	origin?: () => Response;
	settings?: Settings;
	cache?: CacheLike;
	settingsError?: Error;
}

function setup({ api, origin, settings, cache, settingsError }: Setup = {}) {
	const lane = installFetch({ api, origin });
	active.push(lane.restore);

	const resolved = makeSettings(settings);
	const handler = createHandler({
		fetch: (input, init) => globalThis.fetch(input as RequestInfo, init),
		cache: cache ?? new MemoryCache(),
		loadSettings: async () => {
			if (settingsError) throw settingsError;
			return resolved;
		},
	});

	return {
		lookups: lane.lookups,
		forwarded: lane.forwarded,
		run: (url: string, init: RequestInit = {}, client: ClientInfoLike = { address: '175.144.151.253', geo: FASTLY_GEO }) => handler(new Request(url, init), client),
	};
}

describe('enrichment', () => {
	test('attaches the enrichment headers to the forwarded request', async () => {
		const s = setup();
		await s.run('https://shop.example.com/cart');

		const { request } = s.forwarded[0]!;
		expect(request.url).toBe('https://shop.example.com/cart');
		expect(request.headers.get(P + 'ISP')).toBe('Telekom Malaysia Berhad');
		expect(request.headers.get(P + 'Country-Currency')).toBe('MYR');
		expect(request.headers.get(P + 'Lookup')).toBe('miss');
		expect(request.headers.get(P + 'Network')).toBeNull();
	});

	test('queries the API for the client address', async () => {
		const s = setup();
		await s.run('https://shop.example.com/');
		expect(new URL(s.lookups[0]!.url).searchParams.get('ip')).toBe('175.144.151.253');
	});

	test('routes the API call through its own named backend', async () => {
		const s = setup();
		await s.run('https://shop.example.com/');

		expect(s.lookups[0]!.backend).toBe('ip2location');
	});

	test('routes the origin request through the configured backend', async () => {
		const s = setup({ settings: { BACKEND: 'my-shop' } });
		await s.run('https://shop.example.com/');
		expect(s.forwarded[0]!.backend).toBe('my-shop');
	});

	test('honours a custom API backend name', async () => {
		const s = setup({ settings: { API_BACKEND: 'ip2loc' } });
		await s.run('https://shop.example.com/');
		expect(s.lookups[0]!.backend).toBe('ip2loc');
	});

	test('does not repeat what Fastly already resolves', async () => {
		const s = setup();
		await s.run('https://shop.example.com/');

		const sent = s.forwarded[0]!.request;
		for (const name of ['ASN', 'AS-Name', 'Country-Alpha3', 'Continent', 'Time-Offset', 'Area-Code', 'Metro-Code', 'City', 'Region', 'Country']) {
			expect(sent.headers.get(P + name)).toBeNull();
		}
	});

	test('preserves the method, body and unrelated headers', async () => {
		const s = setup();
		await s.run('https://shop.example.com/checkout', {
			method: 'POST',
			body: 'a=1',
			headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-custom': 'keep' },
		});

		const sent = s.forwarded[0]!.request;
		expect(sent.method).toBe('POST');
		expect(await sent.text()).toBe('a=1');
		expect(sent.headers.get('x-custom')).toBe('keep');
	});

	test('returns the origin response untouched', async () => {
		const s = setup({ origin: () => new Response('hello', { status: 201, headers: { 'x-origin': 'yes' } }) });
		const res = await s.run('https://shop.example.com/');

		expect(res.status).toBe(201);
		expect(await res.text()).toBe('hello');
		expect(res.headers.get('x-origin')).toBe('yes');
	});
});

describe('anti-forgery', () => {
	test('drops visitor-supplied headers carrying our prefix', async () => {
		const s = setup();
		await s.run('https://shop.example.com/', {
			headers: {
				'x-ip2location-isp': 'Evil Corp',
				'X-IP2Location-Is-VPN': 'false',
				'X-IP2Location-Fraud-Score': '99',
				'X-IP2Location-Anything-Else': '1',
			},
		});

		const sent = s.forwarded[0]!.request;
		expect(sent.headers.get(P + 'ISP')).toBe('Telekom Malaysia Berhad');
		expect(sent.headers.get(P + 'Is-VPN')).toBeNull();

		expect(sent.headers.get(P + 'Fraud-Score')).toBe('0');
		expect(sent.headers.get(P + 'Anything-Else')).toBeNull();
	});

	test('strips forged headers even when the lookup fails', async () => {
		const s = setup({ api: () => new Response('down', { status: 503 }) });
		await s.run('https://shop.example.com/', { headers: { 'x-ip2location-isp': 'Evil Corp' } });

		const sent = s.forwarded[0]!.request;
		expect(sent.headers.get(P + 'ISP')).toBeNull();
		expect(sent.headers.get(P + 'Lookup')).toBe('error');
		expect(sent.headers.get(P + 'Error')).toContain('503');
	});
});

describe('failure handling', () => {
	test('still forwards without enrichment headers when the lookup errors', async () => {
		const s = setup({ api: () => jsonResponse({ error: { error_code: 10002, error_message: 'Internal server error.' } }) });
		const res = await s.run('https://shop.example.com/');

		expect(s.forwarded.length).toBe(1);
		expect(s.forwarded[0]!.request.headers.get(P + 'Lookup')).toBe('error');
		expect(s.forwarded[0]!.request.headers.get(P + 'Error')).toBe('10002: Internal server error.');
		expect(res.status).toBe(200);
	});

	test('forwards unenriched when Fastly supplies no client address', async () => {
		const s = setup();
		await s.run('https://shop.example.com/', {}, {});

		expect(s.forwarded[0]!.request.headers.get(P + 'Lookup')).toBe('invalid');
		expect(s.lookups.length).toBe(0);
	});

	test('fails open when the config or secret store throws', async () => {
		const s = setup({ settingsError: new Error('no config store linked') });
		const res = await s.run('https://shop.example.com/');

		expect(res.status).toBe(200);
		expect(s.forwarded.length).toBe(1);

		expect(s.forwarded[0]!.request.headers.get(P + 'ISP')).toBe('Telekom Malaysia Berhad');
	});

	test('fails open when the cache itself throws', async () => {
		const broken: CacheLike = {
			get: async () => {
				throw new Error('cache unavailable');
			},
			set: async () => {},
		};
		const s = setup({ cache: broken });
		const res = await s.run('https://shop.example.com/');

		expect(res.status).toBe(200);
		expect(s.forwarded[0]!.request.headers.get(P + 'Lookup')).toBe('error');
	});
});

describe('caching', () => {
	test('a second request for the same network is served from cache', async () => {
		const s = setup();
		await s.run('https://shop.example.com/');
		await s.run('https://shop.example.com/cart', {}, { address: '175.144.151.200' });

		expect(s.forwarded[0]!.request.headers.get(P + 'Lookup')).toBe('miss');
		expect(s.forwarded[1]!.request.headers.get(P + 'Lookup')).toBe('hit');
		expect(s.lookups.length).toBe(1);
	});

	test('security fields survive the round trip through the cache', async () => {
		const s = setup({ api: () => jsonResponse(VPN_PAYLOAD) });
		await s.run('https://shop.example.com/', {}, { address: '102.129.143.3' });
		await s.run('https://shop.example.com/', {}, { address: '102.129.143.9' });

		expect(s.forwarded[1]!.request.headers.get(P + 'Lookup')).toBe('hit');
		expect(s.forwarded[1]!.request.headers.get(P + 'Proxy-Flags')).toBe('vpn');
		expect(s.forwarded[1]!.request.headers.get(P + 'Fraud-Score')).toBe('99');
	});
});

describe('debug endpoint', () => {
	test('reports the headers, the payload and what Fastly resolved', async () => {
		const s = setup({ settings: { ALLOW_QUERY_IP: '1' } });
		const res = await s.run('https://shop.example.com/__ip2location?ip=175.144.151.253');
		const body = await res.json();

		expect(res.status).toBe(200);
		expect(body.ip).toBe('175.144.151.253');
		expect(body.lookup).toBe('miss');
		expect(body.backend).toBe('origin');
		expect(body.headers['X-IP2Location-ISP']).toBe('Telekom Malaysia Berhad');

		expect(body.fastlyGeo.as_number).toBe(4788);
		expect(body.fastlyGeo.country_code3).toBe('MYS');
	});

	test('ignores ?ip= unless overrides are allowed, and never forwards it', async () => {
		const s = setup();
		const res = await s.run('https://shop.example.com/__ip2location?ip=8.8.8.8');

		expect((await res.json()).ip).toBe('175.144.151.253');
		expect(s.forwarded.length).toBe(0);
	});

	test('answers CORS preflight', async () => {
		const s = setup();
		const res = await s.run('https://shop.example.com/__ip2location', { method: 'OPTIONS' });
		expect(res.status).toBe(204);
		expect(res.headers.get('access-control-allow-origin')).toBe('*');
	});
});
