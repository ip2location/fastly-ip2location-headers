import { FIELDS, PROXY_FLAGS } from './fields.ts';
import type { IpData } from './types.ts';

export const MAX_HEADER_VALUE = 512;

function isControl(code: number): boolean {
	return code < 0x20 || (code >= 0x7f && code <= 0x9f);
}

function encodeChar(ch: string): string {
	const code = ch.codePointAt(0) ?? 0;
	if (isControl(code)) return '';
	if (code <= 0xff) return ch;
	try {
		return encodeURIComponent(ch);
	} catch {
		return '';
	}
}

export function sanitizeHeaderValue(value: string): string {
	let out = '';
	for (const ch of value) out += encodeChar(ch);
	return out;
}

export function headerSafe(value: string): string {
	let out = '';
	for (const ch of value) {
		const piece = encodeChar(ch);
		if (out.length + piece.length > MAX_HEADER_VALUE) break;
		out += piece;
	}
	return out;
}

export function readPath(data: IpData, path: string): unknown {
	let cur: unknown = data;
	for (const part of path.split('.')) {
		if (cur === null || typeof cur !== 'object') return undefined;
		cur = (cur as Record<string, unknown>)[part];
	}
	return cur;
}

export function formatValue(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value === 'boolean') return value ? 'true' : 'false';
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null;
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();

	if (trimmed === '' || trimmed === '-') return null;
	return headerSafe(trimmed);
}

export function buildHeaders(data: IpData, prefix: string, fields: string[]): Record<string, string> {
	const wanted = new Set(fields);
	const out: Record<string, string> = {};

	for (const field of FIELDS) {
		if (!wanted.has(field.key)) continue;
		const value = formatValue(readPath(data, field.path));
		if (value !== null) out[prefix + field.header] = value;
	}

	if (wanted.has('proxy_flags')) {
		const flags = PROXY_FLAGS.filter((f) => readPath(data, f.path) === true).map((f) => f.flag);
		if (flags.length > 0) out[prefix + 'Proxy-Flags'] = flags.join(',');
	}

	return out;
}
