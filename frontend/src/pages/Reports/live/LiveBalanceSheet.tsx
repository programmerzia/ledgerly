import React, { useState } from 'react';
import { useReport } from '@/data/reports';
import { useRouteCompany } from '@/data/session';
import type { BsLine, BsSection, Figure, FundRef } from '@/api/adapters/report';
import { cn } from '@/lib/utils';
import { CheckBadge, ReportCard, longDate, tone } from '../ReportParts';
import { LiveReportShell } from './LiveReportShell';
import { DrillDialog, Drillable, NoComparisonNote, ReportError, ReportLoading, FigureCells, VarianceCells, fmt, type DrillTarget } from './parts';
import { useReportSelection } from './useSelection';

const fundName = (f: FundRef | null | undefined) => (f ? f.name || f.code : 'No fund (unrestricted)');

export const LiveBalanceSheet: React.FC = () => {
  const company = useRouteCompany();
  const { selection, set, periods, ready } = useReportSelection('asof', true);
  const q = useReport('balance-sheet', selection, ready);
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const bs = q.data;
  const money = fmt(bs?.currency ?? company.base_currency);
  const compare = bs?.comparison?.available === true;
  const cols = { gridTemplateColumns: compare ? 'minmax(12rem,1fr) 8rem 8rem 8rem 5rem' : 'minmax(12rem,1fr) 8rem' };

  const line = (l: BsLine) => (
    <div key={l.key}>
      <div style={cols} className="grid gap-3 items-baseline px-2 py-1.5 text-xs" data-testid={l.gross ? 'bs-gross-line' : undefined}>
        <span className="text-text-primary">
          {l.code && <span className="font-code text-text-muted mr-2">{l.code}</span>}
          {l.label}
          {l.fund !== undefined && <span className="ml-2 text-text-muted">{fundName(l.fund)}</span>}
        </span>
        <FigureCells fig={l} money={money} compare={compare} node={<Drillable drill={l.drill} onDrill={(key) => setDrill({ key, title: l.label })}>{money(l.amount)}</Drillable>} />
      </div>
      {l.contacts.map((c) => (
        <div key={c.id ?? 'none'} style={cols} className="grid gap-3 items-baseline pl-8 pr-2 py-1 text-xs text-text-secondary">
          <span>{c.name || 'No contact'}</span>
          <span className="text-right">
            <Drillable drill={c.drill} onDrill={(key) => setDrill({ key, title: c.name || l.label })}>{money(c.amount)}</Drillable>
          </span>
        </div>
      ))}
    </div>
  );

  const section = (title: string, s: BsSection, totalLabel: string, testId: string) => (
    <div>
      <div className="px-2 pt-4 pb-1 text-[13px] font-semibold text-text-primary">{title}</div>
      <div className="divide-y divide-border/60">{s.lines.map(line)}</div>
      <div style={cols} className="grid gap-3 items-baseline px-2 py-2 border-t border-border text-[13px] font-semibold" data-testid={testId}>
        <span className="text-text-primary">{totalLabel}</span>
        <FigureCells fig={s.total} money={money} compare={compare} bold />
      </div>
    </div>
  );

  return (
    <LiveReportShell
      title="Balance sheet"
      report="balance-sheet"
      kind="asof"
      selection={selection}
      onChange={set}
      periods={periods}
      descriptor={bs ? `As of ${longDate(bs.asOf)}` : undefined}
      generatedAt={bs?.generatedAt}
      toolbar={bs && <CheckBadge ok={bs.balanced} okLabel="Assets equal liabilities and equity" badLabel={bs.filtered ? 'Filtered: may not balance' : 'Does not balance'} />}
    >
      {!ready || q.isPending ? <ReportLoading what="the balance sheet" /> : q.isError ? <ReportError error={q.error} onRetry={() => void q.refetch()} what="the balance sheet" /> : bs && (
        <ReportCard>
          <div className="min-w-[520px]">
            <div style={cols} className="grid gap-3 px-2 pb-2 border-b border-border text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
              <span>Account</span>
              <span className="text-right">Balance</span>
              {compare && (
                <>
                  <span className="text-right">Compared</span>
                  <span className="text-right">Change</span>
                  <span className="text-right">%</span>
                </>
              )}
            </div>
            <div className="py-1"><NoComparisonNote available={bs.comparison?.available} /></div>
            {section('Assets', bs.assets, 'Total assets', 'bs-total-assets')}
            {section('Liabilities', bs.liabilities, 'Total liabilities', 'bs-total-liabilities')}
            {section('Equity', bs.equity, 'Total equity', 'bs-total-equity')}
            <div style={cols} className="grid gap-3 items-baseline px-2 py-2.5 mt-2 border-t border-text-primary border-b-[3px] border-double text-sm font-semibold" data-testid="bs-total-le">
              <span className="text-text-primary">Total liabilities and equity</span>
              <FigureCells fig={bs.liabilitiesAndEquity} money={money} compare={compare} bold />
            </div>
            {!bs.balanced && (
              <div className="mt-3 flex justify-between px-2 text-xs font-semibold text-danger" role="alert" data-testid="bs-difference">
                <span>Difference (assets less liabilities and equity)</span>
                <span className="tabular-nums">{money(bs.difference)}</span>
              </div>
            )}
            {bs.equity.funds && bs.equity.funds.length > 0 && (
              <div className="mt-6" data-testid="bs-funds">
                <div className="px-2 pb-1 text-[13px] font-semibold text-text-primary">Equity by fund</div>
                <div className="divide-y divide-border/60">
                  {bs.equity.funds.map((f) => (
                    <div key={f.fund?.id ?? 'none'} style={cols} className="grid gap-3 items-baseline px-2 py-1.5 text-xs">
                      <span className="text-text-primary">{fundName(f.fund)}</span>
                      <FigureCells fig={f.total} money={money} compare={compare} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {bs.filtered && <p className="mt-3 px-2 text-xs text-text-muted">Filtered by a dimension: the sheet covers only the lines tagged with it.</p>}
          </div>
        </ReportCard>
      )}
      <DrillDialog target={drill} onClose={() => setDrill(null)} />
    </LiveReportShell>
  );
};
