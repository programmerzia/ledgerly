import { useMemo } from 'react';
import { useLedgerStore } from '@/mock/store';
import { amountDue, daysOverdue, paymentStatus, BUSINESS_TODAY } from '@/lib/docStatus';
import type { Invoice } from '@/types';

const DAY_MS = 86_400_000;

export function addDays(date: string, days: number): string {
  return new Date(new Date(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

export interface MonthPoint {
  key: string;
  label: string;
  income: number;
  expenses: number;
  net: number;
  cash: number;
  ar: number;
  ap: number;
  cumNet: number;
}

export interface DocSummary {
  due: number;
  overdue: number;
  overdueCount: number;
  soon: number;
  soonCount: number;
}

function summarize(docs: Invoice[], soonDays: number): DocSummary {
  const out: DocSummary = { due: 0, overdue: 0, overdueCount: 0, soon: 0, soonCount: 0 };
  const horizon = addDays(BUSINESS_TODAY, soonDays);
  for (const d of docs) {
    if (d.status !== 'posted') continue;
    const owed = amountDue(d);
    if (owed === 0) continue;
    out.due += owed;
    if (paymentStatus(d) === 'overdue' && daysOverdue(d) > 0) {
      out.overdue += owed;
      out.overdueCount += 1;
    } else if (d.due_date <= horizon) {
      out.soon += owed;
      out.soonCount += 1;
    }
  }
  return out;
}

export const AGING_BUCKETS = [
  { key: 'current', label: 'Current', color: 'var(--color-success)' },
  { key: 'd30', label: '1–30', color: 'var(--color-info)' },
  { key: 'd60', label: '31–60', color: 'var(--color-warning)' },
  { key: 'd90', label: '61–90', color: 'var(--color-violet)' },
  { key: 'd90p', label: '90+', color: 'var(--color-danger)' },
] as const;

export function useDashboardData() {
  const s = useLedgerStore();
  const {
    currentCompany, currentPeriod, bankAccounts, bankStatementLines, balanceOf, invoices, bills,
    journals, accounts, periods, budgets, getBudgetVsActual, contacts, auditEvents,
  } = s;
  const base = currentCompany.base_currency;

  return useMemo(() => {
    // ---- Monthly series ----
    const fyPeriods = periods
      .filter((p) => p.fiscal_year_id === currentPeriod.fiscal_year_id && p.kind !== 'adjustment' && p.number <= currentPeriod.number)
      .sort((a, b) => a.number - b.number);
    const incomeAccts = accounts.filter((a) => a.account_type === 'income');
    const expenseAccts = accounts.filter((a) => a.account_type === 'expense');
    const bankAcctIds = bankAccounts.filter((b) => b.currency === base).map((b) => b.account_id);
    const arAccts = accounts.filter((a) => a.control_type === 'ar').map((a) => a.id);
    const apAccts = accounts.filter((a) => a.control_type === 'ap').map((a) => a.id);
    const sumAt = (ids: string[], at: string) => ids.reduce((t, id) => t + balanceOf(id, at), 0);

    const months: MonthPoint[] = [];
    let cum = 0;
    fyPeriods.forEach((p, i) => {
      const prevEnd = i === 0 ? addDays(p.starts_on, -1) : fyPeriods[i - 1].ends_on;
      const move = (accts: typeof incomeAccts) =>
        accts.reduce((t, a) => t + balanceOf(a.id, p.ends_on) - balanceOf(a.id, prevEnd), 0);
      const income = move(incomeAccts);
      const expenses = move(expenseAccts);
      cum += income - expenses;
      months.push({
        key: p.id,
        label: p.name.split(' ')[0],
        income,
        expenses,
        net: income - expenses,
        cash: sumAt(bankAcctIds, p.ends_on),
        ar: sumAt(arAccts, p.ends_on),
        ap: sumAt(apAccts, p.ends_on),
        cumNet: cum,
      });
    });

    // ---- Cash ----
    const bankRows = bankAccounts.map((b) => {
      const unmatched = bankStatementLines.filter((l) => l.bank_account_id === b.id && l.status === 'unmatched').length;
      return { acct: b, balance: balanceOf(b.account_id), unmatched };
    });
    const cashBase = bankRows.filter((r) => r.acct.currency === base).reduce((t, r) => t + r.balance, 0);
    const unmatchedTotal = bankRows.reduce((t, r) => t + r.unmatched, 0);
    const firstUnmatched = bankRows.find((r) => r.unmatched > 0);
    const prevCash = months.length > 1 ? months[months.length - 2].cash : null;
    const cashDelta = prevCash === null ? null : cashBase - prevCash;

    // ---- AR / AP ----
    const ar = summarize(invoices, 0);
    const ap = summarize(bills, 7);

    // ---- Profit vs budget ----
    const budget = budgets[0];
    const rows = budget
      ? getBudgetVsActual(budget.id, currentPeriod.id, 'ytd')
      : [];
    const typeOf = (id: string) => accounts.find((a) => a.id === id)?.account_type;
    const sumRows = (type: 'income' | 'expense', key: 'actualAmount' | 'budgetAmount') =>
      rows.filter((r) => typeOf(r.accountId) === type).reduce((t, r) => t + r[key], 0);
    const income = sumRows('income', 'actualAmount');
    const expenses = sumRows('expense', 'actualAmount');
    const netProfit = income - expenses;
    const budgetNet = sumRows('income', 'budgetAmount') - sumRows('expense', 'budgetAmount');
    const hasBudget = rows.some((r) => r.budgetAmount !== 0);
    const vsBudget = netProfit - budgetNet;

    // ---- Expense breakdown (YTD) ----
    const fyStart = fyPeriods[0]?.starts_on;
    const expenseRows = expenseAccts
      .map((a) => ({ id: a.id, name: a.name.replace(/\s*\(.*\)/, ''), value: balanceOf(a.id, currentPeriod.ends_on) - (fyStart ? balanceOf(a.id, addDays(fyStart, -1)) : 0) }))
      .filter((r) => r.value > 0)
      .sort((a, b) => b.value - a.value);
    const top = expenseRows.slice(0, 5);
    const otherSum = expenseRows.slice(5).reduce((t, r) => t + r.value, 0);
    const expenseSlices = otherSum > 0 ? [...top, { id: 'other', name: 'Everything else', value: otherSum }] : top;
    const expenseTotal = expenseRows.reduce((t, r) => t + r.value, 0);

    // ---- Aging ----
    const aging = AGING_BUCKETS.map((b) => ({ ...b, amount: 0, count: 0 }));
    for (const d of invoices) {
      if (d.status !== 'posted') continue;
      const owed = amountDue(d);
      if (owed === 0) continue;
      const days = daysOverdue(d);
      const idx = days === 0 ? 0 : days <= 30 ? 1 : days <= 60 ? 2 : days <= 90 ? 3 : 4;
      aging[idx].amount += owed;
      aging[idx].count += 1;
    }

    // ---- Top customers ----
    const byContact = new Map<string, { owed: number; overdue: number; count: number }>();
    for (const d of invoices) {
      if (d.status !== 'posted') continue;
      const owed = amountDue(d);
      if (owed === 0) continue;
      const e = byContact.get(d.contact_id) ?? { owed: 0, overdue: 0, count: 0 };
      e.owed += owed;
      e.count += 1;
      if (daysOverdue(d) > 0) e.overdue += owed;
      byContact.set(d.contact_id, e);
    }
    const topCustomers = [...byContact.entries()]
      .map(([id, e]) => ({ id, name: contacts.find((c) => c.id === id)?.name ?? 'Unknown', ...e }))
      .sort((a, b) => b.owed - a.owed)
      .slice(0, 5);

    // ---- Attention counts ----
    const pendingCount =
      invoices.filter((i) => i.status === 'pending_approval').length +
      bills.filter((b) => b.status === 'pending_approval').length +
      journals.filter((j) => j.status === 'pending_approval').length;

    const activity = [...(auditEvents ?? [])]
      .sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
      .slice(0, 7);

    return {
      base, months, bankRows, cashBase, cashDelta, unmatchedTotal, firstUnmatched, ar, ap,
      income, expenses, netProfit, hasBudget, vsBudget, expenseSlices, expenseTotal,
      aging, topCustomers, pendingCount, activity,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [journals, accounts, periods, bankAccounts, bankStatementLines, invoices, bills, budgets, contacts, auditEvents, currentPeriod.id, base]);
}

export type DashboardData = ReturnType<typeof useDashboardData>;
