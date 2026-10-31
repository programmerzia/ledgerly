import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { formatMoney, formatDate } from '@/lib/format';
import { BUSINESS_TODAY } from '@/lib/docStatus';
import { Plus, X, ChevronRight } from 'lucide-react';
import { useDashboardData, addDays } from './useDashboardData';
import { KeyFigures, cashNote } from './widgets/KeyFigures';
import { IncomeExpenseChart } from './widgets/IncomeExpenseChart';
import { AttentionList, type AttentionRow } from './widgets/AttentionList';
import { ReceivablesAging } from './widgets/ReceivablesAging';
import { ExpenseDonut } from './widgets/ExpenseDonut';
import { TopCustomers } from './widgets/TopCustomers';
import { ActivityFeed } from './widgets/ActivityFeed';
import { BankAccountsCard } from './widgets/BankAccountsCard';

const DAY_MS = 86_400_000;

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, currentPeriod, bankAccounts, bankStatementLines, invoices, bills, accounts, periods } = useLedgerStore();
  const d = useDashboardData();
  const [showChecklist, setShowChecklist] = useState(true);

  const co = `/${currentCompany.slug}`;
  const base = d.base;

  // ---- Getting started ----
  const checklist = [
    { id: 'coa', title: 'Set up your chart of accounts', done: accounts.length >= 10, link: `${co}/accounts` },
    { id: 'bank', title: 'Connect a bank account', done: bankAccounts.length > 0, link: `${co}/banking` },
    { id: 'invoice', title: 'Send your first invoice', done: invoices.some((i) => i.status === 'posted'), link: `${co}/invoices` },
    { id: 'bill', title: 'Record a supplier bill', done: bills.some((b) => b.status === 'posted'), link: `${co}/bills` },
    { id: 'reconcile', title: 'Reconcile your bank account', done: bankStatementLines.some((l) => l.status === 'matched'), link: `${co}/banking` },
    { id: 'close', title: 'Close your first period', done: periods.some((p) => p.status === 'closed'), link: `${co}/periods` },
  ];
  const doneCount = checklist.filter((c) => c.done).length;
  const nextStep = checklist.find((c) => !c.done);

  const { ar, ap } = d;

  // ---- Needs attention ----
  const cutoff = addDays(currentPeriod.ends_on, 5);
  const daysToCutoff = Math.round((new Date(cutoff).getTime() - new Date(BUSINESS_TODAY).getTime()) / DAY_MS);
  const periodOpen = currentPeriod.status === 'open' && daysToCutoff >= 0 && daysToCutoff <= 14;
  const periodMonth = currentPeriod.name.split(' ')[0];

  const attention: AttentionRow[] = [];
  if (d.pendingCount > 0)
    attention.push({ id: 'approvals', text: `Approve ${plural(d.pendingCount, 'document')}`, cta: 'Review', to: `${co}/approvals` });
  if (ar.overdueCount > 0)
    attention.push({ id: 'overdue', text: `Chase ${plural(ar.overdueCount, 'overdue invoice')}`, detail: `${formatMoney(ar.overdue, base)} past due`, urgent: true, cta: 'Invoices', to: `${co}/invoices` });
  if (ap.soonCount > 0 || ap.overdueCount > 0) {
    const n = ap.soonCount + ap.overdueCount;
    attention.push({ id: 'bills', text: `Pay ${plural(n, 'bill')} ${ap.overdueCount > 0 ? 'due or overdue' : 'due this week'}`, detail: formatMoney(ap.soon + ap.overdue, base), urgent: ap.overdueCount > 0, cta: 'Pay bills', to: `${co}/bills` });
  }
  if (d.unmatchedTotal > 0)
    attention.push({ id: 'reconcile', text: `Match ${plural(d.unmatchedTotal, 'bank line')}`, cta: 'Reconcile', to: d.firstUnmatched ? `${co}/banking/${d.firstUnmatched.acct.id}/reconcile` : `${co}/banking` });
  if (periodOpen)
    attention.push({ id: 'period', text: `Close ${periodMonth}`, detail: `Cut-off ${formatDate(cutoff)}`, cta: 'Checklist', to: `${co}/periods` });

  const grid = 'grid grid-cols-1 lg:grid-cols-12 gap-4';
  const periodLabel = currentPeriod.status === 'open' ? `${currentPeriod.name} open` : `${currentPeriod.name} ${currentPeriod.status.replace('_', ' ')}`;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-text-primary">{currentCompany.name}</h1>
          <p className="text-[13px] text-text-muted mt-0.5">{formatDate(BUSINESS_TODAY)} · {periodLabel}</p>
        </div>
        <button type="button" onClick={() => navigate(`${co}/invoices/new`)} className="self-start sm:self-auto flex items-center gap-1.5 h-8 px-3 bg-surface border border-border hover:border-border-strong text-text-primary rounded-md text-[13px] font-medium transition-colors cursor-pointer">
          <Plus className="size-3.5" />
          New invoice
        </button>
      </div>

      {/* Getting started: only while incomplete */}
      {showChecklist && nextStep && (
        <div className="px-4 py-2.5 bg-surface border border-border rounded-lg flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
          <div className="text-[13px] text-text-secondary shrink-0 flex-1">
            Setup: {doneCount} of {checklist.length} steps done
          </div>
          <div className="flex items-center gap-3 text-xs">
            <button
              type="button"
              onClick={() => navigate(nextStep.link)}
              className="text-accent hover:underline font-medium cursor-pointer flex items-center gap-1"
            >
              Next: {nextStep.title}
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              aria-label="Dismiss getting started"
              onClick={() => setShowChecklist(false)}
              className="text-text-muted hover:text-text-primary cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      <KeyFigures
        figures={[
          { label: 'Cash in bank', value: formatMoney(d.cashBase, base), note: cashNote(d), to: `${co}/banking` },
          {
            label: 'Owed to you', value: formatMoney(ar.due, base), to: `${co}/invoices`,
            note: ar.overdueCount > 0 ? <span className="text-danger">{formatMoney(ar.overdue, base)} overdue</span> : 'Nothing overdue',
          },
          {
            label: 'You owe', value: formatMoney(ap.due, base), to: `${co}/bills`,
            note: ap.overdueCount > 0 ? <span className="text-danger">{formatMoney(ap.overdue, base)} overdue</span>
              : ap.soonCount > 0 ? `${formatMoney(ap.soon, base)} due within 7 days` : 'Nothing due this week',
          },
          {
            label: 'Net profit, year to date', value: formatMoney(d.netProfit, base, { parenthesesNegative: true }),
            valueClass: d.netProfit < 0 ? 'text-danger' : undefined, to: `${co}/reports/profit-and-loss`,
            note: d.hasBudget ? `${formatMoney(Math.abs(d.vsBudget), base)} ${d.vsBudget >= 0 ? 'ahead of' : 'behind'} budget` : `Income ${formatMoney(d.income, base)}`,
          },
        ]}
      />

      {/* Row 2 */}
      <div className={grid}>
        <IncomeExpenseChart d={d} to={`${co}/reports/profit-and-loss`} index={4} className="lg:col-span-8" />
        <AttentionList rows={attention} className="lg:col-span-4" />
      </div>

      {/* Row 3 */}
      <div className={grid}>
        <ReceivablesAging d={d} index={6} className="lg:col-span-4" />
        <ExpenseDonut d={d} index={7} className="lg:col-span-4" />
        <TopCustomers d={d} to={`${co}/customers`} index={8} className="lg:col-span-4" />
      </div>

      {/* Row 4 */}
      <div className={grid}>
        <ActivityFeed d={d} co={co} index={9} className="lg:col-span-8" />
        <BankAccountsCard d={d} co={co} index={10} className="lg:col-span-4" />
      </div>
    </div>
  );
};
