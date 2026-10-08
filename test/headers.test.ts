import { describe, expect, test } from 'bun:test';
import { DEFAULT_FIELDS, FIELDS } from '../lib/fields.ts';
import { MAX_HEADER_VALUE, buildHeaders, formatValue, headerSafe, readPath, sanitizeHeaderValue } from '../lib/headers.ts';
import { MY_PAYLOAD, VPN_PAYLOAD } from './helpers.ts';

const ALL_KEYS = [...FIELDS.map((f) => f.key), 'proxy_flags'];

const P = 'X-IP2Location-';

describe('readPath', () => {
	test('reads nested values', () => {
		expect(readPath(MY_PAYLOAD, 'country.currency.code')).toBe('MYR');
		expect(readPath(MY_PAYLOAD, 'as_info.as_cidr')).toBe('175.144.128.0/18');
	});

	test('returns undefined instead of throwing on a missing path', () => {
		expect(readPath(MY_PAYLOAD, 'nope.missing.deep')).toBeUndefined();
		expect(readPath(MY_PAYLOAD, 'country.nope')).toBeUndefined();
	});
});

describe('formatValue', () => {
	test('renders booleans as true/false so PHP can string-compare', () => {
		expect(formatValue(true)).toBe('true');
		expect(formatValue(false)).toBe('false');
	});

	test('skips placeholders and empty values', () => {
		expect(formatValue('-')).toBeNull();
		expect(formatValue('')).toBeNull();
		expect(formatValue(null)).toBeNull();
		expect(formatValue(undefined)).toBeNull();
	});

	test('skips objects and non-finite numbers', () => {
		expect(formatValue({ code: 'MYR' })).toBeNull();
		expect(formatValue(Number.NaN)).toBeNull();
	});
});

describe('headerSafe', () => {
	test('strips CR, LF and NUL so header injection is impossible', () => {
		expect(headerSafe('Malaysia\r\nX-Evil: 1')).toBe('MalaysiaX-Evil: 1');
	});

	test('percent-encodes code points above Latin-1 instead of losing them', () => {
		expect(headerSafe('東京')).toBe('%E6%9D%B1%E4%BA%AC');
		expect(headerSafe('Côte')).toBe('Côte');
	});

	test('survives a lone surrogate without throwing', () => {
		expect(headerSafe('a\uD83Db')).toBe('ab');
		expect(headerSafe('a😀b')).toBe('a%F0%9F%98%80b');
	});

	test('truncates, and sanitises without truncating', () => {
		expect(headerSafe('x'.repeat(1000)).length).toBe(MAX_HEADER_VALUE);
		expect(sanitizeHeaderValue('x'.repeat(1000)).length).toBe(1000);
	});

	test('never truncates in the middle of a %XX escape', () => {
		const cut = headerSafe('中'.repeat(100));
		expect(cut.length).toBeLessThanOrEqual(MAX_HEADER_VALUE);
		expect(cut.endsWith('%')).toBe(false);
		expect(() => decodeURIComponent(cut)).not.toThrow();
	});
});

describe('buildHeaders', () => {
	test('maps the default field set from the real response', () => {
		const out = buildHeaders(MY_PAYLOAD, P, DEFAULT_FIELDS);
		expect(out['X-IP2Location-District']).toBe('Daerah Timur Laut');
		expect(out['X-IP2Location-Country-Currency']).toBe('MYR');
		expect(out['X-IP2Location-Country-Language']).toBe('MS');
		expect(out['X-IP2Location-Time-Abbr']).toBe('MYT');
		expect(out['X-IP2Location-Time-DST']).toBe('false');
		expect(out['X-IP2Location-ISP']).toBe('Telekom Malaysia Berhad');
		expect(out['X-IP2Location-AS-Domain']).toBe('unifi.com.my');
		expect(out['X-IP2Location-AS-CIDR']).toBe('175.144.128.0/18');
		expect(out['X-IP2Location-Fraud-Score']).toBe('0');
	});

	test('never emits what Fastly already resolves', () => {
		const out = buildHeaders(MY_PAYLOAD, P, ALL_KEYS);
		for (const name of ['ASN', 'AS-Name', 'Country-Alpha3', 'Continent', 'Continent-Name', 'Time-Offset', 'Area-Code', 'Metro-Code']) {
			expect(out[P + name]).toBeUndefined();
		}
	});

	test('has no field keys for what Fastly resolves', () => {
		for (const key of ['asn', 'as_name', 'country_alpha3', 'continent_code', 'continent_name', 'tz_offset', 'area_code', 'geotargeting_metro']) {
			expect(ALL_KEYS.includes(key)).toBe(false);
		}
	});

	test('drops placeholders rather than sending a bare dash', () => {
		const out = buildHeaders(MY_PAYLOAD, P, ['mcc', 'mnc', 'mobile_brand', 'proxy_type', 'proxy_provider']);
		expect(out).toEqual({});
	});

	test('aggregates proxy flags into one header', () => {
		expect(buildHeaders(MY_PAYLOAD, P, ['proxy_flags'])['X-IP2Location-Proxy-Flags']).toBeUndefined();
		expect(buildHeaders(VPN_PAYLOAD, P, ['proxy_flags'])['X-IP2Location-Proxy-Flags']).toBe('vpn');
	});

	test('every declared field key resolves against a full Security payload', () => {
		const out = buildHeaders(VPN_PAYLOAD, P, ALL_KEYS);
		expect(Object.keys(out).length).toBeGreaterThan(22);
		expect(out['X-IP2Location-Is-VPN']).toBe('true');
		expect(out['X-IP2Location-Proxy-Provider']).toBe('CyberGhost');
		expect(out['X-IP2Location-AS-Domain']).toBe('unifi.com.my');
	});

	test('honours a custom prefix and an empty field list', () => {
		expect(buildHeaders(MY_PAYLOAD, 'X-Geo-', ['isp'])['X-Geo-ISP']).toBe('Telekom Malaysia Berhad');
		expect(buildHeaders(MY_PAYLOAD, P, [])).toEqual({});
	});
});
