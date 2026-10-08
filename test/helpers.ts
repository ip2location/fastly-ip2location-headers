import type { FastlyFetch, FastlyFetchInit, Settings } from '../lib/types.ts';

export const API_ORIGIN = 'https://api.ip2location.io/';

export const MY_PAYLOAD = {
	ip: '175.144.151.253',
	country_code: 'MY',
	country_name: 'Malaysia',
	region_name: 'Pulau Pinang',
	district: 'Daerah Timur Laut',
	city_name: 'George Town',
	latitude: 5.41146,
	longitude: 100.33543,
	zip_code: '10300',
	time_zone: '+08:00',
	asn: '4788',
	as: 'TM Technology Services Sdn. Bhd.',
	as_info: {
		as_number: '4788',
		as_name: 'TM Technology Services Sdn. Bhd.',
		as_domain: 'unifi.com.my',
		as_usage_type: 'ISP/MOB',
		as_cidr: '175.144.128.0/18',
	},
	isp: 'Telekom Malaysia Berhad',
	domain: 'tm.net.my',
	net_speed: 'DSL',
	idd_code: '60',
	area_code: '04',
	mcc: '-',
	mnc: '-',
	mobile_brand: '-',
	elevation: 2,
	usage_type: 'ISP',
	address_type: 'Unicast',
	ads_category: '419',
	ads_category_name: 'Internet Service Providers',
	continent: { name: 'Asia', code: 'AS', hemisphere: ['north', 'east'] },
	country: {
		name: 'Malaysia',
		alpha3_code: 'MYS',
		numeric_code: 458,
		demonym: 'Malaysians',
		capital: 'Kuala Lumpur',
		currency: { code: 'MYR', name: 'Malaysian Ringgit', symbol: 'RM' },
		language: { code: 'MS', name: 'Malay' },
		tld: 'my',
	},
	time_zone_info: {
		olson: 'Asia/Kuala_Lumpur',
		current_time: '2026-10-06T10:55:27+08:00',
		gmt_offset: 28800,
		is_dst: false,
		abbreviation: 'MYT',
		sunrise: '07:06',
		sunset: '19:09',
	},
	geotargeting: { metro: null },
	is_proxy: false,
	fraud_score: 0,
	proxy: {
		last_seen: 0,
		proxy_type: '-',
		threat: '-',
		provider: '-',
		is_vpn: false,
		is_tor: false,
		is_data_center: false,
		is_public_proxy: false,
		is_web_proxy: false,
		is_web_crawler: false,
		is_ai_crawler: false,
		is_residential_proxy: false,
		is_consumer_privacy_network: false,
		is_enterprise_private_network: false,
		is_spammer: false,
		is_scanner: false,
		is_botnet: false,
		is_bogon: false,
	},
};

export const VPN_PAYLOAD = {
	...MY_PAYLOAD,
	ip: '102.129.143.3',
	country_code: 'CH',
	country_name: 'Switzerland',
	district: 'Zug District',
	asn: '212238',
	as: 'Datacamp Limited',
	isp: 'Freedomtech Solutions Limited',
	domain: 'abuseradar.com',
	net_speed: 'T1',
	usage_type: 'DCH',
	ads_category_name: 'Web Hosting',
	is_proxy: true,
	fraud_score: 99,
	proxy: { ...MY_PAYLOAD.proxy, last_seen: 1, proxy_type: 'VPN', provider: 'CyberGhost', is_vpn: true },
};

export const FASTLY_GEO = {
	as_name: 'TM TECHNOLOGY SERVICES SDN. BHD.',
	as_number: 4788,
	area_code: 4,
	city: 'George Town',
	conn_speed: 'broadband',
	conn_type: 'wired',
	continent: 'AS',
	country_code: 'MY',
	country_code3: 'MYS',
	country_name: 'Malaysia',
	gmt_offset: '+8',
	latitude: 5.4141,
	longitude: 100.3288,
	metro_code: 0,
	postal_code: '10300',
	proxy_description: null,
	proxy_type: null,
	region: 'MY-07',
	utc_offset: 28800,
};

export function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' },
	});
}

export function recordingFetch(reply: (url: string, call: number) => Response) {
	const calls: string[] = [];
	const stub = (async (input: RequestInfo | URL) => {
		const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
		calls.push(url);
		return reply(url, calls.length - 1);
	}) as unknown as typeof fetch;
	return { fetch: stub, calls };
}

export function installFetch(handlers: { api?: () => Response; origin?: () => Response } = {}) {
	const original = globalThis.fetch;
	const lookups: Array<{ url: string; backend?: string }> = [];
	const forwarded: Array<{ request: Request; backend?: string }> = [];
	const apiReply = handlers.api ?? (() => jsonResponse(MY_PAYLOAD));
	const originReply = handlers.origin ?? (() => new Response('origin body'));

	globalThis.fetch = (async (input: RequestInfo | URL, init?: FastlyFetchInit) => {
		const request = input instanceof Request ? input : new Request(input.toString(), init);
		if (request.url.startsWith(API_ORIGIN)) {
			lookups.push({ url: request.url, backend: init?.backend });
			return apiReply();
		}
		forwarded.push({ request, backend: init?.backend });
		return originReply();
	}) as FastlyFetch;

	return {
		lookups,
		forwarded,
		restore: () => {
			globalThis.fetch = original;
		},
	};
}

export function makeSettings(overrides: Settings = {}): Settings {
	return { IP2LOCATION_API_KEY: 'TESTKEY', CACHE_TTL: '3600', ...overrides };
}
