/**
 * Tax code form <-> API. The API wants a rate as a fraction string ("0.05" is 5%) with at most six decimals.
 * The conversion is on the decimal text, never through a float, so 7.5 becomes "0.075" exactly.
 */
import type { TaxCodeBody } from '../live/setup';

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
