import React, { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { useLedgerStore } from '@/mock/store';
import { BUSINESS_TODAY } from '@/lib/docStatus';
import { formatMoney } from '@/lib/format';
import { ReportShell, defaultReportParameters, type ReportParameters } from './ReportShell';
import { ReportCard, SelectBox, moneyFmt, tone, longDate } from './ReportParts';
import { cn } from '@/lib/utils';

const TYPE_ORDER = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
const TYPE_LABEL: Record<string, string> = { asset: 'Assets', liability: 'Liabilities', equity: 'Equity', income: 'Income', expense: 'Expenses' };
const GRID = 'grid grid-cols-[6.5rem_13rem_1fr_6.5rem_7.5rem_7.5rem_8rem] gap-3';

const dateInput =
  'h-8 px-2 rounded-lg border border-border bg-surface text-xs text-text-primary hover:border-border-strong focus:outline-none focus:border-accent';

const dayBefore = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

export const GeneralLedger: React.FC = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const { currentCompany, accounts, movements, balanceOf, journals, fiscalYear } = useLedgerStore();
  const cur = currentCompany.base_currency;
  const money = moneyFmt(cur);
  const slug = currentCompany.slug;
  const [parameters, setParameters] = useState<ReportParameters>(defaultReportParameters('per-2026-10', 'detailed'));
  const [from, setFrom] = useState(fiscalYear.starts_on);
  const [to, setTo] = useState(BUSINESS_TODAY);

  const sorted = useMemo(() => [...accounts].sort((a, b) => a.code.localeCompare(b.code)), [accounts]);
  const code = search.get('account');
  const account = sorted.find((a) => a.code === code) ?? sorted.find((a) => a.code === '1010') ?? sorted[0];

  const byNumber = useMemo(() => new Map(journals.map((j) => [j.number, j])), [journals]);

  const { opening, lines, closing } = useMemo(() => {
    if (!account) return { opening: 0, lines: [] as ReturnType<typeof movements>, closing: 0 };
    const opening = balanceOf(account.id, dayBefore(from));
    const lines = movements(account.id, { from, to }).map((l) => ({ ...l, running_balance: l.running_balance + opening }));
    return { opening, lines, closing: lines.length ? lines[lines.length - 1].running_balance : opening };
  }, [account, from, to, movements, balanceOf, journals]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!account) return null;

  const sourceLink = (num: string): { label: string; to: string } => {
    const j = byNumber.get(num);
    if (j?.source_type === 'sales_invoice' && j.source_id) return { label: 'Invoice', to: `/${slug}/invoices/${j.source_id}` };
    if (j?.source_type === 'purchase_bill' && j.source_id) return { label: 'Bill', to: `/${slug}/bills/${j.source_id}` };
    return { label: 'Journal', to: j ? `/${slug}/journals/${j.id}` : `/${slug}/journals` };
  };

  const totalDr = lines.reduce((s, l) => s + l.debit, 0);
  const totalCr = lines.reduce((s, l) => s + l.credit, 0);

  return (
    <ReportShell
      title="General ledger"
      subtitle={`${account.code} ${account.name} · ${longDate(from)} – ${longDate(to)}`}
      parameters={parameters}
      onParametersChange={setParameters}
      hidePeriod
      showHideEmpty={false}
      toolbar={
        <>
          <SelectBox
            aria-label="Account"
            value={account.code}
            onChange={(e) => setSearch({ account: e.target.value }, { replace: true })}
            className="min-w-[16rem]"
          >
            {TYPE_ORDER.map((t) => (
              <optgroup key={t} label={TYPE_LABEL[t]}>
                {sorted
                  .filter((a) => a.account_type === t)
                  .map((a) => (
                    <option key={a.id} value={a.code}>
                      {a.code} · {a.name}
                    </option>
                  ))}
              </optgroup>
            ))}
          </SelectBox>
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <input type="date" aria-label="From" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className={dateInput} />
            to
            <input type="date" aria-label="To" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className={dateInput} />
          </span>
        </>
      }
    >
      <ReportCard className="p-0 sm:p-0">
        <div className="min-w-[860px]">
          <div className={`${GRID} px-4 py-2.5 border-b border-border text-[11px] font-semibold text-text-muted sticky top-0 bg-surface`}>
            <span>Date</span>
            <span>Source</span>
            <span>Description</span>
            <span>Branch</span>
            <span className="text-right">Debit</span>
            <span className="text-right">Credit</span>
            <span className="text-right">Balance</span>
          </div>

          <div className={`${GRID} items-baseline px-4 py-2 text-xs bg-surface-neutral/50 font-medium`}>
            <span className="text-text-muted">{longDate(from)}</span>
            <span className="col-span-5 text-text-primary">Opening balance</span>
            <span className={cn('text-right tabular-nums', tone(opening))}>{money(opening)}</span>
          </div>

          {lines.length === 0 && <div className="p-8 text-center text-xs text-text-muted">No transactions on this account in this date range.</div>}
          <div className="divide-y divide-border/60">
            {lines.map((l) => {
              const src = sourceLink(l.journal_number);
              return (
                <div
                  key={`${l.journal_number}-${l.id}`}
                  role="link"
                  tabIndex={0}
                  onClick={() => navigate(src.to)}
                  onKeyDown={(e) => e.key === 'Enter' && navigate(src.to)}
                  className={`${GRID} items-baseline px-4 py-1.5 text-xs cursor-pointer hover:bg-canvas group focus-visible:outline-2 outline-accent`}
                >
                  <span className="tabular-nums text-text-muted whitespace-nowrap">{l.journal_date}</span>
                  <span className="flex items-center gap-1.5 whitespace-nowrap text-accent group-hover:underline">
                    <span className="text-text-muted no-underline">{src.label}</span>
                    <span className="font-code">{l.journal_number}</span>
                    <ArrowUpRight className="size-3 opacity-0 group-hover:opacity-100" />
                  </span>
                  <span className="truncate text-text-primary">{l.description || '—'}</span>
                  <span className="text-text-muted">{l.dimensions?.branch ?? '—'}</span>
                  <span className="text-right tabular-nums text-text-primary">{l.debit > 0 ? money(l.debit) : '—'}</span>
                  <span className="text-right tabular-nums text-text-primary">{l.credit > 0 ? money(l.credit) : '—'}</span>
                  <span className={cn('text-right tabular-nums', tone(l.running_balance))}>{money(l.running_balance)}</span>
                </div>
              );
            })}
          </div>

          <div className={`${GRID} items-baseline px-4 py-3 border-t border-text-primary border-b-[3px] border-double text-[13px] font-semibold`}>
            <span className="text-text-muted font-normal">{longDate(to)}</span>
            <span className="col-span-3 text-text-primary">Closing balance</span>
            <span className="text-right tabular-nums">{money(totalDr)}</span>
            <span className="text-right tabular-nums">{money(totalCr)}</span>
            <span className={cn('text-right tabular-nums', tone(closing))}>{formatMoney(closing, cur, { parenthesesNegative: true })}</span>
          </div>
        </div>
      </ReportCard>
    </ReportShell>
  );
};
