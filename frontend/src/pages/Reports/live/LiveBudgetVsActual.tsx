import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BudgetFigure } from '@/api/adapters/report';
import { currentPeriod } from '@/api/adapters/reportSelection';
import { localDateISO } from '@/api/adapters/onboarding';
import { useReport } from '@/data/reports';
import { useBudgets } from '@/data/budgets';
import { useRouteCompany } from '@/data/session';
import { cn } from '@/lib/utils';
import { ReportCard, SelectBox, longDate } from '../ReportParts';
import { LiveReportShell } from './LiveReportShell';
import { DrillDialog, Drillable, ReportError, ReportLoading, fmt, type DrillTarget } from './parts';
import { useReportSelection } from './useSelection';

const cols = { gridTemplateColumns: 'minmax(12rem,1fr) 8rem 8rem 8rem 5rem 6.5rem' };
const SUBTOTALS = { grossProfit: 'Gross profit', operatingProfit: 'Operating profit', netProfit: 'Net profit' } as const;

/** Favourable or adverse is stated in words as well as colour. */
const Result: React.FC<{ fig: BudgetFigure }> = ({ fig }) =>
  fig.favourable === null ? <span className="text-text-muted">On budget</span> : (
    <span className={fig.favourable ? 'text-success' : 'text-danger'} data-result={fig.favourable ? 'favourable' : 'adverse'}>{fig.favourable ? 'Favourable' : 'Adverse'}</span>
  );

export const LiveBudgetVsActual: React.FC = () => {
  const company = useRouteCompany();
  const { selection, set, periods, ready } = useReportSelection('range', false);
  const budgets = useBudgets();
  const onePeriod = selection.when.kind === 'period';
  // The report is read for one period: start on the current one, once, unless the address already says otherwise.
  const started = useRef(false);
  useEffect(() => {
    if (started.current || !ready) return;
    started.current = true;
    const here = currentPeriod(periods, localDateISO());
    if (selection.when.kind !== 'period' && here && !new URLSearchParams(window.location.search).has('to')) set({ ...selection, when: { kind: 'period', periodId: here.id } });
  }, [ready, periods, selection, set]);
  const q = useReport('budget-vs-actual', selection, ready && onePeriod);
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const r = q.data;
  const money = fmt(r?.currency ?? company.base_currency);
  const pct = (f: BudgetFigure) => (f.variancePct === null ? '—' : `${f.variancePct}%`);

  const row = (label: React.ReactNode, f: BudgetFigure, opts: { bold?: boolean; drill?: DrillTarget['key']; title?: string; testid?: string }) => (
    <div key={opts.testid ?? String(label)} style={cols} data-testid={opts.testid} className={cn('grid items-baseline gap-3 px-2 py-1.5 text-[13px]', opts.bold && 'border-t border-border font-semibold')}>
      <span className="text-text-primary">{label}</span>
      <span className="text-right tabular-nums text-text-secondary">{money(f.budget)}</span>
      <span className="text-right tabular-nums">
        <Drillable drill={opts.drill} onDrill={(key) => setDrill({ key, title: opts.title ?? 'Transactions' })}>{money(f.actual)}</Drillable>
      </span>
      <span className={cn('text-right tabular-nums', f.favourable === null ? 'text-text-muted' : f.favourable ? 'text-success' : 'text-danger')}>{money(f.variance)}</span>
      <span className="text-right tabular-nums text-text-muted">{pct(f)}</span>
      <Result fig={f} />
    </div>
  );

  return (
    <LiveReportShell
      title="Budget vs actual"
      report="budget-vs-actual"
      kind="range"
      selection={selection}
      onChange={set}
      periods={periods}
      descriptor={r ? `${longDate(r.from)} to ${longDate(r.to)} · ${r.budget.name}, version ${r.budget.revision} (${r.budget.status})` : undefined}
      generatedAt={r?.generatedAt}
      toolbar={
        <SelectBox aria-label="Budget version" value={selection.budgetId ?? ''} onChange={(e) => set({ ...selection, budgetId: e.target.value || undefined })}>
          <option value="">Approved version</option>
          {(budgets.data ?? []).map((b) => <option key={b.id} value={b.id}>{b.fiscal_year?.name} · {b.name} (v{b.revision}, {b.status})</option>)}
        </SelectBox>
      }
      exportDisabled={!onePeriod}
    >
      {!onePeriod ? (
        <p role="status" className="rounded-lg border border-border bg-surface p-4 text-[13px] text-text-secondary">Budget vs actual is read for one period: choose a period above, then this month only or the year to date.</p>
      ) : !ready || q.isPending ? <ReportLoading what="budget vs actual" /> : q.isError ? (
        <ReportError error={q.error} onRetry={() => void q.refetch()} what="the budget vs actual report" />
      ) : r && (
        <ReportCard>
          <div className="min-w-[640px]">
            <div style={cols} className="grid gap-3 border-b border-border px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
              <span>Account</span><span className="text-right">Budget</span><span className="text-right">Actual</span><span className="text-right">Variance</span><span className="text-right">%</span><span>Result</span>
            </div>
            {r.sections.filter((s) => s.lines.length > 0).map((s) => (
              <div key={s.key} data-section={s.key} className="mb-3">
                <div className="px-2 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">{s.title}</div>
                {s.lines.map((l) => row(<><span className="font-mono text-xs text-text-muted">{l.account.code}</span> {l.account.name}</>, l, { drill: l.drill, title: `${l.account.code} ${l.account.name}`, testid: `bva-${l.account.code}` }))}
                {row(`Total ${s.title.toLowerCase()}`, s.total, { bold: true, testid: `bva-total-${s.key}` })}
              </div>
            ))}
            {(Object.keys(SUBTOTALS) as Array<keyof typeof SUBTOTALS>).map((k) => row(SUBTOTALS[k], r[k], { bold: true, testid: `bva-${k}` }))}
            {r.sections.every((s) => s.lines.length === 0) && <p className="px-2 py-6 text-center text-[13px] text-text-muted">No budget amounts or postings in this range.</p>}
          </div>
          <p className="mt-3 text-xs text-text-muted">
            Variance is actual minus budget. More income than planned is favourable; more spending is adverse. Actuals leave out year-end closing entries.{' '}
            <Link to={`/${company.slug}/budgets?v=${r.budget.id}`} className="text-accent hover:underline">Open this budget</Link>
          </p>
        </ReportCard>
      )}
      <DrillDialog target={drill} onClose={() => setDrill(null)} />
    </LiveReportShell>
  );
};
