import React from 'react';
import { useReport } from '@/data/reports';
import { useRouteCompany } from '@/data/session';
import type { TaxSide } from '@/api/adapters/report';
import { cn } from '@/lib/utils';
import { ReportCard, longDate, tone } from '../ReportParts';
import { LiveReportShell } from './LiveReportShell';
import { ReportError, ReportLoading, fmt } from './parts';
import { useReportSelection } from './useSelection';

const GRID = 'grid grid-cols-[minmax(12rem,1fr)_9rem_9rem] gap-3';

export const LiveTaxReturn: React.FC = () => {
  const company = useRouteCompany();
  const { selection, set, periods, ready } = useReportSelection('range');
  const q = useReport('tax-return', selection, ready);
  const tr = q.data;
  const money = fmt(tr?.currency ?? company.base_currency);

  const side = (title: string, s: TaxSide, testId: string) => (
    <div className="mb-6">
      <div className="px-2 pb-1 text-[13px] font-semibold text-text-primary">{title}</div>
      <div className={`${GRID} px-2 py-2 border-b border-border text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted`}>
        <span>Tax code</span><span className="text-right">Net amount</span><span className="text-right">Tax</span>
      </div>
      {s.rows.length === 0 && <p className="px-2 py-3 text-xs text-text-muted">No documents with tax in this period.</p>}
      <div className="divide-y divide-border/60">
        {s.rows.map((r, i) => (
          <div key={`${r.code}-${i}`} className={`${GRID} items-baseline px-2 py-1.5 text-xs`}>
            <span className="text-text-primary">
              {r.code && <span className="font-code text-text-muted mr-2">{r.code}</span>}
              {r.name}
              {r.recoverable === false && <span className="ml-2 text-text-muted">not recoverable, counted as cost</span>}
            </span>
            <span className="text-right tabular-nums">{money(r.net)}</span>
            <span className={cn('text-right tabular-nums', r.recoverable === false && 'text-text-muted')}>{money(r.tax)}</span>
          </div>
        ))}
      </div>
      <div className={`${GRID} items-baseline px-2 py-2 border-t border-border text-[13px] font-semibold`} data-testid={testId}>
        <span className="text-text-primary">Total</span>
        <span className="text-right tabular-nums">{money(s.totalNet)}</span>
        <span className="text-right tabular-nums">{money(s.totalTax)}</span>
      </div>
    </div>
  );

  return (
    <LiveReportShell
      title="Tax return"
      report="tax-return"
      kind="range"
      selection={selection}
      onChange={set}
      periods={periods}
      descriptor={tr ? `${longDate(tr.from)} to ${longDate(tr.to)}` : undefined}
      generatedAt={tr?.generatedAt}
    >
      {!ready || q.isPending ? <ReportLoading what="the tax return" /> : q.isError ? <ReportError error={q.error} onRetry={() => void q.refetch()} what="the tax return" /> : tr && (
        <ReportCard>
          <div className="min-w-[560px]">
            {side('Sales: tax charged (output)', tr.sales, 'tax-sales-total')}
            {side('Purchases: tax paid (input)', tr.purchases, 'tax-purchases-total')}
            <div className={`${GRID} items-baseline px-2 py-3 border-t border-text-primary border-b-[3px] border-double text-sm font-semibold`} data-testid="tax-net-payable">
              <span className="text-text-primary">Net tax payable</span>
              <span />
              <span className={cn('text-right tabular-nums', tone(tr.netPayable))}>{money(tr.netPayable)}</span>
            </div>
            <p className="mt-4 px-2 text-xs text-text-muted">Totals per tax code. Filing boxes depend on the tax authority and are not set up yet.</p>
          </div>
        </ReportCard>
      )}
    </LiveReportShell>
  );
};
