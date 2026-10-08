import { describe, expect, test } from 'bun:test';
import { lookupIp } from '../lib/lookup.ts';
import type { LookupOptions } from '../lib/lookup.ts';
import { MemoryCache } from '../lib/memory-cache.ts';
import { MY_PAYLOAD, VPN_PAYLOAD, jsonResponse, recordingFetch } from './helpers.ts';

const OPTS: LookupOptions = { ttl: 3600 };

function harness(reply: Parameters<typeof recordingFetch>[0], options: Partial<LookupOptions> = {}, cache = new MemoryCache()) {
	const fetcher = recordingFetch(reply);
	return {
		fetcher,
		cache,
		run: (ip: string, opts: Partial<LookupOptions> = {}) => lookupIp(ip, { ...OPTS, ...options, ...opts }, { fetch: fetcher.fetch, apiKey: 'TESTKEY', cache }),
	};
}

describe('lookupIp', () => {
	test('queries the API with the address and key', async () => {
		const h = harness(() => jsonResponse(MY_PAYLOAD));
		const result = await h.run('175.144.151.253');

		expect(result.status).toBe('miss');
		const url = new URL(h.fetcher.calls[0]!);
		expect(url.origin + url.pathname).toBe('https://api.ip2location.io/');
		expect(url.searchParams.get('ip')).toBe('175.144.151.253');
		expect(url.searchParams.get('key')).toBe('TESTKEY');
	});

	test('serves the second lookup from cache, including another address in the same /24', async () => {
		const h = harness(() => jsonResponse(MY_PAYLOAD));
		await h.run('175.144.151.253');
		expect((await h.run('175.144.151.253')).status).toBe('hit');
		expect((await h.run('175.144.151.9')).status).toBe('hit');
		expect(h.fetcher.calls.length).toBe(1);
	});

	test('does not share a cache entry across /24 boundaries', async () => {
		const h = harness(() => jsonResponse(MY_PAYLOAD));
		await h.run('175.144.151.1');
		await h.run('175.144.152.1');
		expect(h.fetcher.calls.length).toBe(2);
	});

	test('never caches the per-request ip field or the lookup timestamp', async () => {
		const h = harness(() => jsonResponse(MY_PAYLOAD));
		await h.run('175.144.151.253');

		const cached = (await h.cache.get('175.144.151.0')) as Record<string, any>;
		expect(cached.ip).toBeUndefined();
		expect(cached.time_zone_info.current_time).toBeUndefined();
		expect(cached.time_zone_info.abbreviation).toBe('MYT');
	});

	test('reports a 200 carrying an error object as a failure', async () => {
		const h = harness(() => jsonResponse({ error: { error_code: 10001, error_message: 'Invalid IP address.' } }));
		const result = await h.run('175.144.151.253');

		expect(result.status).toBe('error');
		expect(result.error).toBe('10001: Invalid IP address.');
	});

	test('falls back to the keyless lane when the quota is exhausted', async () => {
		const h = harness((url) => (url.includes('key=') ? jsonResponse({ error: { error_code: 10000, error_message: 'Invalid API key or insufficient query.' } }) : jsonResponse(MY_PAYLOAD)));
		const result = await h.run('175.144.151.253');

		expect(result.data?.isp).toBe('Telekom Malaysia Berhad');
		expect(h.fetcher.calls.length).toBe(2);
		expect(new URL(h.fetcher.calls[1]!).searchParams.get('key')).toBeNull();
	});

	test('does not retry keyless when no key was configured, or on an unrelated code', async () => {
		const quota = recordingFetch(() => jsonResponse({ error: { error_code: 10000, error_message: 'quota' } }));
		await lookupIp('175.144.151.253', OPTS, { fetch: quota.fetch, apiKey: '', cache: new MemoryCache() });
		expect(quota.calls.length).toBe(1);

		const other = recordingFetch(() => jsonResponse({ error: { error_code: 10002, error_message: 'Internal server error.' } }));
		await lookupIp('175.144.151.253', OPTS, { fetch: other.fetch, apiKey: 'TESTKEY', cache: new MemoryCache() });
		expect(other.calls.length).toBe(1);
	});

	test('treats an HTTP failure as an error, not as data', async () => {
		const h = harness(() => new Response('nope', { status: 500 }));
		expect((await h.run('175.144.151.253')).status).toBe('error');
	});

	test('survives a network exception', async () => {
		const fetcher = (async () => {
			throw new Error('connection reset');
		}) as unknown as typeof fetch;
		const result = await lookupIp('175.144.151.253', OPTS, { fetch: fetcher, apiKey: 'K', cache: new MemoryCache() });

		expect(result.status).toBe('error');
		expect(result.error).toContain('connection reset');
	});

	test('rejects an invalid address without spending a query', async () => {
		const h = harness(() => jsonResponse(MY_PAYLOAD));
		expect((await h.run('not-an-ip')).status).toBe('invalid');
		expect(h.fetcher.calls.length).toBe(0);
	});

	test('guards against a payload that is not a lookup result', async () => {
		const h = harness(() => jsonResponse({ hello: 'world' }));
		expect((await h.run('175.144.151.253')).status).toBe('error');
	});

	test('skips caching entirely when the TTL is 0', async () => {
		const h = harness(() => jsonResponse(MY_PAYLOAD), { ttl: 0 });
		expect((await h.run('175.144.151.253')).status).toBe('off');
		expect((await h.run('175.144.151.253')).status).toBe('off');
		expect(h.cache.size).toBe(0);
		expect(h.fetcher.calls.length).toBe(2);
	});

	test('keeps security fields intact through the cache', async () => {
		const h = harness(() => jsonResponse(VPN_PAYLOAD));
		await h.run('102.129.143.3');
		const result = await h.run('102.129.143.9');

		expect(result.status).toBe('hit');
		expect((result.data?.proxy as Record<string, unknown>).is_vpn).toBe(true);
		expect(result.data?.fraud_score).toBe(99);
	});
});
