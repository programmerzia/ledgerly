/** Dates (13 §16): `YYYY-MM-DD` for calendar dates, RFC 3339 UTC for timestamps. The mock uses the same shapes. */

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Validates a calendar date string and returns it unchanged (the view types keep ISO strings). */
export function apiDate(value: string): string {
  if (!DATE.test(value)) throw new Error(`Not a YYYY-MM-DD date: "${value}"`);
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) throw new Error(`Not a real date: "${value}"`);
  return value;
}

export const apiDateOrNull = (value: string | null | undefined): string | null => (value ? apiDate(value) : null);

/** Local calendar date as `YYYY-MM-DD` (never `toISOString().slice`, which shifts by the time zone). */
export function toApiDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** RFC 3339 timestamp -> Date. */
export function parseTimestamp(value: string): Date {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error(`Not an RFC 3339 timestamp: "${value}"`);
  return d;
}
