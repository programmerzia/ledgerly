/**
 * Dashboard figures from the report endpoints. The report bodies are typed loosely in the OpenAPI file
 * (`additionalProperties`), so each reader checks the shape it needs and returns null rather than guess.
 * Every amount is the server's; nothing here adds, subtracts or converts.
 */
import { fromApiMoney, type ApiMoney } from './money';

export interface Amount {
  /** Integer minor units. */
  minor: number;
  currency: string;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function money(v: unknown): Amount | null {
  if (!isRecord(v) || typeof v.amount !== 'number' || typeof v.currency !== 'string') return null;
  return { minor: fromApiMoney(v as unknown as ApiMoney), currency: v.currency };
}

export interface AgingBuckets {
  current: Amount;
  days1to30: Amount;
  days31to60: Amount;
  days61to90: Amount;
  over90: Amount;
  /** The server's total of the open documents. */
  open: Amount;
  /** What the control account holds: open less credits. */
  net: Amount;
}

/** `GET reports/ar-aging|ap-aging` → the totals row. */
export function agingFromReport(data: unknown): AgingBuckets | null {
  if (!isRecord(data) || !isRecord(data.totals)) return null;
  const t = data.totals;
  const parts = {
    current: money(t.current),
    days1to30: money(t.days_1_30),
    days31to60: money(t.days_31_60),
    days61to90: money(t.days_61_90),
    over90: money(t.days_over_90),
    open: money(t.open),
    net: money(t.net),
  };
  return Object.values(parts).every((p) => p !== null) ? (parts as AgingBuckets) : null;
}

/** `GET reports/profit-and-loss` → net profit for the range. */
export function netProfitFromReport(data: unknown): Amount | null {
  if (!isRecord(data) || !isRecord(data.subtotals) || !isRecord(data.subtotals.net_profit)) return null;
  return money(data.subtotals.net_profit.amount);
}

export interface BankRow {
  id: string;
  name: string;
  maskedNumber: string;
  currency: string;
  /** Book balance as the server reports it, or null when it has none. */
  balance: Amount | null;
  unreconciled: number | null;
}

interface ApiBank {
  id: string;
  name: string;
  currency: string;
  account_number_masked: string | null;
  book_balance: { amount: number; currency: string } | null;
  unreconciled_count: number | null;
  is_active: boolean;
}

export function toBankRows(rows: ApiBank[]): BankRow[] {
  return rows
    .filter((b) => b.is_active)
    .map((b) => ({
      id: b.id,
      name: b.name,
      maskedNumber: b.account_number_masked ?? '',
      currency: b.currency,
      balance: money(b.book_balance),
      unreconciled: b.unreconciled_count,
    }));
}

/** How many to show for a capped list: "12", or "100+" when the server says there is another page. */
export function countLabel(shown: number, hasMore: boolean): string {
  return hasMore ? `${shown}+` : String(shown);
}
