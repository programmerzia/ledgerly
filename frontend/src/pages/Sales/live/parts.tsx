import React from 'react';
import { ApiError, type Violation } from '@/api/errors';
import { describeError } from '@/api/messages';
import { describePurchaseViolation, describeTradeViolation } from '@/api/tradeViolations';
import { StatusPill } from '@/components/domain/StatusPill';
import type { LiveDoc } from '@/api/adapters/invoice';

export { ErrorLine, LoadingLine, inputClass } from '@/pages/Accounting/live/parts';

/** A server verdict as text for a toast or banner: the message plus each violation in plain language. */
export function tradeVerdictText(e: unknown, purchases = false): string {
  const describe = purchases ? describePurchaseViolation : describeTradeViolation;
  if (e instanceof ApiError && e.violations?.length) return e.violations.map((v) => describe(v)).join(' ');
  return describeError(e);
}

export const BTN_GHOST =
  'flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition hover:bg-surface-neutral disabled:opacity-50';
export const BTN_ACCENT =
  'flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40';

/** Wrap a card around the first page of a table. */
export const TableCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="overflow-hidden rounded-lg border border-border bg-surface">{children}</div>
);

export const LoadMore: React.FC<{ hasMore: boolean; loading: boolean; onClick: () => void }> = ({ hasMore, loading, onClick }) =>
  hasMore ? (
    <div className="border-t border-border p-3 text-center">
      <button type="button" onClick={onClick} disabled={loading} className="h-8 rounded-md border border-border bg-surface px-4 text-[13px] font-medium text-text-primary hover:bg-surface-neutral disabled:opacity-50">
        {loading ? 'Loading…' : 'Load more'}
      </button>
    </div>
  ) : null;

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export type { Violation };

/** The document's state in the server's words. A credit note is not "awaiting payment": it has credit left, or it has been applied. */
export const DocStatusPill: React.FC<{ doc: Pick<LiveDoc, 'kind' | 'status' | 'paymentStatus'> }> = ({ doc }) => {
  if (doc.status !== 'posted') return <StatusPill status={doc.status} label={doc.status === 'void' ? 'Discarded' : undefined} />;
  if (doc.kind === 'credit_note' || doc.kind === 'debit_note') {
    if (doc.paymentStatus === 'paid') return <StatusPill status="paid" label="Applied" />;
    return <StatusPill status={doc.paymentStatus} label={doc.paymentStatus === 'partially_paid' ? 'Partly applied' : 'Credit available'} />;
  }
  return <StatusPill status={doc.paymentStatus} />;
};

export const numberOf = (d: { number: string | null; status: string }): string => d.number ?? (d.status === 'void' ? 'Discarded' : d.status === 'draft' ? 'Draft' : 'No number yet');
