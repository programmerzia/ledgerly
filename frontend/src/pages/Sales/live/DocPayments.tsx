import React from 'react';
import { Link } from 'react-router-dom';
import { formatDate, formatMoney } from '@/lib/format';
import type { LiveDocPayment } from '@/api/adapters/settlement';
import { CARD } from '@/pages/Sales/invoice-view/shared';
import { cn } from '@/lib/utils';
import { ErrorLine, LoadingLine } from './parts';
import type { Side } from './side';

const KIND_WORDS: Record<string, string> = {
  receipt: 'Receipt',
  payment: 'Payment',
  customer_refund: 'Refund',
  supplier_refund: 'Refund',
  refund: 'Refund',
};

/** What a row is called: the settlement's number, or "Credit applied" for a credit note put against the document. */
export const paymentTitle = (p: LiveDocPayment): string =>
  p.type === 'credit_application' ? `Credit applied${p.number ? ` from ${p.number}` : ''}` : `${KIND_WORDS[p.kind] ?? 'Payment'} ${p.number}`.trim();

export const DocPayments: React.FC<{
  rows: LiveDocPayment[];
  isLoading: boolean;
  error: unknown;
  onRetry: () => void;
  slug: string;
  settlementPath: string;
  side: Side;
  busy: boolean;
  onUndo: (p: LiveDocPayment) => void;
}> = ({ rows, isLoading, error, onRetry, slug, settlementPath, side, busy, onUndo }) => {
  if (isLoading) return <LoadingLine what="payments" />;
  if (error) return <ErrorLine error={error} onRetry={onRetry} />;
  if (rows.length === 0) return null;
  return (
    <section className={cn(CARD, 'overflow-hidden')} aria-label="Payments" data-testid="doc-payments">
      <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-text-primary">Payments</h2>
      <table className="w-full text-left text-xs">
        <thead>
          <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
            <th className="px-5 py-2">What</th>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2 text-right">{side === 'sales' ? 'Paid' : 'Paid out'}</th>
            <th className="px-3 py-2 text-right">In books</th>
            <th className="px-3 py-2 text-right">Exchange</th>
            <th className="w-20 px-5 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((p) => (
            <tr key={`${p.type}:${p.id}`} data-payment={p.type}>
              <td className="px-5 py-2">
                {p.type === 'settlement' ? (
                  <Link to={`/${slug}/${settlementPath}/${p.id}`} className="font-medium text-accent hover:underline">{paymentTitle(p)}</Link>
                ) : (
                  <span className="text-text-primary">{paymentTitle(p)}</span>
                )}
              </td>
              <td className="px-3 py-2 tabular-nums text-text-muted">{formatDate(p.date)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-text-primary">{formatMoney(p.amount_fc, p.currency)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{formatMoney(p.amount, p.base_currency)}</td>
              <td className="px-3 py-2 text-right tabular-nums text-text-muted">{p.fx_gain_loss !== 0 ? formatMoney(p.fx_gain_loss, p.base_currency) : ''}</td>
              <td className="px-5 py-2 text-right">
                {p.type === 'credit_application' && p.can_undo && (
                  <button type="button" disabled={busy} onClick={() => onUndo(p)} className="text-xs text-accent hover:underline disabled:opacity-50">Undo</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};
