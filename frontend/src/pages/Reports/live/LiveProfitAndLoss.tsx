import React, { useState } from 'react';
import { useReport } from '@/data/reports';
import { useRouteCompany } from '@/data/session';
import type { Figure } from '@/api/adapters/report';
import { cn } from '@/lib/utils';
import { ReportCard, longDate, tone } from '../ReportParts';
import { LiveReportShell } from './LiveReportShell';
import { DrillDialog, Drillable, NoComparisonNote, dash, ReportError, ReportLoading, FigureCells, VarianceCells, fmt, type DrillTarget } from './parts';
import { useReportSelection } from './useSelection';

/** Subtotals sit after the section they follow, in the order the statement is read. */
const AFTER: Record<string, 'grossProfit' | 'operatingProfit'> = { direct_costs: 'grossProfit', operating_expense: 'operatingProfit' };
const gridOf = (n: number): React.CSSProperties => ({ gridTemplateColumns: `minmax(12rem,1fr) repeat(${n + 1}, 7.5rem)` });
const SUBTOTAL_LABEL = { grossProfit: 'Gross profit', operatingProfit: 'Operating profit', netProfit: 'Net profit' } as const;

export const LiveProfitAndLoss: React.FC = () => {
  const company = useRouteCompany();
  const { selection, set, periods, ready } = useReportSelection('range', true);
  const q = useReport('profit-and-loss', selection, ready);
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const pl = q.data;
  const money = fmt(pl?.currency ?? company.base_currency);
  const compare = pl?.comparison?.available === true;
  const cols = { gridTemplateColumns: compare ? 'minmax(12rem,1fr) 8rem 8rem 8rem 5rem' : 'minmax(12rem,1fr) 8rem' };

  const subtotal = (key: keyof typeof SUBTOTAL_LABEL, big = false) =>
    pl && (
      <div
        key={key}
        style={cols}
        data-testid={`pl-${key}`}
        className={cn('grid gap-3 items-baseline px-2 font-semibold', big ? 'text-sm py-2.5 mt-1 border-t border-text-primary border-b-[3px] border-double' : 'text-[13px] py-2 border-t border-border')}
      >
        <span className="text-text-primary">{SUBTOTAL_LABEL[key]}</span>
        <FigureCells fig={pl[key]} money={money} compare={compare} bold />
      </div>
    );

  return (
    <LiveReportShell
      title="Profit and loss"
      report="profit-and-loss"
      kind="range"
      selection={selection}
      onChange={set}
      periods={periods}
      descriptor={pl ? `${longDate(pl.from)} to ${longDate(pl.to)}` : undefined}
      generatedAt={pl?.generatedAt}
    >
      {!ready || q.isPending ? <ReportLoading what="the profit and loss" /> : q.isError ? <ReportError error={q.error} onRetry={() => void q.refetch()} what="the profit and loss" /> : pl && pl.breakdown ? (
        <ReportCard>
          <div style={{ minWidth: 360 + 120 * (pl.breakdown.columns.length + 1) }} data-testid="pl-breakdown">
            <div style={gridOf(pl.breakdown.columns.length)} className="grid gap-3 px-2 pb-2 border-b border-border text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
              <span>Account</span>
              {pl.breakdown.columns.map((c) => <span key={c?.id ?? 'untagged'} className="text-right">{c ? c.name : 'Untagged'}</span>)}
              <span className="text-right">Total</span>
            </div>
            {pl.sections.map((s) => {
              const row = (key: string, label: React.ReactNode, f: { amount: number; byDimension?: number[] }, cls: string, node?: React.ReactNode) => (
                <div key={key} style={gridOf(pl.breakdown!.columns.length)} className={cn('grid gap-3 items-baseline px-2 tabular-nums', cls)}>
                  <span className="text-text-primary font-sans">{label}</span>
                  {(f.byDimension ?? []).map((v, i) => <span key={i} className="text-right">{v === 0 ? dash : money(v)}</span>)}
                  <span className="text-right">{node ?? money(f.amount)}</span>
                </div>
              );
              return (
                <React.Fragment key={s.key}>
                  {s.lines.length > 0 && (
                    <div>
                      <div className="px-2 pt-4 pb-1 text-[13px] font-semibold text-text-primary">{s.title}</div>
                      <div className="divide-y divide-border/60">
                        {s.lines.map((l) => row(l.account.id, <><span className="font-code text-text-muted mr-2">{l.account.code}</span>{l.account.name}</>, l, 'py-1.5 text-xs', <Drillable drill={l.drill} onDrill={(key) => setDrill({ key, title: l.account.name })}>{money(l.amount)}</Drillable>))}
                      </div>
                      {row(`${s.key}-total`, `Total ${s.title.toLowerCase()}`, s.total, 'py-2 border-t border-border text-[13px] font-semibold')}
                    </div>
                  )}
                  {AFTER[s.key] && row(AFTER[s.key], SUBTOTAL_LABEL[AFTER[s.key]], pl[AFTER[s.key]], 'py-2 border-t border-border text-[13px] font-semibold')}
                </React.Fragment>
              );
            })}
            <div style={gridOf(pl.breakdown.columns.length)} data-testid="pl-netProfit" className="grid gap-3 items-baseline px-2 py-2.5 mt-1 border-t border-text-primary border-b-[3px] border-double text-sm font-semibold tabular-nums">
              <span className="text-text-primary">Net profit</span>
              {(pl.netProfit.byDimension ?? []).map((v, i) => <span key={i} className="text-right">{money(v)}</span>)}
              <span className="text-right">{money(pl.netProfit.amount)}</span>
            </div>
            <p className="mt-3 px-2 text-xs text-text-muted">The columns add up to the Total column, which is the profit and loss without a breakdown. Untagged holds lines with no {pl.breakdown.dimension.name}.</p>
          </div>
        </ReportCard>
      ) : pl && (
        <ReportCard>
          <div className="min-w-[520px]">
            <div style={cols} className="grid gap-3 px-2 pb-2 border-b border-border text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
              <span>Account</span>
              <span className="text-right">Amount</span>
              {compare && (
                <>
                  <span className="text-right">Compared</span>
                  <span className="text-right">Change</span>
                  <span className="text-right">%</span>
                </>
              )}
            </div>
            <div className="py-1"><NoComparisonNote available={pl.comparison?.available} /></div>
            {pl.sections.map((s) => (
              <React.Fragment key={s.key}>
                {s.lines.length > 0 && (
                  <div>
                    <div className="px-2 pt-4 pb-1 text-[13px] font-semibold text-text-primary">{s.title}</div>
                    <div className="divide-y divide-border/60">
                      {s.lines.map((l) => (
                        <div key={l.account.id} style={cols} className="grid gap-3 items-baseline px-2 py-1.5 text-xs">
                          <span className="text-text-primary">
                            <span className="font-code text-text-muted mr-2">{l.account.code}</span>
                            {l.account.name}
                          </span>
                          <span className={cn('text-right', tone(l.amount))}>
                            <Drillable drill={l.drill} onDrill={(key) => setDrill({ key, title: l.account.name })}>{money(l.amount)}</Drillable>
                          </span>
                          {compare && <VarianceCells fig={l} money={money} />}
                        </div>
                      ))}
                    </div>
                    <div style={cols} className="grid gap-3 items-baseline px-2 py-2 border-t border-border text-[13px] font-semibold">
                      <span className="text-text-primary">Total {s.title.toLowerCase()}</span>
                      <FigureCells fig={s.total} money={money} compare={compare} bold />
                    </div>
                  </div>
                )}
                {AFTER[s.key] && subtotal(AFTER[s.key])}
              </React.Fragment>
            ))}
            {subtotal('netProfit', true)}
            {pl.filtered && <p className="mt-3 px-2 text-xs text-text-muted">Filtered by a dimension: only the lines tagged with it are included.</p>}
          </div>
        </ReportCard>
      )}
      <DrillDialog target={drill} onClose={() => setDrill(null)} />
    </LiveReportShell>
  );
};
