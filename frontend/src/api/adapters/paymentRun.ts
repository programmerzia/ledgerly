/**
 * Payment runs at the API boundary. A run pays several bills at once in one currency from one bank account; the server
 * works out the withholding per bill, the totals and the payments it makes. Pure functions, no arithmetic.
 */
import type { components } from '../schema';
import { fromApiMoney, type ApiMoney } from './money';
import type { DocStatus } from './invoice';

export type ApiPaymentRun = components['schemas']['PaymentRunResource'];

export interface RunCan {
  update: boolean;
  submit: boolean;
  approve: boolean;
  return: boolean;
  void: boolean;
}

export function toRunCan(raw: unknown): RunCan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const b = (k: string) => r[k] === true;
  return { update: b('update'), submit: b('submit'), approve: b('approve'), return: b('return'), void: b('void') };
}

export interface LiveRunItem {
  id: string;
  line_no: number;
  invoice_id: string;
  contact_id: string;
  /** Cash paid on this bill, in the run's currency. */
  amount_fc: number;
  wht_amount_fc: number;
}

export interface LivePaymentRun {
  id: string;
  number: string | null;
  status: DocStatus;
  cash_account_id: string;
  bank_account_id: string | null;
  run_date: string;
  currency: string;
  fx_rate: string;
  total_gross: number;
  total_wht: number;
  total_net: number;
  /** Base currency. */
  total: number;
  baseCurrency: string;
  reference: string;
  memo: string;
  created_by: string | null;
  submitted_by: string | null;
  posted_at: string | null;
  version: number;
  items: LiveRunItem[];
  /** True when the server sent the items (a single run does; a list row does not). */
  hasItems: boolean;
  can: RunCan;
}

const money = (m: ApiMoney): number => fromApiMoney(m);

export function toPaymentRun(a: ApiPaymentRun): LivePaymentRun {
  const rows = (a.items ?? []) as Array<{ id: string; line_no: number; invoice_id: string; contact_id: string; amount_fc: ApiMoney; wht_amount_fc: ApiMoney }>;
  return {
    id: a.id,
    number: a.number,
    status: a.status,
    cash_account_id: a.cash_account_id,
    bank_account_id: a.bank_account_id,
    run_date: a.run_date ?? '',
    currency: a.currency,
    fx_rate: a.fx_rate,
    total_gross: money(a.total_gross),
    total_wht: money(a.total_wht),
    total_net: money(a.total_net),
    total: money(a.total),
    baseCurrency: a.total.currency,
    reference: a.reference ?? '',
    memo: a.memo ?? '',
    created_by: a.created_by,
    submitted_by: a.submitted_by,
    posted_at: a.posted_at,
    version: a.version,
    items: rows.map((i) => ({ id: i.id, line_no: i.line_no, invoice_id: i.invoice_id, contact_id: i.contact_id, amount_fc: money(i.amount_fc), wht_amount_fc: money(i.wht_amount_fc) })),
    hasItems: Array.isArray(a.items),
    can: toRunCan(a.can),
  };
}

export interface RunDraftInput {
  cash_account_id: string;
  bank_account_id: string;
  run_date: string;
  currency: string;
  /** Empty: the server uses its stored rate. Only sent when the currency is not the base. */
  fx_rate: string;
  reference: string;
  memo: string;
  /** Bill id -> minor units of the run currency. */
  items: Array<{ invoice_id: string; amount_fc: number }>;
}

export function toRunRequest(input: RunDraftInput, baseCurrency: string, version?: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    cash_account_id: input.cash_account_id,
    bank_account_id: input.bank_account_id || null,
    run_date: input.run_date,
    currency: input.currency,
    reference: input.reference.trim() || null,
    memo: input.memo.trim() || null,
    items: input.items.filter((i) => i.amount_fc > 0).map((i) => ({ invoice_id: i.invoice_id, amount_fc: i.amount_fc })),
  };
  if (input.currency !== baseCurrency && input.fx_rate.trim()) body.fx_rate = input.fx_rate.trim();
  if (version !== undefined) body.version = version;
  return body;
}
