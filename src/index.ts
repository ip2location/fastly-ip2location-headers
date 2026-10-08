import { SimpleCache } from 'fastly:cache';
import { ConfigStore } from 'fastly:config-store';
import { SecretStore } from 'fastly:secret-store';
import { createHandler } from '../lib/handler.ts';
import type { CacheLike, ClientInfoLike, Settings } from '../lib/types.ts';

const CONFIG_STORE = 'ip2location_config';
const SECRET_STORE = 'ip2location_secret';
const API_KEY_SECRET = 'IP2LOCATION_API_KEY';

const CONFIG_KEYS = ['CACHE_TTL', 'BACKEND', 'API_BACKEND', 'ALLOW_QUERY_IP', 'ALLOWED_ORIGINS'] as const;

class FastlyCache implements CacheLike {
	async get(key: string): Promise<unknown | undefined> {
		const entry = SimpleCache.get(key);
		if (entry === null) return undefined;
		return await entry.json().catch(() => undefined);
	}

	async set(key: string, value: unknown, ttlSeconds: number): Promise<void> {
		SimpleCache.set(key, JSON.stringify(value), ttlSeconds);
	}
}

async function loadSettings(): Promise<Settings> {
	const settings: Settings = {};

	try {
		const store = new ConfigStore(CONFIG_STORE);
		for (const key of CONFIG_KEYS) {
			const value = store.get(key);
			if (value !== null) settings[key] = value;
		}
	} catch {}

	try {
		const entry = await new SecretStore(SECRET_STORE).get(API_KEY_SECRET);
		if (entry !== null) settings.IP2LOCATION_API_KEY = entry.plaintext();
	} catch {}

	return settings;
}

const handler = createHandler({ fetch, cache: new FastlyCache(), loadSettings });

addEventListener('fetch', (event) => {
	const e = event as FetchEvent & { client?: ClientInfoLike };
	e.respondWith(handler(e.request, e.client ?? {}));
});
