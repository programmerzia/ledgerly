import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { BTN_SECONDARY, CARD } from '@/pages/Sales/invoice-view/shared';
import { ReasonDialog, showQty } from '@/pages/Procurement/parts';
import { cn } from '@/lib/utils';
import { formatDateTime, formatMoney } from '@/lib/format';
import { describePurchaseViolation } from '@/api/tradeViolations';
import { matchOutcomeLabel, type BillMatch, type MatchRefusal } from '@/api/adapters/procurement';
import type { LiveDoc } from '@/api/adapters/invoice';
import type { Violation } from '@/api/errors';

const lineText = (v: Violation): string => `${typeof v.line_no === 'number' ? `Line ${v.line_no}: ` : ''}${describePurchaseViolation(v)}`;

/**
 * A bill the three-way match refused, in plain words per line. When every reason can be passed with a reason and this
 * person holds the override permission, "Submit anyway" asks for it; the submit then goes through the usual signing.
 */
export const MatchRefusalNotice: React.FC<{
  refusal: MatchRefusal;
  canOverride: boolean;
  busy: boolean;
  onSubmitAnyway: (reason: string) => void;
}> = ({ refusal, canOverride, busy, onSubmitAnyway }) => {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  return (
    <div role="alert" data-testid="match-refusal" className="flex flex-col gap-2 rounded-lg border border-danger/30 bg-danger-soft p-4 text-xs text-danger">
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        <AlertTriangle className="size-4 shrink-0" /> This bill does not match its purchase order, so it was not submitted.
      </div>
      <ul className="flex flex-col gap-1 font-medium">
        {refusal.violations.map((v, i) => (
          <li key={i}>{lineText(v)}</li>
        ))}
      </ul>
      {refusal.overridable ? (
        canOverride ? (
          <div className="pt-1">
            <button type="button" disabled={busy} onClick={() => { setReason(''); setOpen(true); }} className={cn(BTN_SECONDARY, 'border-danger/40 text-danger hover:bg-surface')}>
              Submit anyway
            </button>
          </div>
        ) : (
          <p className="text-text-secondary">Someone with the override permission can pass this bill with a reason. Ask them, or fix the bill so it matches.</p>
        )
      ) : (
        <p className="text-text-secondary">These cannot be passed with a reason. Fix the bill or the order, then submit again.</p>
      )}
      <ReasonDialog
        open={open}
        title="Submit this bill anyway"
        intro="The bill does not match its order. Your reason is kept with the bill. You may be asked for your signing PIN."
        label="Why is it right to pass this bill?"
        confirm="Submit anyway"
        tone="danger"
        value={reason}
        onChange={setReason}
        busy={busy}
        onClose={() => setOpen(false)}
        onConfirm={() => {
          const r = reason.trim();
          setOpen(false);
          onSubmitAnyway(r);
        }}
      />
    </div>
  );
};

/** What the bill is matched against: order price, ordered, received and billed on other bills. Only for a bill the match applies to. */
export const BillMatchPanel: React.FC<{ match: BillMatch; doc: LiveDoc; co: string }> = ({ match, doc, co }) => {
  if (!match.applies) return null;
  const onBill = (lineNo: number) => doc.lines.find((l) => l.line_no === lineNo);
  const last = match.last_result;
  return (
    <section className={cn(CARD, 'no-print overflow-hidden')} aria-label="Match with the purchase order" data-testid="match-panel">
      <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-text-primary">Match with the purchase order</h2>
      {match.lines.length === 0 ? (
        <p className="px-5 py-3 text-[13px] text-text-muted">No line of this bill is on a purchase order.</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
              <th className="px-5 py-2">Line</th>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2 text-right">Order price</th>
              <th className="px-3 py-2 text-right">On this bill</th>
              <th className="px-3 py-2 text-right">Ordered</th>
              <th className="px-3 py-2 text-right">Received</th>
              <th className="px-3 py-2 text-right">Billed elsewhere</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {match.lines.map((l) => (
              <tr key={l.order_line_id}>
                <td className="px-5 py-2 tabular-nums text-text-muted">{l.line_no}</td>
                <td className="px-3 py-2">
                  <Link to={`/${co}/purchase-orders/${l.purchase_order_id}`} className="font-medium text-accent hover:underline">{l.order_number ?? 'Order'}</Link>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{formatMoney(l.order_price_fc, l.currency)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{onBill(l.line_no) ? `${showQty(onBill(l.line_no)?.quantity)} at ${formatMoney(onBill(l.line_no)?.unit_price_fc ?? 0, doc.currency)}` : '—'}</td>
                <td className="px-3 py-2 text-right tabular-nums">{showQty(l.ordered)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{showQty(l.received)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{showQty(l.billed_elsewhere)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {(match.refusals.length > 0 || match.mismatches.length > 0) && (
        <div className="flex flex-col gap-2 border-t border-border px-5 py-3 text-xs">
          {match.refusals.length > 0 && (
            <div>
              <div className="font-semibold text-danger">Must be fixed on the bill</div>
              <ul className="mt-1 flex flex-col gap-0.5 text-danger">
                {match.refusals.map((v, i) => (
                  <li key={i}>{lineText(v)}</li>
                ))}
              </ul>
            </div>
          )}
          {match.mismatches.length > 0 && (
            <div>
              <div className="font-semibold text-warning">Does not match the order</div>
              <ul className="mt-1 flex flex-col gap-0.5 text-warning">
                {match.mismatches.map((v, i) => (
                  <li key={i}>{lineText(v)}</li>
                ))}
              </ul>
              <p className="mt-1 text-text-muted">Someone with the override permission can pass these with a reason when the bill is submitted.</p>
            </div>
          )}
        </div>
      )}
      {last && (
        <p className="border-t border-border px-5 py-3 text-xs text-text-muted" data-testid="match-last-result">
          Last check: <span className="font-medium text-text-secondary">{matchOutcomeLabel(last.outcome)}</span>
          {last.reason ? ` — ${last.reason}` : ''}
          {last.created_at ? ` · ${formatDateTime(last.created_at)}` : ''}
        </p>
      )}
    </section>
  );
};
