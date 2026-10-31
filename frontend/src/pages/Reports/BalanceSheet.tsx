import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { ReportShell, defaultReportParameters, useSelectedPeriod, type ReportParameters } from './ReportShell';
import { CheckBadge, CheckToggle, ReportCard, SectionTitle, TotalLine, moneyFmt, tone, longDate } from './ReportParts';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { Account } from '@/types';

interface Row {
  acc: Account;
  total: number;
  split: number[];
}

export const BalanceSheet: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, accounts, balanceOf, dimensions } = useLedgerStore();
  const cur = currentCompany.base_currency;
  const money = moneyFmt(cur);
  const [parameters, setParameters] = useState<ReportParameters>(defaultReportParameters());
  const [splitBranch, setSplitBranch] = useState(false);
  const period = useSelectedPeriod(parameters.periodTo);
  const asOf = period?.ends_on;

  const branches = useMemo(
    () => (dimensions.find((d) => d.code === 'branch')?.values ?? []).filter((v) => v.is_active),
    [dimensions]
  );
  const cols = splitBranch ? branches : [];

  // Signed so every line reads as a positive balance in its own section (contra accounts come out negative).
  const signed = (a: Account, branch?: string) => {
    const bal = balanceOf(a.id, asOf, branch ? { branch } : undefined);
    const naturalSide = a.account_type === 'asset' ? 'debit' : 'credit';
    return a.normal_balance === naturalSide ? bal : -bal;
  };

  const buildRows = (type: Account['account_type']): Row[] =>
    accounts
      .filter((a) => a.account_type === type)
      .map((acc) => ({ acc, total: signed(acc), split: cols.map((c) => signed(acc, c.code)) }))
      .filter((r) => !parameters.hideZeroRows || r.total !== 0)
      .sort((a, b) => a.acc.code.localeCompare(b.acc.code));

  const assets = buildRows('asset');
  const liabilities = buildRows('liability');
  const equity = buildRows('equity');

  const earningsFor = (branch?: string) => {
    const sum = (type: Account['account_type']) =>
      accounts
        .filter((a) => a.account_type === type)
        .reduce((s, a) => s + balanceOf(a.id, asOf, branch ? { branch } : undefined), 0);
    return sum('income') - sum('expense');
  };
  const earnings = earningsFor();
  const earningsSplit = cols.map((c) => earningsFor(c.code));

  const sum = (rows: Row[]) => rows.reduce((s, r) => s + r.total, 0);
  const sumSplit = (rows: Row[], i: number) => rows.reduce((s, r) => s + r.split[i], 0);
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = sum(equity) + earnings;
  const diff = totalAssets - (totalLiabilities + totalEquity);
  const balanced = diff === 0;

  const gridStyle = { gridTemplateColumns: splitBranch ? `1fr repeat(${cols.length}, 6.5rem) 7.5rem` : '1fr 8rem' };
  const go = (code: string) => navigate(`/${currentCompany.slug}/reports/general-ledger?account=${code}`);

  const Line: React.FC<{ code?: string; label: string; total: number; split: number[]; onClick?: () => void; bold?: boolean }> = ({
    code,
    label,
    total,
    split,
    onClick,
    bold,
  }) => (
    <div
      style={gridStyle}
      role={onClick ? 'link' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}
      title={onClick ? 'View transactions' : undefined}
      className={cn(
        'grid gap-3 items-baseline px-2 py-1.5 text-xs group',
        onClick && 'cursor-pointer hover:bg-canvas rounded-md focus-visible:outline-2 outline-accent'
      )}
    >
      <span className={cn('text-text-primary', onClick && 'group-hover:text-accent group-hover:underline')}>
        {code && <span className="font-code text-text-muted mr-2">{code}</span>}
        {label}
      </span>
      {split.map((v, i) => (
        <span key={i} className={cn('text-right tabular-nums text-text-secondary', tone(v))}>{money(v)}</span>
      ))}
      <span className={cn('text-right tabular-nums', bold && 'font-semibold', tone(total))}>{money(total)}</span>
    </div>
  );

  const Total: React.FC<{ label: string; total: number; split: number[]; big?: boolean }> = ({ label, total, split, big }) => (
    <div
      style={gridStyle}
      className={cn(
        'grid gap-3 items-baseline px-2 border-t border-border font-semibold',
        big ? 'text-sm border-t border-text-primary border-b-[3px] border-double py-2.5 mt-1' : 'text-[13px] py-2'
      )}
    >
      <span className="text-text-primary">{label}</span>
      {split.map((v, i) => (
        <span key={i} className={cn('text-right tabular-nums', tone(v))}>{money(v)}</span>
      ))}
      <span className={cn('text-right tabular-nums', tone(total))}>{money(total)}</span>
    </div>
  );

  const Section: React.FC<{ title: string; rows: Row[]; extra?: React.ReactNode; total: number; totalSplit: number[]; big?: boolean }> = ({
    title,
    rows,
    extra,
    total,
    totalSplit,
    big,
  }) => (
    <div className="flex flex-col">
      <SectionTitle>{title}</SectionTitle>
      <div className="divide-y divide-border/60">
        {rows.map((r) => (
          <Line key={r.acc.id} code={r.acc.code} label={r.acc.name} total={r.total} split={r.split} onClick={() => go(r.acc.code)} />
        ))}
        {extra}
      </div>
      <Total big={big} label={`Total ${title.toLowerCase()}`} total={total} split={totalSplit} />
    </div>
  );

  const idx = cols.map((_, i) => i);

  return (
    <ReportShell
      title="Balance sheet"
      asOfMode
      parameters={parameters}
      onParametersChange={setParameters}
      toolbar={
        <>
          <CheckToggle checked={splitBranch} onChange={setSplitBranch} title="Show a column for each branch">
            Split by branch
          </CheckToggle>
          <CheckBadge
            ok={balanced}
            okLabel="Assets = Liabilities + Equity"
            badLabel={`Out of balance by ${money(Math.abs(diff))}`}
          />
        </>
      }
    >
      <ReportCard>
        <div className="min-w-[520px]">
          <div style={gridStyle} className="grid gap-3 px-2 pb-2 border-b border-border text-[11px] font-semibold text-text-muted">
            <span>Account</span>
            {cols.map((c) => (
              <span key={c.id} className="text-right">{c.name}</span>
            ))}
            <span className="text-right">{period ? longDate(period.ends_on) : ''}</span>
          </div>

          <Section big title="Assets" rows={assets} total={totalAssets} totalSplit={idx.map((i) => sumSplit(assets, i))} />
          <Section title="Liabilities" rows={liabilities} total={totalLiabilities} totalSplit={idx.map((i) => sumSplit(liabilities, i))} />
          <Section
            title="Equity"
            rows={equity}
            extra={
              <Line
                label="Current year earnings"
                total={earnings}
                split={earningsSplit}
                onClick={() => navigate(`/${currentCompany.slug}/reports/profit-and-loss`)}
              />
            }
            total={totalEquity}
            totalSplit={idx.map((i) => sumSplit(equity, i) + earningsSplit[i])}
          />

          <Total big label="Liabilities + Equity" total={totalLiabilities + totalEquity} split={idx.map((i) => sumSplit(liabilities, i) + sumSplit(equity, i) + earningsSplit[i])} />
          {!balanced && (
            <div className="mt-3 flex items-baseline justify-between px-2 text-xs font-semibold text-danger" role="alert">
              <span>Difference (Assets less Liabilities + Equity)</span>
              <span className="tabular-nums">{formatMoney(diff, cur, { parenthesesNegative: true })}</span>
            </div>
          )}
        </div>
      </ReportCard>
    </ReportShell>
  );
};
