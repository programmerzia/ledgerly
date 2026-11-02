import React, { useState } from 'react';
import { useReport } from '@/data/reports';
import { useRouteCompany } from '@/data/session';
import type { Figure } from '@/api/adapters/report';
import { cn } from '@/lib/utils';
import { ReportCard, longDate, tone } from '../ReportParts';
import { LiveReportShell } from './LiveReportShell';
import { DrillDialog, Drillable, NoComparisonNote, ReportError, ReportLoading, FigureCells, VarianceCells, fmt, type DrillTarget } from './parts';
import { useReportSelection } from './useSelection';

/** Subtotals sit after the section they follow, in the order the statement is read. */
const AFTER: Record<string, 'grossProfit' | 'operatingProfit'> = { direct_costs: 'grossProfit', operating_expense: 'operatingProfit' };
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
      {!ready || q.isPending ? <ReportLoading what="the profit and loss" /> : q.isError ? <ReportError error={q.error} onRetry={() => void q.refetch()} what="the profit and loss" /> : pl && (
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
