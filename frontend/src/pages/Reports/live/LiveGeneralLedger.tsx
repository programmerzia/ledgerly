import React from 'react';
import { Link } from 'react-router-dom';
import { useGeneralLedger, useReportAccounts } from '@/data/reports';
import { useRouteCompany } from '@/data/session';
import { cn } from '@/lib/utils';
import { ReportCard, SelectBox, longDate, tone } from '../ReportParts';
import { LiveReportShell } from './LiveReportShell';
import { ReportError, ReportLoading, dash, fmt } from './parts';
import { useReportSelection } from './useSelection';

const TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
const TYPE_LABEL: Record<string, string> = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };
const GRID = 'grid grid-cols-[6.5rem_8rem_1fr_7.5rem_7.5rem_8rem] gap-3';

export const LiveGeneralLedger: React.FC = () => {
  const company = useRouteCompany();
  const { selection, set, periods, ready } = useReportSelection('range');
  const accounts = useReportAccounts();
  const accountId = selection.accountId;
  const q = useGeneralLedger(selection, ready && Boolean(accountId));
  const first = q.data?.pages[0];
  const header = first?.header;
  const lines = q.data?.pages.flatMap((p) => p.data) ?? [];
  const money = fmt(header?.currency ?? company.base_currency);
  const postable = accounts.data ?? [];

  return (
    <LiveReportShell
      title="General ledger"
      report="general-ledger"
      kind="range"
      selection={selection}
      onChange={set}
      periods={periods}
      descriptor={header ? `${header.account.code} ${header.account.name}` : undefined}
      generatedAt={header?.generatedAt}
      exportDisabled={!accountId}
      toolbar={
        <SelectBox aria-label="Account" value={accountId ?? ''} onChange={(e) => set({ ...selection, accountId: e.target.value || undefined })} className="min-w-[16rem]">
          <option value="">{accounts.isPending ? 'Loading…' : 'Choose an account'}</option>
          {TYPE_ORDER.map((t) => (
            <optgroup key={t} label={TYPE_LABEL[t]}>
              {postable.filter((a) => a.type === t).map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
            </optgroup>
          ))}
        </SelectBox>
      }
    >
      {!accountId ? (
        <p className="p-4 text-[13px] text-text-muted">Choose an account to see its transactions.</p>
      ) : !ready || q.isPending ? <ReportLoading what="the ledger" /> : q.isError ? <ReportError error={q.error} onRetry={() => void q.refetch()} what="the general ledger" /> : header && (
        <ReportCard className="p-0 sm:p-0">
          <div className="min-w-[820px]">
            <div className={`${GRID} px-4 py-2.5 border-b border-border text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted`}>
              <span>Date</span><span>Journal</span><span>Description</span>
              <span className="text-right">Debit</span><span className="text-right">Credit</span><span className="text-right">Balance</span>
            </div>
            <div className={`${GRID} items-baseline px-4 py-2 text-xs bg-surface-neutral/50 font-medium`} data-testid="gl-opening">
              <span className="text-text-muted">{header.from ? longDate(header.from) : ''}</span>
              <span className="col-span-4 text-text-primary">Opening balance</span>
              <span className={cn('text-right tabular-nums', tone(header.opening))}>{money(header.opening)}</span>
            </div>
            {lines.length === 0 && <p className="p-8 text-center text-xs text-text-muted">No transactions on this account in this range.</p>}
            <div className="divide-y divide-border/60" data-testid="gl-lines">
              {lines.map((l) => (
                <div key={l.id} className={`${GRID} items-baseline px-4 py-1.5 text-xs`}>
                  <span className="tabular-nums text-text-muted whitespace-nowrap">{l.date}</span>
                  <span>
                    <Link to={`/${company.slug}/journals/${l.journalId}`} className="font-code text-accent hover:underline">{l.journalNumber ?? 'Draft'}</Link>
                  </span>
                  <span className="truncate text-text-primary">{l.description ?? l.memo ?? dash}</span>
                  <span className="text-right tabular-nums">{l.debit ? money(l.debit) : dash}</span>
                  <span className="text-right tabular-nums">{l.credit ? money(l.credit) : dash}</span>
                  <span className={cn('text-right tabular-nums', l.balance === null ? '' : tone(l.balance))}>{l.balance === null ? '' : money(l.balance)}</span>
                </div>
              ))}
            </div>
            {q.hasNextPage && (
              <div className="px-4 py-3 border-t border-border">
                <button type="button" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} className="cursor-pointer text-xs text-accent hover:underline disabled:opacity-60">
                  {q.isFetchingNextPage ? 'Loading…' : `Load more (${lines.length} of ${header.lineCount})`}
                </button>
              </div>
            )}
            <div className={`${GRID} items-baseline px-4 py-3 border-t border-text-primary border-b-[3px] border-double text-[13px] font-semibold`} data-testid="gl-closing">
              <span className="text-text-muted font-normal">{header.to ? longDate(header.to) : ''}</span>
              <span className="col-span-2 text-text-primary">Closing balance · {header.lineCount} lines</span>
              <span className="text-right tabular-nums">{money(header.totalDebit)}</span>
              <span className="text-right tabular-nums">{money(header.totalCredit)}</span>
              <span className={cn('text-right tabular-nums', tone(header.closing))}>{money(header.closing)}</span>
            </div>
          </div>
        </ReportCard>
      )}
    </LiveReportShell>
  );
};
