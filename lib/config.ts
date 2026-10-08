import type { Settings } from './types.ts';

export const HEADER_PREFIX = 'X-IP2Location-';

export interface Config {
	ttl: number;
	backend: string;
	apiBackend: string;
	allowQueryIp: boolean;
	allowedOrigins: string;
}

export function readConfig(settings: Settings): Config {
	return {
		ttl: toInt(settings.CACHE_TTL, 3600),
		backend: (settings.BACKEND ?? '').trim() || 'origin',
		apiBackend: (settings.API_BACKEND ?? '').trim() || 'ip2location',
		allowQueryIp: truthy(settings.ALLOW_QUERY_IP),
		allowedOrigins: (settings.ALLOWED_ORIGINS ?? '*').trim() || '*',
	};
}

export function toInt(value: string | undefined, fallback: number): number {
	const n = Number.parseInt((value ?? '').trim(), 10);
	return Number.isFinite(n) ? n : fallback;
}

export function truthy(value: string | undefined): boolean {
	const s = (value ?? '').trim().toLowerCase();
	return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}
