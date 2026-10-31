import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useLedgerStore } from '@/mock/store';
import { formatMoney, formatDate } from '@/lib/format';
import { BUSINESS_TODAY } from '@/lib/docStatus';
import {
  ArrowDownLeft, ArrowUpRight, TrendingUp, Plus, X, ChevronRight, ChevronDown, ClipboardCheck, AlertTriangle,
  CalendarClock, Landmark, Lock, SlidersHorizontal, Calendar,
} from 'lucide-react';
import { useDashboardData, addDays } from './useDashboardData';
import { CashHero } from './widgets/CashHero';
import { KpiTile } from './widgets/KpiTile';
import { IncomeExpenseChart } from './widgets/IncomeExpenseChart';
import { AttentionList, type AttentionRow } from './widgets/AttentionList';
import { ReceivablesAging } from './widgets/ReceivablesAging';
import { ExpenseDonut } from './widgets/ExpenseDonut';
import { TopCustomers } from './widgets/TopCustomers';
import { ActivityFeed } from './widgets/ActivityFeed';
import { BankAccountsCard } from './widgets/BankAccountsCard';

const DAY_MS = 86_400_000;

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const ENTRANCE_CSS = `
@keyframes dash-fade-up { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
.dash-card { animation: dash-fade-up 320ms cubic-bezier(0.22, 1, 0.36, 1) both; }
@media (prefers-reduced-motion: reduce) { .dash-card { animation: none; } }
`;

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, currentUser, currentPeriod, bankAccounts, bankStatementLines, invoices, bills, accounts, periods } = useLedgerStore();
  const d = useDashboardData();
  const [showChecklist, setShowChecklist] = useState(true);

  const co = `/${currentCompany.slug}`;
  const base = d.base;
  const firstName = currentUser.name.split(' ')[0];

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
    attention.push({ id: 'approvals', icon: <ClipboardCheck className="size-4" />, tone: 'bg-warning-soft text-warning', text: `${plural(d.pendingCount, 'item')} waiting for your approval`, cta: 'Review', to: `${co}/approvals` });
  if (ar.overdueCount > 0)
    attention.push({ id: 'overdue', icon: <AlertTriangle className="size-4" />, tone: 'bg-danger-soft text-danger', text: `${plural(ar.overdueCount, 'invoice')} overdue`, detail: formatMoney(ar.overdue, base), cta: 'Chase', to: `${co}/invoices` });
  if (ap.soonCount > 0 || ap.overdueCount > 0) {
    const n = ap.soonCount + ap.overdueCount;
    attention.push({ id: 'bills', icon: <CalendarClock className="size-4" />, tone: 'bg-warning-soft text-warning', text: `${plural(n, 'bill')} due ${ap.overdueCount > 0 ? 'or overdue' : 'this week'}`, detail: formatMoney(ap.soon + ap.overdue, base), cta: 'Pay', to: `${co}/bills` });
  }
  if (d.unmatchedTotal > 0)
    attention.push({ id: 'reconcile', icon: <Landmark className="size-4" />, tone: 'bg-info-soft text-info', text: `${plural(d.unmatchedTotal, 'bank line')} to reconcile`, cta: 'Reconcile', to: d.firstUnmatched ? `${co}/banking/${d.firstUnmatched.acct.id}/reconcile` : `${co}/banking` });
  if (periodOpen)
    attention.push({ id: 'period', icon: <Lock className="size-4" />, tone: 'bg-surface-neutral text-text-secondary', text: `${periodMonth} closes on ${formatDate(cutoff)}`, cta: 'Open checklist', to: `${co}/periods` });

  const grid = 'grid grid-cols-1 lg:grid-cols-12 gap-5';

  return (
    <div className="flex flex-col gap-5">
      <style>{ENTRANCE_CSS}</style>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-text-primary tracking-tight">{greeting()}, {firstName}</h1>
          <p className="text-[13px] text-text-muted mt-0.5">
            {currentCompany.name} · {formatDate(BUSINESS_TODAY)} · {currentPeriod.status === 'open' ? 'Open period' : 'Period ' + currentPeriod.status.replace('_', ' ')}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => toast('Period selector is coming soon')} className="flex items-center gap-1.5 h-9 px-3 bg-surface border border-border hover:border-border-strong text-text-primary rounded-lg text-xs font-medium shadow-sm transition-colors cursor-pointer">
            <Calendar className="size-3.5 text-text-muted" />
            <span>{currentPeriod.name}</span>
            <ChevronDown className="size-3.5 text-text-muted" />
          </button>
          <button type="button" onClick={() => toast('Dashboard customization is coming soon')} className="flex items-center gap-1.5 h-9 px-3 text-text-secondary hover:text-text-primary hover:bg-surface-neutral rounded-lg text-xs font-medium transition-colors cursor-pointer">
            <SlidersHorizontal className="size-3.5" />
            <span>Customize</span>
          </button>
          <button type="button" onClick={() => navigate(`${co}/invoices/new`)} className="flex items-center gap-1.5 h-9 px-4 bg-accent hover:bg-accent-hover text-white rounded-lg text-xs font-semibold shadow-sm transition-colors cursor-pointer">
            <Plus className="size-3.5" />
            <span>New invoice</span>
          </button>
        </div>
      </div>

      {/* Getting started: only while incomplete */}
      {showChecklist && nextStep && (
        <div className="px-4 py-3 bg-surface border border-border rounded-xl shadow-sm flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-5">
          <div className="text-xs font-semibold text-text-primary shrink-0">
            Getting started <span className="font-normal text-text-muted ml-1">{doneCount} of {checklist.length} done</span>
          </div>
          <div className="flex-1 h-1.5 bg-surface-neutral rounded-full overflow-hidden min-w-[80px]">
            <div className="bg-accent h-full" style={{ width: `${(doneCount / checklist.length) * 100}%` }} />
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

      {/* Row 1: cash hero + KPIs */}
      <div className={grid}>
        <CashHero d={d} to={`${co}/banking`} index={0} className="lg:col-span-5" />
        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-5">
          <KpiTile
            index={1} label="Owed to you" icon={<ArrowDownLeft className="size-4" />} tint="bg-success-soft text-success" color="var(--color-success)"
            value={formatMoney(ar.due, base)} series={d.months.map((m) => m.ar)} to={`${co}/invoices`}
            sub={ar.overdueCount > 0 ? <span className="text-danger font-medium">{formatMoney(ar.overdue, base)} overdue · {plural(ar.overdueCount, 'invoice')}</span> : 'Nothing overdue'}
          />
          <KpiTile
            index={2} label="You owe" icon={<ArrowUpRight className="size-4" />} tint="bg-warning-soft text-warning" color="var(--color-warning)"
            value={formatMoney(ap.due, base)} series={d.months.map((m) => m.ap)} to={`${co}/bills`}
            sub={ap.overdueCount > 0 ? <span className="text-danger font-medium">{formatMoney(ap.overdue, base)} overdue · {plural(ap.overdueCount, 'bill')}</span>
              : ap.soonCount > 0 ? <span className="text-warning font-medium">{formatMoney(ap.soon, base)} due in next 7 days</span> : 'Nothing due in the next 7 days'}
          />
          <KpiTile
            index={3} label="Net profit · YTD" icon={<TrendingUp className="size-4" />} tint="bg-accent-soft text-accent" color="var(--color-accent)"
            value={formatMoney(d.netProfit, base, { parenthesesNegative: true })} valueClass={d.netProfit < 0 ? 'text-danger' : 'text-text-primary'}
            series={d.months.map((m) => m.cumNet)} to={`${co}/reports/profit-and-loss`}
            sub={d.hasBudget ? <span className={d.vsBudget >= 0 ? 'text-success font-medium' : 'text-danger font-medium'}>{formatMoney(Math.abs(d.vsBudget), base)} {d.vsBudget >= 0 ? 'ahead of' : 'behind'} budget</span> : `Income ${formatMoney(d.income, base)}`}
          />
        </div>
      </div>

      {/* Row 2 */}
      <div className={grid}>
        <IncomeExpenseChart d={d} to={`${co}/reports/profit-and-loss`} index={4} className="lg:col-span-8" />
        <AttentionList rows={attention} index={5} className="lg:col-span-4" />
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
