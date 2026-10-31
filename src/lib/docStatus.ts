/**
 * Business-facing status for sales invoices and supplier bills.
 *
 * The ledger status (draft → pending_approval → posted → reversed/void) answers "is it in the
 * books?". Customers ask a different question: "has it been paid, and is it late?". Lists,
 * dashboards and summary strips use this derived status; document headers keep showing the
 * ledger status next to it.
 */
import type { Invoice } from '@/types';
import { roundHalfUp } from '@/lib/format';

/** Demo "today": last day of the current open period (Oct 2026), so overdue math is stable. */
export const BUSINESS_TODAY = '2026-10-31';

export type PaymentStatus =
  | 'draft'
  | 'pending_approval'
  | 'awaiting_payment'
  | 'partially_paid'
  | 'overdue'
  | 'paid'
  | 'reversed'
  | 'void'
  | 'queued';

type Settleable = Pick<Invoice, 'status' | 'due_date' | 'total' | 'settled'> & { wht_amount_fc?: number; fx_rate?: number };

type Dueable = Pick<Invoice, 'total' | 'settled'> & { wht_amount_fc?: number; fx_rate?: number };

/**
 * Amount still owed to / by the counterparty, in base-currency minor units (never negative).
 * For supplier bills with withholding tax the supplier is owed the total less WHT (the WHT is
 * paid to the tax authority), matching how bills post to the AP control account.
 */
export function amountDue(doc: Dueable): number {
  const wht = doc.wht_amount_fc ? roundHalfUp(doc.wht_amount_fc * (doc.fx_rate ?? 1)) : 0;
  return Math.max(0, doc.total - wht - (doc.settled ?? 0));
}

export function daysOverdue(doc: Pick<Invoice, 'due_date'>, today = BUSINESS_TODAY): number {
  const ms = new Date(today).getTime() - new Date(doc.due_date).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function paymentStatus(doc: Settleable, today = BUSINESS_TODAY): PaymentStatus {
  if (doc.status !== 'posted') return doc.status;
  if (amountDue(doc) === 0) return 'paid';
  if (daysOverdue(doc, today) > 0) return 'overdue';
  return (doc.settled ?? 0) > 0 ? 'partially_paid' : 'awaiting_payment';
}

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Awaiting approval',
  awaiting_payment: 'Awaiting payment',
  partially_paid: 'Partially paid',
  overdue: 'Overdue',
  paid: 'Paid',
  reversed: 'Reversed',
  void: 'Void',
  queued: 'Queued offline',
};

export interface StatusBucket {
  key: 'draft' | 'pending_approval' | 'awaiting_payment' | 'overdue' | 'paid';
  label: string;
  count: number;
  /** Base-currency minor units: amount due for open buckets, total for draft/approval/paid. */
  amount: number;
}

/** Summary strip buckets (Xero-style): partially paid counts as awaiting payment. */
export function summarizeByStatus(docs: Settleable[], today = BUSINESS_TODAY): StatusBucket[] {
  const buckets: StatusBucket[] = [
    { key: 'draft', label: 'Draft', count: 0, amount: 0 },
    { key: 'pending_approval', label: 'Awaiting approval', count: 0, amount: 0 },
    { key: 'awaiting_payment', label: 'Awaiting payment', count: 0, amount: 0 },
    { key: 'overdue', label: 'Overdue', count: 0, amount: 0 },
    { key: 'paid', label: 'Paid', count: 0, amount: 0 },
  ];
  for (const d of docs) {
    const s = paymentStatus(d, today);
    const key = s === 'partially_paid' ? 'awaiting_payment' : s;
    const b = buckets.find((x) => x.key === key);
    if (!b) continue;
    b.count += 1;
    b.amount += key === 'awaiting_payment' || key === 'overdue' ? amountDue(d) : d.total;
  }
  return buckets;
}
