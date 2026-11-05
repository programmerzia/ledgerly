import React, { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useReport } from '@/data/reports';
import { useRouteCompany } from '@/data/session';
import type { DrillKey, TrialBalanceRow } from '@/api/adapters/report';
import { CheckBadge, ReportCard, SelectBox, longDate } from '../ReportParts';
import { LiveReportShell } from './LiveReportShell';
import { DrillDialog, Drillable, ReportError, ReportLoading, dash, fmt, type DrillTarget } from './parts';
import { useReportSelection } from './useSelection';

const GRID = 'grid grid-cols-[1fr_8rem_8rem] gap-3';
const GRID6 = 'grid grid-cols-[minmax(12rem,1fr)_repeat(6,7rem)] gap-3';
const GROUPS: Record<string, string> = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };

export const LiveTrialBalance: React.FC = () => {
  const company = useRouteCompany();
  const [sp] = useSearchParams();
  const movement = sp.get('view') === 'movement';
  const { selection, set, periods, ready } = useReportSelection(movement ? 'range' : 'asof', true);
  const q = useReport('trial-balance', selection, ready);
  const [drill, setDrill] = useState<DrillTarget | null>(null);
  const tb = q.data;
  const money = fmt(tb?.currency ?? company.base_currency);

  // Rows arrive in account-code order; a heading is drawn where the account type changes. No subtotals: the
  // server gives only the grand totals.
  const grouped: Array<{ type: string; rows: TrialBalanceRow[] }> = [];
  for (const r of tb?.rows ?? []) {
    const type = r.account.accountType ?? 'other';
    const last = grouped[grouped.length - 1];
    if (last && last.type === type) last.rows.push(r);
    else grouped.push({ type, rows: [r] });
  }

  return (
    <LiveReportShell
      title="Trial balance"
      report="trial-balance"
      kind={movement ? 'range' : 'asof'}
      selection={selection}
      onChange={set}
      periods={periods}
      descriptor={tb ? (tb.mode === 'movement' ? `${longDate(tb.from ?? '')} to ${longDate(tb.asOf)}` : `As of ${longDate(tb.asOf)}`) : undefined}
      generatedAt={tb?.generatedAt}
      toolbar={
        <>
          <SelectBox aria-label="Columns" value={movement ? 'movement' : 'balances'} onChange={(e) => set({ ...selection, view: e.target.value === 'movement' ? 'movement' : undefined })}>
            <option value="balances">Balances as of a date</option>
            <option value="movement">Opening, movement and closing</option>
          </SelectBox>
          {tb && (
          <CheckBadge
            ok={tb.balanced}
            okLabel="Debits equal credits"
            badLabel={tb.filtered ? 'Filtered: debits and credits may differ' : 'Debits and credits do not agree'}
          />
          )}
        </>
      }
    >
      {!ready || q.isPending ? <ReportLoading what="the trial balance" /> : q.isError ? <ReportError error={q.error} onRetry={() => void q.refetch()} what="the trial balance" /> : tb && tb.mode === 'movement' && tb.totals ? (
        <ReportCard>
          <div className="min-w-[860px]" data-testid="tb-movement">
            <div className={`${GRID6} px-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted`}>
              <span />
              <span className="col-span-2 text-center">Opening{tb.openingAsOf ? ` (${longDate(tb.openingAsOf)})` : ''}</span>
              <span className="col-span-2 text-center">Movement</span>
              <span className="col-span-2 text-center">Closing</span>
            </div>
            <div className={`${GRID6} px-2 pb-2 border-b border-border text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted`}>
              <span>Account</span>
              {['Debit', 'Credit', 'Debit', 'Credit', 'Debit', 'Credit'].map((h, i) => <span key={i} className="text-right">{h}</span>)}
            </div>
            {tb.rows.length === 0 && <p className="p-8 text-center text-xs text-text-muted">No balances or movement in this range.</p>}
            <div className="divide-y divide-border/60">
              {tb.rows.map((r) => {
                const cell = (v: number, drill: DrillKey | undefined) => (v === 0 ? dash : <Drillable drill={drill} onDrill={(key) => setDrill({ key, title: r.account.name })}>{money(v)}</Drillable>);
                return (
                  <div key={r.account.id} className={`${GRID6} items-baseline px-2 py-1.5 text-xs`}>
                    <span className="text-text-primary"><span className="font-code text-text-muted mr-2">{r.account.code}</span>{r.account.name}</span>
                    <span className="text-right">{cell(r.opening?.debit ?? 0, r.drills?.opening)}</span>
                    <span className="text-right">{cell(r.opening?.credit ?? 0, r.drills?.opening)}</span>
                    <span className="text-right">{cell(r.movement?.debit ?? 0, r.drills?.movement)}</span>
                    <span className="text-right">{cell(r.movement?.credit ?? 0, r.drills?.movement)}</span>
                    <span className="text-right">{cell(r.closing?.debit ?? 0, r.drills?.closing)}</span>
                    <span className="text-right">{cell(r.closing?.credit ?? 0, r.drills?.closing)}</span>
                  </div>
                );
              })}
            </div>
            <div className={`${GRID6} items-baseline px-2 py-3 mt-2 border-t border-text-primary border-b-[3px] border-double text-sm font-semibold tabular-nums`} data-testid="tb-totals">
              <span className="text-text-primary">Total</span>
              {[tb.totals.opening.debit, tb.totals.opening.credit, tb.totals.movement.debit, tb.totals.movement.credit, tb.totals.closing.debit, tb.totals.closing.credit].map((v, i) => (
                <span key={i} className="text-right">{money(v)}</span>
              ))}
            </div>
            <p className="mt-3 px-2 text-xs text-text-muted">Opening plus movement equals closing for every account. Year-end closing journals are included, as in the as-of trial balance.</p>
            {tb.filtered && <p className="mt-2 px-2 text-xs text-text-muted">A dimension filter selects part of each journal, so debits and credits can differ here without anything being wrong.</p>}
          </div>
        </ReportCard>
      ) : tb && (
        <ReportCard>
          <div className="min-w-[520px]">
            <div className={`${GRID} px-2 pb-2 border-b border-border text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted`}>
              <span>Account</span>
              <span className="text-right">Debit</span>
              <span className="text-right">Credit</span>
            </div>
            {tb.rows.length === 0 && <p className="p-8 text-center text-xs text-text-muted">No balances as of this date.</p>}
            {grouped.map((g) => (
              <div key={g.type}>
                <div className="px-2 pt-4 pb-1 text-[13px] font-semibold text-text-primary">{GROUPS[g.type] ?? g.type}</div>
                <div className="divide-y divide-border/60">
                  {g.rows.map((r) => (
                    <div key={r.account.id} className={`${GRID} items-baseline px-2 py-1.5 text-xs`}>
                      <span className="text-text-primary">
                        <span className="font-code text-text-muted mr-2">{r.account.code}</span>
                        {r.account.name}
                      </span>
                      <span className="text-right text-text-primary">
                        {r.debit === 0 ? dash : <Drillable drill={r.drill} onDrill={(key) => setDrill({ key, title: r.account.name })}>{money(r.debit)}</Drillable>}
                      </span>
                      <span className="text-right text-text-primary">
                        {r.credit === 0 ? dash : <Drillable drill={r.drill} onDrill={(key) => setDrill({ key, title: r.account.name })}>{money(r.credit)}</Drillable>}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <div className={`${GRID} items-baseline px-2 py-3 mt-2 border-t border-text-primary border-b-[3px] border-double text-sm font-semibold`} data-testid="tb-totals">
              <span className="text-text-primary">Total</span>
              <span className="text-right tabular-nums">{money(tb.totalDebit)}</span>
              <span className="text-right tabular-nums">{money(tb.totalCredit)}</span>
            </div>
            {tb.filtered && (
              <p className="mt-3 px-2 text-xs text-text-muted">
                A dimension filter selects part of each journal, so debits and credits can differ here without anything being wrong.
              </p>
            )}
          </div>
        </ReportCard>
      )}
      <DrillDialog target={drill} onClose={() => setDrill(null)} />
    </LiveReportShell>
  );
};
