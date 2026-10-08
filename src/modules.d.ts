declare module 'fastly:cache' {
	export interface SimpleCacheEntry {
		json(): Promise<object>;
		text(): Promise<string>;
	}
	export class SimpleCache {
		static get(key: string): SimpleCacheEntry | null;
		static set(key: string, value: string, ttl: number): void;
		static purge(key: string, options: { scope: 'pop' | 'global' }): void;
	}
}

declare module 'fastly:secret-store' {
	export interface SecretStoreEntry {
		plaintext(): string;
	}
	export class SecretStore {
		constructor(name: string);
		get(key: string): Promise<SecretStoreEntry | null>;
	}
}

declare module 'fastly:config-store' {
	export class ConfigStore {
		constructor(name: string);
		get(key: string): string | null;
	}
}
