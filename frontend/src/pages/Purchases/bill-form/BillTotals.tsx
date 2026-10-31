import React, { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface RecordedRow {
  key: string;
  code: string;
  name: string;
  debit: number;
  credit: number;
}

interface TotalsProps {
  subtotal: number;
  tax: number;
  total: number;
  whtPct: number;
  whtAmount: number;
  netPayable: number;
  currency: string;
}

export const BillTotals: React.FC<TotalsProps> = ({ subtotal, tax, total, whtPct, whtAmount, netPayable, currency }) => (
  <div className="flex justify-end">
    <dl className="w-72 text-xs flex flex-col gap-1.5">
      <div className="flex justify-between text-text-secondary">
        <dt>Subtotal</dt>
        <dd className="font-mono text-num text-text-primary">{formatMoney(subtotal, currency)}</dd>
      </div>
      <div className="flex justify-between text-text-secondary">
        <dt>VAT</dt>
        <dd className="font-mono text-num text-text-primary">{formatMoney(tax, currency)}</dd>
      </div>
      <div className="flex justify-between items-baseline border-t border-border pt-2 mt-0.5">
        <dt className="font-semibold text-text-primary text-sm">Total</dt>
        <dd className="font-mono text-num font-semibold text-text-primary text-base">{formatMoney(total, currency)}</dd>
      </div>
      {whtPct > 0 && (
        <div className="flex justify-between text-text-muted">
          <dt>Withholding tax ({whtPct}%)</dt>
          <dd className="font-mono text-num">−{formatMoney(whtAmount, currency)}</dd>
        </div>
      )}
      <div className="flex justify-between items-baseline rounded-lg bg-surface-neutral px-3 py-2 mt-1">
        <dt className="font-semibold text-text-primary text-[13px]">You'll pay the supplier</dt>
        <dd className="font-mono text-num font-semibold text-accent text-base">{formatMoney(netPayable, currency)}</dd>
      </div>
    </dl>
  </div>
);

interface RecordedProps {
  rows: RecordedRow[];
  sentence: string;
  currency: string;
}

export const BillRecorded: React.FC<RecordedProps> = ({ rows, sentence, currency }) => {
  const [open, setOpen] = useState(false);
  const debit = rows.reduce((s, r) => s + r.debit, 0);
  const credit = rows.reduce((s, r) => s + r.credit, 0);
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="self-start inline-flex items-center gap-1 text-[13px] font-medium text-text-primary hover:text-accent transition"
      >
        <ChevronRight className={cn('size-4 text-text-muted transition-transform', open && 'rotate-90')} />
        How it's recorded
      </button>
      <p className="text-xs text-text-secondary">{sentence}</p>
      {open && (
        <div className="rounded-lg border border-border overflow-hidden bg-surface">
          <table className="w-full text-xs">
            <thead>
              <tr className="h-8 bg-surface-neutral text-[11px] font-semibold text-text-muted border-b border-border">
                <th className="px-3 text-left">Account</th>
                <th className="px-3 text-right w-32">Debit</th>
                <th className="px-3 text-right w-32">Credit</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.key} className="h-8">
                  <td className={cn('px-3 text-text-primary', r.credit > 0 && 'pl-8')}>
                    <span className="font-mono text-text-muted mr-2">{r.code}</span>
                    {r.name}
                  </td>
                  <td className="px-3 text-right font-mono text-num">{r.debit ? formatMoney(r.debit, currency) : ''}</td>
                  <td className="px-3 text-right font-mono text-num">{r.credit ? formatMoney(r.credit, currency) : ''}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="h-8 border-t border-border bg-surface-neutral/60 font-semibold">
                <td className="px-3 text-text-secondary">Total</td>
                <td className="px-3 text-right font-mono text-num">{formatMoney(debit, currency)}</td>
                <td className="px-3 text-right font-mono text-num">{formatMoney(credit, currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
};
