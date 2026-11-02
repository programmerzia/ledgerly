/**
 * Money and rates at the API boundary (13 §16).
 *  - API money is `{amount, currency}` with `amount` an integer in minor units. So is the mock's number,
 *    so the adapter only drops the wrapper (and refuses non-integers, which would be a contract break).
 *  - API rates and quantities are decimal STRINGS. The mock stores numbers. A rate may be converted to a
 *    number for DISPLAY ONLY; live-mode arithmetic must stay on the server (or use the string).
 */

export interface ApiMoney {
  amount: number;
  currency: string;
}

export function fromApiMoney(m: ApiMoney): number {
  if (!Number.isSafeInteger(m.amount)) throw new Error(`Money amount must be an integer of minor units, got ${String(m.amount)}`);
  return m.amount;
}

export function toApiMoney(minor: number, currency: string): ApiMoney {
  if (!Number.isSafeInteger(minor)) throw new Error(`Money amount must be an integer of minor units, got ${String(minor)}`);
  return { amount: minor, currency };
}

/** Nullable money, as the API returns for optional amounts. */
export const fromApiMoneyOrNull = (m: ApiMoney | null | undefined): number | null => (m ? fromApiMoney(m) : null);

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** Display-only number for a decimal string. Throws on anything that is not a plain decimal. */
export function rateForDisplay(rate: string): number {
  if (!DECIMAL.test(rate)) throw new Error(`Not a decimal string: "${rate}"`);
  return Number(rate);
}

/** Mock number -> decimal string for the API. Rejects NaN/Infinity and exponent forms. */
export function rateToApi(rate: number, maxDecimals = 8): string {
  if (!Number.isFinite(rate)) throw new Error(`Not a finite rate: ${String(rate)}`);
  const s = rate.toFixed(maxDecimals).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return s === '-0' ? '0' : s;
}
