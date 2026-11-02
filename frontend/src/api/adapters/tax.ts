/**
 * Tax code form <-> API. The API wants a rate as a fraction string ("0.05" is 5%) with at most six decimals.
 * The conversion is on the decimal text, never through a float, so 7.5 becomes "0.075" exactly.
 */
import type { TaxCodeBody } from '../live/setup';
import type { components } from '../schema';

/** "5" -> "0.05", "7.5" -> "0.075", "0" -> "0", "100" -> "1". Returns null for anything else. */
export function percentToFraction(input: string): string | null {
  const t = input.trim().replace(/%$/, '').trim();
  const m = /^(\d{1,3})(?:\.(\d{1,4}))?$/.exec(t);
  if (!m) return null;
  const whole = m[1].replace(/^0+(?=\d)/, '');
  const frac = m[2] ?? '';
  if (Number(whole) > 100 || (Number(whole) === 100 && /[1-9]/.test(frac))) return null;
  const digits = `${whole}${frac}`.replace(/^0+(?=\d)/, '');
  const scale = frac.length + 2;
  const padded = digits.padStart(scale + 1, '0');
  const intPart = padded.slice(0, padded.length - scale);
  const fracPart = padded.slice(padded.length - scale).replace(/0+$/, '');
  return fracPart ? `${intPart}.${fracPart}` : intPart;
}

/** "0.075" -> "7.5%" for display. */
export function fractionToPercent(fraction: string | null): string {
  if (fraction === null) return 'no rate';
  const m = /^(\d+)(?:\.(\d+))?$/.exec(fraction);
  if (!m) return fraction;
  const frac = (m[2] ?? '').padEnd(2, '0');
  const whole = `${m[1]}${frac.slice(0, 2)}`.replace(/^0+(?=\d)/, '');
  const rest = frac.slice(2).replace(/0+$/, '');
  return `${whole}${rest ? `.${rest}` : ''}%`;
}

export const TAX_KINDS: { value: NonNullable<TaxCodeBody['kind']>; label: string }[] = [
  { value: 'vat', label: 'VAT' },
  { value: 'gst', label: 'GST' },
  { value: 'sales', label: 'Sales tax' },
  { value: 'wht', label: 'Withholding' },
  { value: 'exempt', label: 'Exempt' },
  { value: 'zero', label: 'Zero-rated' },
];

export interface TaxCodeForm {
  code: string;
  name: string;
  kind: NonNullable<TaxCodeBody['kind']>;
  percent: string;
  /** ISO date the rate starts. */
  effectiveFrom: string;
}

/** Form -> request body, or the field that is wrong. Exempt and zero-rated codes carry a 0 rate. */
export function toTaxCodeBody(f: TaxCodeForm): { body: TaxCodeBody } | { field: 'code' | 'name' | 'percent'; message: string } {
  if (!/^[A-Za-z0-9._-]{1,32}$/.test(f.code)) return { field: 'code', message: 'Use letters, numbers, dots, dashes or underscores (up to 32).' };
  if (f.name.trim() === '') return { field: 'name', message: 'Give the tax code a name.' };
  const rate = f.kind === 'exempt' || f.kind === 'zero' ? '0' : percentToFraction(f.percent);
  if (rate === null) return { field: 'percent', message: 'Enter a rate between 0 and 100, for example 5 or 7.5.' };
  return { body: { code: f.code, name: f.name.trim(), kind: f.kind, rate, effective_from: f.effectiveFrom } };
}

/* ----------------------------------------------------- the tax codes screen */

export type ApiTaxCodeResource = components['schemas']['TaxCodeResource'];
export type ApiTaxGroupResource = components['schemas']['TaxGroupResource'];

export interface LiveTaxRate {
  id: string;
  /** Fraction string as the server holds it ("0.050000"). Show with `fractionToPercent`. */
  rate: string;
  effective_from: string;
  effective_to: string | null;
}

export interface LiveTaxCode {
  id: string;
  code: string;
  name: string;
  kind: string;
  /** The rate in force today (fraction string), null when none is. */
  rate: string | null;
  rates: LiveTaxRate[];
  collect_account_id: string | null;
  pay_account_id: string | null;
  is_recoverable: boolean;
  is_active: boolean;
  version: number;
  can: { update: boolean; deactivate: boolean };
}

const canOf = (raw: unknown): { update: boolean; deactivate: boolean } => {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return { update: r.update === true, deactivate: r.deactivate === true };
};

export function toLiveTaxCode(a: ApiTaxCodeResource): LiveTaxCode {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    kind: a.kind,
    rate: a.rate ?? null,
    rates: (a.rates ?? []).map((r) => ({ id: r.id, rate: r.rate, effective_from: r.effective_from ?? '', effective_to: r.effective_to ?? null })),
    collect_account_id: a.collect_account_id,
    pay_account_id: a.pay_account_id,
    is_recoverable: a.is_recoverable,
    is_active: a.is_active,
    version: a.version,
    can: canOf(a.can),
  };
}

export interface LiveTaxGroup {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
  version: number;
  items: Array<{ tax_code_id: string; sequence: number; compound: boolean }>;
  can: { update: boolean; deactivate: boolean };
}

export function toLiveTaxGroup(a: ApiTaxGroupResource): LiveTaxGroup {
  return {
    id: a.id,
    code: a.code,
    name: a.name,
    is_active: a.is_active,
    version: a.version,
    items: (a.items ?? []).map((i) => ({ tax_code_id: i.tax_code_id, sequence: i.sequence, compound: i.compound })).sort((x, y) => x.sequence - y.sequence),
    can: canOf(a.can),
  };
}

export interface TaxCodeEdit {
  name: string;
  kind: string;
  collect_account_id: string;
  pay_account_id: string;
  is_recoverable: boolean;
}

/** Replace a code: everything but the code and its rates, at the version it was read at. */
export function toTaxCodeReplace(e: TaxCodeEdit, version: number): Record<string, unknown> {
  return {
    name: e.name.trim(),
    kind: e.kind,
    collect_account_id: e.collect_account_id || null,
    pay_account_id: e.pay_account_id || null,
    is_recoverable: e.is_recoverable,
    version,
  };
}

/** A new rate from a date. `percent` is text such as "7.5"; null when it is not a rate between 0 and 100. */
export function toRateRequest(percent: string, effectiveFrom: string, version: number): Record<string, unknown> | null {
  const rate = percentToFraction(percent);
  if (rate === null || !effectiveFrom) return null;
  return { rate, effective_from: effectiveFrom, version };
}

export function toGroupRequest(code: string, name: string, items: Array<{ tax_code_id: string; compound: boolean }>, version?: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    name: name.trim(),
    items: items.map((i) => ({ tax_code_id: i.tax_code_id, compound: i.compound })),
  };
  if (version === undefined) body.code = code.trim();
  else body.version = version;
  return body;
}

export const TAX_KIND_LABEL: Record<string, string> = {
  vat: 'VAT',
  gst: 'GST',
  sales: 'Sales tax',
  wht: 'Withholding',
  compound: 'Compound',
  exempt: 'Exempt',
  zero: 'Zero-rated',
  reverse_charge: 'Reverse charge',
};
