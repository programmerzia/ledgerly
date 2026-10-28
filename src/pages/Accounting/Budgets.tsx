import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { formatMoney } from '@/lib/format';
import {
  BarChart3,
  Calendar,
  Layers,
  Download,
  Upload,
  ArrowRight,
  TrendingUp,
  TrendingDown,
  CheckCircle2,
  FileSpreadsheet,
} from 'lucide-react';

export const Budgets: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, budgets, periods, accounts, updateBudgetAmount, getBudgetVsActual } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [activeTab, setActiveTab] = useState<'editor' | 'variance'>('variance');
  const [selectedBudgetId, setSelectedBudgetId] = useState<string>(budgets[0]?.id || 'bgt-2026-v1');
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('per-2026-10'); // Oct 2026

  const selectedBudget = useMemo(() => {
    return budgets.find((b) => b.id === selectedBudgetId) || budgets[0];
  }, [budgets, selectedBudgetId]);

  const pnlAccounts = useMemo(() => {
    return accounts.filter((a) => a.account_type === 'income' || a.account_type === 'expense');
  }, [accounts]);

  // Variance rows
  const varianceRows = useMemo(() => {
    if (!selectedBudget) return [];
    return getBudgetVsActual(selectedBudget.id, selectedPeriodId);
  }, [selectedBudget, selectedPeriodId, getBudgetVsActual]);

  // Variance summary totals
  const summary = useMemo(() => {
    let totBudget = 0;
    let totActual = 0;
    for (const r of varianceRows) {
      totBudget += r.budgetAmount;
      totActual += r.actualAmount;
    }
    const totVariance = totActual - totBudget;
    return { totBudget, totActual, totVariance };
  }, [varianceRows]);

  const handleCellBlur = (accountId: string, periodId: string, valueStr: string) => {
    const parsed = Math.round((parseFloat(valueStr) || 0) * 100);
    if (selectedBudget) {
      updateBudgetAmount(selectedBudget.id, accountId, periodId, parsed);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-canvas">
      <div className="w-full flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-border">
          <div>
            <h1 className="text-xl font-semibold text-text-primary">Budgets & Performance Control</h1>
            <p className="text-xs text-text-muted">
              Operating budgets, multi-period spreadsheets & real-time variance tracking
            </p>
          </div>

          {/* View Mode Switcher */}
          <div className="flex items-center gap-1 bg-surface-subtle p-1 rounded-sm border border-line-border text-xs">
            <button
              type="button"
              onClick={() => setActiveTab('variance')}
              className={`px-3 py-1 rounded font-medium transition ${
                activeTab === 'variance'
                  ? 'bg-surface-elevated text-ink-900 font-semibold shadow-2xs'
                  : 'text-ink-muted hover:text-ink-900'
              }`}
            >
              Budget vs Actual Variance
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('editor')}
              className={`px-3 py-1 rounded font-medium transition ${
                activeTab === 'editor'
                  ? 'bg-surface-elevated text-ink-900 font-semibold shadow-2xs'
                  : 'text-ink-muted hover:text-ink-900'
              }`}
            >
              Matrix Grid Editor
            </button>
          </div>
        </div>

        {/* TAB 1: Budget vs Actual Report */}
        {activeTab === 'variance' && (
          <div className="flex flex-col gap-5 animate-in fade-in duration-150">
            {/* Controls bar */}
            <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-wrap items-center justify-between gap-4 text-xs">
              <div className="flex items-center gap-4">
                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                    Budget Version
                  </label>
                  <select
                    value={selectedBudgetId}
                    onChange={(e) => setSelectedBudgetId(e.target.value)}
                    className="h-8 px-2.5 rounded-sm border border-line-border bg-surface-subtle text-ink-900 font-medium"
                  >
                    {budgets.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.version})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex flex-col gap-1">
                  <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                    Fiscal Period
                  </label>
                  <select
                    value={selectedPeriodId}
                    onChange={(e) => setSelectedPeriodId(e.target.value)}
                    className="h-8 px-2.5 rounded-sm border border-line-border bg-surface-subtle text-ink-900 font-mono"
                  >
                    {periods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="h-8 px-3 rounded-sm border border-line-border bg-surface-subtle hover:bg-surface-neutral text-ink-900 text-xs font-medium transition flex items-center gap-1.5"
                >
                  <Download className="w-3.5 h-3.5 text-ink-muted" />
                  <span>Export Report</span>
                </button>
              </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col justify-between">
                <span className="text-ink-muted uppercase font-semibold text-[11px]">
                  Budgeted Amount
                </span>
                <span className="text-xl font-bold font-mono text-num text-ink-900">
                  {formatMoney(summary.totBudget)}
                </span>
                <span className="text-[11px] text-ink-muted">Approved Board Baseline</span>
              </div>

              <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col justify-between">
                <span className="text-ink-muted uppercase font-semibold text-[11px]">
                  Actual Ledger Amount
                </span>
                <span className="text-xl font-bold font-mono text-num text-brand-teal">
                  {formatMoney(summary.totActual)}
                </span>
                <span className="text-[11px] text-ink-muted">Dynamic journal reduction</span>
              </div>

              <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col justify-between">
                <span className="text-ink-muted uppercase font-semibold text-[11px]">
                  Net Variance
                </span>
                <span className={`text-xl font-bold font-mono text-num ${summary.totVariance >= 0 ? 'text-success' : 'text-danger'}`}>
                  {summary.totVariance >= 0 ? '+' : ''}
                  {formatMoney(summary.totVariance)}
                </span>
                <span className="text-[11px] text-ink-muted">Actual vs Planned</span>
              </div>
            </div>

            {/* Variance Detail Table */}
            <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col gap-3 text-xs">
              <span className="font-bold text-ink-900 uppercase tracking-wider text-[11px]">
                Line by Line Account Breakdown
              </span>

              <div className="border border-line-border rounded-sm overflow-hidden">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="h-8 bg-surface-neutral border-b border-line-border text-[11px] font-semibold text-ink-muted uppercase">
                      <th className="px-3">Account Code</th>
                      <th className="px-3">Account Name</th>
                      <th className="px-3 text-right">Budget</th>
                      <th className="px-3 text-right">Actual (Ledger)</th>
                      <th className="px-3 text-right">Variance ($)</th>
                      <th className="px-3 text-right">Variance (%)</th>
                      <th className="px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-border">
                    {varianceRows.map((r) => {
                      const isFavorable = r.variance >= 0;
                      return (
                        <tr key={r.accountId} className="h-9 hover:bg-surface-neutral transition">
                          <td className="px-3 font-mono font-medium text-brand-teal">
                            {r.accountCode}
                          </td>
                          <td className="px-3 font-medium text-ink-900">{r.accountName}</td>
                          <td className="px-3 text-right font-mono text-num text-ink-muted">
                            {formatMoney(r.budgetAmount)}
                          </td>
                          <td className="px-3 text-right font-mono text-num font-semibold text-ink-900">
                            {formatMoney(r.actualAmount)}
                          </td>
                          <td className="px-3 text-right font-mono text-num font-semibold">
                            <span className={isFavorable ? 'text-success' : 'text-danger'}>
                              {isFavorable ? '+' : ''}
                              {formatMoney(r.variance)}
                            </span>
                          </td>
                          <td className="px-3 text-right font-mono text-num text-ink-muted">
                            {r.variancePct.toFixed(1)}%
                          </td>
                          <td className="px-3 text-center">
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                isFavorable
                                  ? 'bg-success/10 text-success'
                                  : 'bg-warning/10 text-warning'
                              }`}
                            >
                              {isFavorable ? 'Favorable' : 'Unfavorable'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Matrix Grid Editor */}
        {activeTab === 'editor' && (
          <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col gap-3 text-xs overflow-x-auto animate-in fade-in duration-150">
            <div className="flex items-center justify-between">
              <div>
                <span className="font-bold text-ink-900 uppercase tracking-wider text-[11px] block">
                  Spreadsheet Grid Matrix: Account × Fiscal Period
                </span>
                <span className="text-[11px] text-ink-muted">
                  Click any cell to edit budget targets. Values auto-save in integer minor units.
                </span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => alert('CSV Template Exported')}
                  className="h-8 px-3 rounded-sm border border-line-border bg-surface-subtle hover:bg-surface-neutral text-ink-900 text-xs font-medium transition flex items-center gap-1.5"
                >
                  <Upload className="w-3.5 h-3.5 text-ink-muted" />
                  <span>Import CSV</span>
                </button>
              </div>
            </div>

            <div className="border border-line-border rounded-sm overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs min-w-[900px]">
                <thead>
                  <tr className="h-8 bg-surface-neutral border-b border-line-border text-[11px] font-semibold text-ink-muted uppercase">
                    <th className="px-2 w-48 sticky left-0 bg-surface-neutral z-10">Account</th>
                    {periods.map((p) => (
                      <th key={p.id} className="px-2 w-24 text-right font-mono">
                        {p.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-border">
                  {pnlAccounts.map((acc) => (
                    <tr key={acc.id} className="h-9 hover:bg-surface-neutral transition">
                      <td className="px-2 sticky left-0 bg-surface-elevated z-10 font-medium text-ink-900 border-r border-line-border truncate max-w-[200px]">
                        <span className="font-mono text-brand-teal mr-1">{acc.code}</span>
                        {acc.name}
                      </td>
                      {periods.map((p) => {
                        const line = selectedBudget?.lines.find(
                          (l) => l.account_id === acc.id && l.period_id === p.id
                        );
                        const val = line ? (line.amount / 100).toFixed(0) : '0';
                        return (
                          <td key={p.id} className="px-1 text-right">
                            <input
                              type="number"
                              defaultValue={val}
                              onBlur={(e) => handleCellBlur(acc.id, p.id, e.target.value)}
                              className="w-full h-7 px-1 text-right font-mono text-ink-900 bg-transparent hover:bg-surface-subtle focus:bg-surface-subtle focus:outline-none focus:ring-1 focus:ring-brand-teal rounded text-xs"
                            />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
