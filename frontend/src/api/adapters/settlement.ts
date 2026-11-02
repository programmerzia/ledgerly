/**
 * Settlements (receipts, payments, refunds) at the API boundary. Same resource for customers and suppliers: `kind` is
 * data, nothing here is specific to receipts. The server owns the base amount, the carried amounts, the exchange
 * differences and what is left unallocated.
 */
import type { components } from '../schema';
import { fromApiMoney, type ApiMoney } from './money';
import type { DocStatus } from './invoice';

export type ApiSettlement = components['schemas']['SettlementResource'];
export type ApiCreditApplication = components['schemas']['CreditApplicationResource'];

export interface SettlementCan {
  update: boolean;
  submit: boolean;
  approve: boolean;
  return: boolean;
  void: boolean;
  reverse: boolean;
  allocate: boolean;
}

export function toSettlementCan(raw: unknown): SettlementCan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const b = (k: string) => r[k] === true;
  return { update: b('update'), submit: b('submit'), approve: b('approve'), return: b('return'), void: b('void'), reverse: b('reverse'), allocate: b('allocate') };
}

export interface LiveAllocation {
  id: string;
  invoice_id: string | null;
  source_settlement_id: string | null;
  amount_fc: number;
  amount: number;
  /** Positive is a gain, base currency. */
  fx_gain_loss: number;
}

export interface LiveSettlement {
  id: string;
  kind: 'receipt' | 'payment' | 'refund' | 'supplier_refund' | string;
  number: string | null;
  status: DocStatus;
  contact_id: string;
  cash_account_id: string;
  bank_account_id: string | null;
  settlement_date: string;
  currency: string;
  fx_rate: string;
  amount_fc: number;
  amount: number;
  /** Credit on account, in the settlement currency. */
  unallocated_fc: number;
  unallocated: number;
  baseCurrency: string;
  reference: string;
  memo: string;
  journal_id: string | null;
  reversal_journal_id: string | null;
  created_by: string | null;
  submitted_by: string | null;
  posted_at: string | null;
  version: number;
  allocations: LiveAllocation[];
  /** True when the server sent the allocations (a single document does; a list row does not). */
  hasAllocations: boolean;
  can: SettlementCan;
}

const money = (m: ApiMoney): number => fromApiMoney(m);

export function toSettlement(a: ApiSettlement): LiveSettlement {
  const rows = (a.allocations ?? []) as Array<{
    id: string;
    invoice_id: string | null;
    source_settlement_id: string | null;
    amount_fc: ApiMoney;
    amount: ApiMoney;
    fx_gain_loss: ApiMoney;
  }>;
  return {
    id: a.id,
    kind: a.kind,
    number: a.number,
    status: a.status,
    contact_id: a.contact_id,
    cash_account_id: a.cash_account_id,
    bank_account_id: a.bank_account_id,
    settlement_date: a.settlement_date ?? '',
    currency: a.currency,
    fx_rate: a.fx_rate,
    amount_fc: money(a.amount_fc),
    amount: money(a.amount),
    unallocated_fc: money(a.unallocated_fc),
    unallocated: money(a.unallocated),
    baseCurrency: a.amount.currency,
    reference: a.reference ?? '',
    memo: a.memo ?? '',
    journal_id: a.journal_id,
    reversal_journal_id: a.reversal_journal_id,
    created_by: a.created_by,
    submitted_by: a.submitted_by,
    posted_at: a.posted_at,
    version: a.version,
    allocations: rows.map((r) => ({
      id: r.id,
      invoice_id: r.invoice_id,
      source_settlement_id: r.source_settlement_id,
      amount_fc: money(r.amount_fc),
      amount: money(r.amount),
      fx_gain_loss: money(r.fx_gain_loss),
    })),
    hasAllocations: Array.isArray(a.allocations),
    can: toSettlementCan(a.can),
  };
}

export interface AllocationInput {
  /** A document (invoice, bill, credit or debit note)... */
  invoice_id?: string;
  /** ...or the credit on account of an earlier receipt or payment (a refund pays that back). */
  source_settlement_id?: string;
  /** Minor units of the settlement currency. */
  amount_fc: number;
}

export interface SettlementDraftInput {
  kind: 'receipt' | 'payment' | 'refund' | 'supplier_refund';
  contact_id: string;
  /** The bank account chosen on the form: the GL account and the bank record both go to the API. */
  cash_account_id: string;
  bank_account_id: string;
  settlement_date: string;
  amount_fc: number;
  currency: string;
  /** Empty: the server uses its stored rate. Only sent when the currency is not the base. */
  fx_rate: string;
  reference: string;
  memo: string;
  allocations: AllocationInput[];
}

export function toSettlementRequest(input: SettlementDraftInput, baseCurrency: string, version?: number): Record<string, unknown> {
  const body: Record<string, unknown> = {
    kind: input.kind,
    contact_id: input.contact_id,
    cash_account_id: input.cash_account_id,
    bank_account_id: input.bank_account_id || null,
    settlement_date: input.settlement_date,
    amount_fc: input.amount_fc,
    currency: input.currency,
    reference: input.reference.trim() || null,
    memo: input.memo.trim() || null,
    allocations: input.allocations.filter((a) => a.amount_fc > 0).map((a) => (a.source_settlement_id ? { source_settlement_id: a.source_settlement_id, amount_fc: a.amount_fc } : { invoice_id: a.invoice_id, amount_fc: a.amount_fc })),
  };
  if (input.currency !== baseCurrency && input.fx_rate.trim()) body.fx_rate = input.fx_rate.trim();
  if (version !== undefined) body.version = version;
  return body;
}

export interface LiveCreditApplication {
  id: string;
  invoice_id: string;
  amount_fc: number;
  amount: number;
  fx_gain_loss: number;
  applied_on: string;
}

export function toCreditApplication(a: ApiCreditApplication): LiveCreditApplication {
  return { id: a.id, invoice_id: a.invoice_id, amount_fc: money(a.amount_fc), amount: money(a.amount), fx_gain_loss: money(a.fx_gain_loss), applied_on: a.applied_on ?? '' };
}
