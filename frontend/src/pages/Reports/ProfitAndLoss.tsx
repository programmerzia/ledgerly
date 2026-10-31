import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { formatMoney } from '@/lib/format';
import { BUSINESS_TODAY } from '@/lib/docStatus';
import { Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import type { Account } from '@/types';

interface Line {
  account: Account;
  /** Signed for presentation: positive adds to profit, negative reduces it. */
  current: number;
  previous: number;
}

interface Section {
  key: string;
  title: string;
  lines: Line[];
  /** -1 shows costs as positive amounts; profit lines are still computed from signed values. */
  flip: 1 | -1;
}

const pct = (variance: number, base: number): string =>
  base === 0 ? '—' : `${((variance / Math.abs(base)) * 100).toFixed(1)}%`;

export const ProfitAndLoss: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, accounts, periods, balanceOf, journals, fiscalYear } = useLedgerStore();
  const cur = currentCompany.base_currency;

  const selectable = useMemo(
    () => periods.filter((p) => p.kind === 'regular' && p.starts_on <= BUSINESS_TODAY),
    [periods]
  );
  const [periodId, setPeriodId] = useState<string>(
    () => selectable[selectable.length - 1]?.id ?? ''
  );
  const [compare, setCompare] = useState(true);
  const [basis, setBasis] = useState<'month' | 'ytd'>('month');

  const period = selectable.find((p) => p.id === periodId) ?? selectable[selectable.length - 1];
  const regularBefore = (n: number) => periods.find((p) => p.kind === 'regular' && p.number === n - 1);
  const prevPeriod = period ? regularBefore(period.number) : undefined;
  const prevPrevPeriod = prevPeriod ? regularBefore(prevPeriod.number) : undefined;
  // Day before the fiscal year starts: the opening point for the first month.
  const dayBeforeFy = (() => {
    const d = new Date(`${fiscalYear.starts_on}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  })();
  const isMonth = basis === 'month';
  // Month mode compares month vs previous month, which needs a month before that; YTD has no prior year.
  const canCompare = Boolean(prevPeriod) && (!isMonth || Boolean(prevPrevPeriod)) && isMonth;
  const compareDisabledReason = !isMonth
    ? 'No prior-year data'
    : !prevPeriod || !prevPrevPeriod
    ? 'No earlier month to compare with'
    : undefined;
  const showCompare = compare && canCompare;
  const fyStartLabel = new Date(`${fiscalYear.starts_on}T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const periodMonth = period ? new Date(`${period.starts_on}T00:00:00Z`).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }) : '';
  const monthLong = period ? new Date(`${period.starts_on}T00:00:00Z`).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : '';
  const periodMonthShort = period ? new Date(`${period.starts_on}T00:00:00Z`).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }) : '';

  const { sections, subtotals } = useMemo(() => {
    // Balances are cumulative to the period end, the same basis as the previous report version.
    const asOf = period?.ends_on;
    const prevAsOf = prevPeriod?.ends_on;
    const movement = (id: string, end?: string, start?: string) =>
      start === undefined ? balanceOf(id, end) : balanceOf(id, end) - balanceOf(id, start);
    // Month: movement inside the period. YTD: cumulative to the period end.
    const curStart = isMonth ? prevAsOf ?? dayBeforeFy : undefined;
    const prevStart = isMonth ? prevPrevPeriod?.ends_on : undefined;
    const isOther = (a: Account) => a.account_subtype === 'Other Income' || a.account_subtype === 'Other Expense';

    const toLine = (a: Account): Line => {
      const sign = a.account_type === 'income' ? 1 : -1;
      return {
        account: a,
        current: sign * movement(a.id, asOf, curStart),
        previous: showCompare && prevAsOf ? sign * movement(a.id, prevAsOf, prevStart) : 0,
      };
    };
    const live = (l: Line) => l.current !== 0 || (showCompare && l.previous !== 0);
    const byCode = (x: Line, y: Line) => x.account.code.localeCompare(y.account.code);

    const rows = accounts
      .filter((a) => a.account_type === 'income' || a.account_type === 'expense')
      .map(toLine)
      .filter(live)
      .sort(byCode);

    const revenue = rows.filter((l) => l.account.account_type === 'income' && !isOther(l.account));
    const cogs = rows.filter((l) => l.account.account_type === 'expense' && l.account.account_subtype === 'Direct Costs');
    const opex = rows.filter(
      (l) => l.account.account_type === 'expense' && l.account.account_subtype !== 'Direct Costs' && !isOther(l.account)
    );
    const other = rows.filter((l) => isOther(l.account));

    const sum = (ls: Line[]) => ({
      current: ls.reduce((s, l) => s + l.current, 0),
      previous: ls.reduce((s, l) => s + l.previous, 0),
    });
    const add = (...xs: { current: number; previous: number }[]) => ({
      current: xs.reduce((s, x) => s + x.current, 0),
      previous: xs.reduce((s, x) => s + x.previous, 0),
    });

    const rev = sum(revenue);
    const cost = sum(cogs);
    const ope = sum(opex);
    const oth = sum(other);
    const gross = add(rev, cost);
    const operating = add(gross, ope);
    const net = add(operating, oth);

    return {
      sections: [
        { key: 'revenue', title: 'Revenue', lines: revenue, flip: 1 },
        { key: 'cogs', title: 'Cost of sales', lines: cogs, flip: -1 },
        { key: 'opex', title: 'Operating expenses', lines: opex, flip: -1 },
        { key: 'other', title: 'Other income and expenses', lines: other, flip: 1 },
      ] as Section[],
      subtotals: { revenue: rev, cogs: cost, opex: ope, other: oth, gross, operating, net },
    };
  }, [accounts, journals, balanceOf, period, prevPeriod, prevPrevPeriod, showCompare, isMonth, dayBeforeFy]);

  const cols = showCompare ? 'grid-cols-[1fr_7rem_7rem_7rem_4.5rem]' : 'grid-cols-[1fr_8rem]';
  const money = (n: number) => formatMoney(n, cur, { parenthesesNegative: true });
  const tone = (n: number) => (n < 0 ? 'text-danger' : 'text-text-primary');

  const Cells: React.FC<{ cur: number; prev: number; strong?: boolean; colored?: boolean }> = ({
    cur: c,
    prev,
    strong,
    colored,
  }) => (
    <>
      <span className={`text-right tabular-nums ${strong ? 'font-semibold' : ''} ${colored ? tone(c) : 'text-text-primary'}`}>
        {money(c)}
      </span>
      {showCompare && (
        <>
          <span className="text-right tabular-nums text-text-secondary">{money(prev)}</span>
          <span className={`text-right tabular-nums ${colored ? tone(c - prev) : 'text-text-secondary'}`}>
            {money(c - prev)}
          </span>
          <span className="text-right tabular-nums text-text-muted">{pct(c - prev, prev)}</span>
        </>
      )}
    </>
  );

  const TotalRow: React.FC<{ label: string; t: { current: number; previous: number }; note?: string; big?: boolean; final?: boolean }> = ({
    label,
    t,
    note,
    big,
    final,
  }) => (
    <div
      className={`grid ${cols} gap-3 items-baseline px-2 py-2 border-t border-border font-semibold ${
        final ? 'text-sm border-t border-text-primary border-b-[3px] border-double py-2.5' : big ? 'text-sm border-text-primary py-2.5' : 'text-xs'
      }`}
    >
      <span className="text-text-primary">
        {label}
        {note && <span className="ml-2 font-normal text-text-muted">{note}</span>}
      </span>
      <Cells cur={t.current} prev={t.previous} strong colored={big} />
    </div>
  );

  const grossMargin = subtotals.revenue.current === 0 ? null : (subtotals.gross.current / subtotals.revenue.current) * 100;
  const sectionTotal = (k: string) => subtotals[k as 'revenue' | 'cogs' | 'opex' | 'other'];

  if (!period) {
    return <div className="p-8 text-center text-xs text-text-muted">No periods available.</div>;
  }

  const renderSection = (s: Section) => (
    <div key={s.key} className="flex flex-col">
      <div className="px-2 pb-1 pt-3 text-xs font-semibold text-text-primary">{s.title}</div>
      {s.lines.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-text-muted">No activity</div>
      ) : (
        <div className="divide-y divide-border/60 text-xs">
          {s.lines.map((l) => (
            <div
              key={l.account.id}
              role="link"
              tabIndex={0}
              onClick={() => navigate(`/${currentCompany.slug}/reports/general-ledger?account=${l.account.code}`)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') navigate(`/${currentCompany.slug}/reports/general-ledger?account=${l.account.code}`);
              }}
              title="View transactions"
              className={`grid ${cols} gap-3 items-baseline px-2 py-1.5 hover:bg-surface-neutral cursor-pointer group`}
            >
              <span className="text-text-primary group-hover:text-accent group-hover:underline">
                <span className="font-code text-text-muted mr-2">{l.account.code}</span>
                {l.account.name}
              </span>
              <Cells cur={l.current * s.flip} prev={l.previous * s.flip} />
            </div>
          ))}
        </div>
      )}
      <TotalRow
        label={`Total ${s.title.toLowerCase()}`}
        t={{
          current: sectionTotal(s.key).current * s.flip,
          previous: sectionTotal(s.key).previous * s.flip,
        }}
      />
    </div>
  );

  const [revenue, cogs, opex, other] = sections;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Profit and loss</h1>
          <p className="text-xs text-text-muted mt-0.5">
            {currentCompany.name} · {isMonth ? monthLong : `Year to date · ${fyStartLabel}–${periodMonthShort} ${period.ends_on.slice(0, 4)}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <select
            aria-label="Period"
            value={period.id}
            onChange={(e) => setPeriodId(e.target.value)}
            className="h-8 px-2 rounded-md border border-border bg-surface text-xs text-text-primary focus:outline-none focus:border-accent"
          >
            {selectable.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="flex rounded-md border border-border overflow-hidden text-xs" role="group" aria-label="Basis">
            {(['month', 'ytd'] as const).map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBasis(b)}
                className={`h-8 px-2.5 cursor-pointer ${basis === b ? 'bg-surface-neutral text-text-primary font-medium' : 'bg-surface text-text-secondary hover:bg-surface-neutral'}`}
              >
                {b === 'month' ? 'Month' : 'Year to date'}
              </button>
            ))}
          </div>
          <label
            title={compareDisabledReason}
            className={`flex items-center gap-2 text-xs select-none ${canCompare ? 'cursor-pointer text-text-primary' : 'text-text-muted'}`}
          >
            <input
              type="checkbox"
              checked={showCompare}
              disabled={!canCompare}
              onChange={(e) => setCompare(e.target.checked)}
              className="rounded border-border text-accent focus:ring-accent"
            />
            Compare to previous period
          </label>
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border hover:bg-surface-neutral bg-surface text-text-primary text-[13px] font-medium transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print</span>
          </button>
          <button
            type="button"
            onClick={() => toast.success('Profit and loss exported')}
            className="flex items-center gap-1.5 h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded-md text-[13px] font-medium transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>
        </div>
      </div>

      <div className="bg-surface border border-border rounded-lg p-4 sm:p-6 w-full overflow-x-auto">
        <div className="min-w-[520px]">
          <div className={`grid ${cols} gap-3 px-2 pb-2 border-b border-border text-[11px] font-semibold text-text-muted`}>
            <span>Account</span>
            <span className="text-right">{isMonth ? periodMonth : `YTD ${periodMonthShort}`}</span>
            {showCompare && prevPeriod && (
              <>
                <span className="text-right">{prevPeriod.name}</span>
                <span className="text-right">Change</span>
                <span className="text-right">%</span>
              </>
            )}
          </div>

          {renderSection(revenue)}
          {renderSection(cogs)}
          <TotalRow
            label="Gross profit"
            t={subtotals.gross}
            note={grossMargin === null ? undefined : `${grossMargin.toFixed(1)}% margin`}
            big
          />
          {renderSection(opex)}
          <TotalRow label="Operating profit" t={subtotals.operating} big />
          {renderSection(other)}
          <TotalRow label="Net profit" t={subtotals.net} big final />
        </div>
      </div>
    </div>
  );
};
