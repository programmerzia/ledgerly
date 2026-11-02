import React, { useState } from 'react';
import { useReport } from '@/data/reports';
import { useRouteCompany } from '@/data/session';
import type { CashFlowSection } from '@/api/adapters/report';
import { cn } from '@/lib/utils';
import { CheckBadge, ReportCard, longDate, tone } from '../ReportParts';
import { LiveReportShell } from './LiveReportShell';
import { DrillDialog, Drillable, ReportError, ReportLoading, fmt, type DrillTarget } from './parts';
import { useReportSelection } from './useSelection';

const GRID = 'grid grid-cols-[minmax(12rem,1fr)_8rem] gap-3';

export const LiveCashFlow: React.FC = () => {
  const company = useRouteCompany();
  const { selection, set, periods, ready } = useReportSelection('range');
  const q = useReport('cash-flow', selection, ready);
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const cf = q.data;
  const money = fmt(cf?.currency ?? company.base_currency);

  const section = (title: string, s: CashFlowSection, totalLabel: string, testId: string) => (
    <div>
      <div className="px-2 pt-4 pb-1 text-[13px] font-semibold text-text-primary">{title}</div>
      <div className="divide-y divide-border/60">
        {s.lines.length === 0 && <div className="px-2 py-1.5 text-xs text-text-muted">Nothing in this period.</div>}
        {s.lines.map((l, i) => (
          <div key={`${l.key}-${i}`} className={`${GRID} items-baseline px-2 py-1.5 text-xs`}>
            <span className="text-text-primary">{l.label}</span>
            <span className={cn('text-right', tone(l.amount))}>
              <Drillable drill={l.drill} onDrill={(key) => setDrill({ key, title: l.label })}>{money(l.amount)}</Drillable>
            </span>
          </div>
        ))}
      </div>
      <div className={`${GRID} items-baseline px-2 py-2 border-t border-border text-[13px] font-semibold`} data-testid={testId}>
        <span className="text-text-primary">{totalLabel}</span>
        <span className={cn('text-right tabular-nums', tone(s.total))}>{money(s.total)}</span>
      </div>
    </div>
  );

  const summary = (label: string, value: number, testId: string, strong = false) => (
    <div className={cn(`${GRID} items-baseline px-2 py-2`, strong ? 'border-t border-text-primary border-b-[3px] border-double text-sm font-semibold mt-1' : 'text-[13px]')} data-testid={testId}>
      <span className="text-text-primary">{label}</span>
      <span className={cn('text-right tabular-nums', tone(value))}>{money(value)}</span>
    </div>
  );

  return (
    <LiveReportShell
      title="Cash flow"
      report="cash-flow"
      kind="range"
      selection={selection}
      onChange={set}
      periods={periods}
      descriptor={cf ? `${longDate(cf.from)} to ${longDate(cf.to)} · indirect method` : undefined}
      generatedAt={cf?.generatedAt}
      toolbar={cf && <CheckBadge ok={cf.reconciles} okLabel="Agrees with the cash accounts" badLabel="Does not agree with the cash accounts" />}
    >
      {!ready || q.isPending ? <ReportLoading what="the cash flow" /> : q.isError ? <ReportError error={q.error} onRetry={() => void q.refetch()} what="the cash flow" /> : cf && (
        <ReportCard>
          <div className="min-w-[480px]">
            {section('Operating activities', cf.operating, 'Net cash from operating activities', 'cf-operating')}
            {section('Investing activities', cf.investing, 'Net cash from investing activities', 'cf-investing')}
            {section('Financing activities', cf.financing, 'Net cash from financing activities', 'cf-financing')}
            <div className="mt-2">
              {cf.fxEffect !== 0 && summary('Effect of exchange rate changes on cash', cf.fxEffect, 'cf-fx')}
              {summary('Net change in cash', cf.netChange, 'cf-net-change')}
              {summary('Cash at the start', cf.opening, 'cf-opening')}
              {summary('Cash at the end', cf.closing, 'cf-closing', true)}
            </div>
            {!cf.reconciles && (
              <div className="mt-3 flex justify-between px-2 text-xs font-semibold text-danger" role="alert" data-testid="cf-unexplained">
                <span>Not explained by the activities above</span>
                <span className="tabular-nums">{money(cf.unexplained)}</span>
              </div>
            )}
            {cf.assumptions.length > 0 && (
              <div className="mt-6 px-2 text-xs text-text-muted" data-testid="cf-assumptions">
                <p className="font-semibold text-text-secondary">Accounts placed by default</p>
                <ul className="mt-1 list-disc pl-4">
                  {cf.assumptions.map((a, i) => (
                    <li key={i}>{a.account}: {a.activity}. {a.reason}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </ReportCard>
      )}
      <DrillDialog target={drill} onClose={() => setDrill(null)} />
    </LiveReportShell>
  );
};
