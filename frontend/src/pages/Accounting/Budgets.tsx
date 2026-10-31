import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ColumnDef } from '@tanstack/react-table';
import { useLedgerStore } from '@/mock/store';
import { DataTable } from '@/components/domain/DataTable';
import { formatMoney } from '@/lib/format';
import { PageHeader } from '@/components/domain/PageHeader';
import { toast } from 'sonner';
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
  const { currentCompany, budgets, periods, accounts, updateBudgetAmount, getBudgetVsActual, uiDensity } = useLedgerStore();
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
    // Favourable = more income or less spending than planned. Rows without a budget are neutral.
    return getBudgetVsActual(selectedBudget.id, selectedPeriodId).map((r) => {
      const isIncome = accounts.find((a) => a.id === r.accountId)?.account_type === 'income';
      const tone: 'good' | 'bad' | 'none' =
        r.budgetAmount === 0 ? 'none' : (isIncome ? r.variance >= 0 : r.variance <= 0) ? 'good' : 'bad';
      return { ...r, isIncome, tone };
    });
  }, [selectedBudget, selectedPeriodId, getBudgetVsActual, accounts]);

  /** Tiny trend line of the budget across periods, with a dot on the selected one. */
  const Spark: React.FC<{ accountId: string; actual: number }> = ({ accountId }) => {
    const vals = periods.map((p) => selectedBudget?.lines.find((l) => l.account_id === accountId && l.period_id === p.id)?.amount ?? 0);
    const max = Math.max(...vals, 1);
    const min = Math.min(...vals, 0);
    const w = 72, h = 22;
    const x = (i: number) => (vals.length > 1 ? (i / (vals.length - 1)) * (w - 4) + 2 : w / 2);
    const y = (v: number) => h - 3 - ((v - min) / (max - min || 1)) * (h - 6);
    const idx = Math.max(0, periods.findIndex((p) => p.id === selectedPeriodId));
    return (
      <svg width={w} height={h} aria-hidden className="text-accent">
        <polyline fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" points={vals.map((v, i) => `${x(i)},${y(v)}`).join(' ')} />
        <circle cx={x(idx)} cy={y(vals[idx] ?? 0)} r="2.5" fill="currentColor" />
      </svg>
    );
  };

  const varianceColumns: ColumnDef<any>[] = [
    {
      accessorKey: 'accountName',
      header: 'Account',
      cell: ({ row }) => (
        <div>
          <div className="font-medium text-text-primary">{row.original.accountName}</div>
          <div className="font-mono text-[11px] text-text-muted">{row.original.accountCode}</div>
        </div>
      ),
    },
    {
      accessorKey: 'budgetAmount',
      header: () => <div className="text-right">Budget</div>,
      cell: ({ row }) => <div className="text-right font-mono tabular-nums text-text-muted">{formatMoney(row.original.budgetAmount)}</div>,
    },
    {
      accessorKey: 'actualAmount',
      header: () => <div className="text-right">Actual</div>,
      cell: ({ row }) => <div className="text-right font-mono font-semibold tabular-nums text-text-primary">{formatMoney(row.original.actualAmount)}</div>,
    },
    {
      accessorKey: 'variance',
      header: () => <div className="text-right">Difference</div>,
      cell: ({ row }) => {
        const tone = row.original.tone;
        const cls = tone === 'good' ? 'bg-success-soft text-success' : tone === 'bad' ? 'bg-danger-soft text-danger' : 'text-text-muted';
        return (
          <div className="flex justify-end">
            <span className={`rounded-md px-2 py-0.5 font-mono text-[13px] font-semibold tabular-nums ${cls}`}>
              {row.original.variance > 0 ? '+' : ''}
              {formatMoney(row.original.variance)}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: 'variancePct',
      header: () => <div className="text-right">%</div>,
      cell: ({ row }) => <div className="text-right font-mono tabular-nums text-text-muted">{row.original.variancePct.toFixed(1)}%</div>,
    },
    {
      id: 'trend',
      header: 'Budget trend',
      cell: ({ row }) => <Spark accountId={row.original.accountId ?? row.original.account_id} actual={row.original.actualAmount} />,
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => {
        const { tone, isIncome } = row.original;
        const [cls, dot, label] =
          tone === 'none'
            ? ['bg-surface-neutral text-text-muted', 'bg-text-muted', 'No budget']
            : tone === 'good'
            ? ['bg-success-soft text-success', 'bg-success', isIncome ? 'Ahead of plan' : 'Within budget']
            : ['bg-warning-soft text-warning', 'bg-warning', isIncome ? 'Behind plan' : 'Over budget'];
        return (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>
            <span className={`size-1.5 rounded-full ${dot}`} />
            {label}
          </span>
        );
      },
    },
  ];

  // Variance summary totals
  const summary = useMemo(() => {
    // Profit view: income counts up, spending counts down.
    let totBudget = 0;
    let totActual = 0;
    for (const r of varianceRows) {
      const sign = r.isIncome ? 1 : -1;
      totBudget += sign * r.budgetAmount;
      totActual += sign * r.actualAmount;
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

  const sel = 'h-9 rounded-lg border border-border bg-surface px-3 text-[13px] text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20';
  const tabBtn = (id: 'editor' | 'variance', label: string) => (
    <button
      type="button"
      onClick={() => setActiveTab(id)}
      className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition cursor-pointer ${
        activeTab === id ? 'bg-surface text-text-primary font-semibold shadow-card' : 'text-text-muted hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  );
  const kpi = (label: string, hint: string, value: React.ReactNode, tone: string, icon: React.ReactNode) => (
    <div className="flex items-start gap-3 rounded-xl border border-border bg-surface p-4 shadow-card">
      <span className={`flex size-9 shrink-0 items-center justify-center rounded-lg ${tone}`}>{icon}</span>
      <div className="min-w-0">
        <div className="text-xs text-text-muted">{label}</div>
        <div className="text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
        <div className="text-xs text-text-muted">{hint}</div>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={<BarChart3 />}
        title="Budgets"
        subtitle="Plan what you expect to earn and spend, and see how you are doing against it"
        actions={
          <button
            type="button"
            onClick={() => window.print()}
            className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition hover:bg-surface-neutral cursor-pointer"
          >
            <Download className="size-4 text-text-muted" />
            <span>Export report</span>
          </button>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex w-fit items-center gap-1 rounded-lg border border-border bg-surface-neutral p-1">
          {tabBtn('variance', 'Plan vs actual')}
          {tabBtn('editor', 'Edit budget')}
        </div>
        {activeTab === 'variance' && (
          <div className="flex items-center gap-2">
            <select aria-label="Budget version" value={selectedBudgetId} onChange={(e) => setSelectedBudgetId(e.target.value)} className={sel}>
              {budgets.map((b) => (
                <option key={b.id} value={b.id}>{b.name} ({b.version})</option>
              ))}
            </select>
            <select aria-label="Period" value={selectedPeriodId} onChange={(e) => setSelectedPeriodId(e.target.value)} className={sel}>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {activeTab === 'variance' && (
        <div className="ui-rise-in flex flex-col gap-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {kpi('Planned profit', 'Budgeted income less budgeted spending', <span className="text-text-primary">{formatMoney(summary.totBudget)}</span>, 'bg-accent-soft text-accent', <FileSpreadsheet className="size-4" />)}
            {kpi('Actual profit', 'From your recorded transactions', <span className="text-text-primary">{formatMoney(summary.totActual)}</span>, 'bg-violet-soft text-violet', <BarChart3 className="size-4" />)}
            {kpi(
              'Difference',
              summary.totVariance >= 0 ? 'Ahead of plan' : 'Behind plan',
              <span className={summary.totVariance >= 0 ? 'text-success' : 'text-danger'}>
                {summary.totVariance >= 0 ? '+' : ''}
                {formatMoney(summary.totVariance)}
              </span>,
              summary.totVariance >= 0 ? 'bg-success-soft text-success' : 'bg-danger-soft text-danger',
              summary.totVariance >= 0 ? <TrendingUp className="size-4" /> : <TrendingDown className="size-4" />
            )}
          </div>

          <DataTable
            columns={varianceColumns}
            data={varianceRows}
            searchPlaceholder="Filter accounts..."
            rowDensity={uiDensity}
            rowActions={(r: any) => [
              { label: 'Open account ledger', icon: ArrowRight, onClick: () => navigate(`/${coSlug}/reports/general-ledger?account=${r.accountCode}`) },
              { label: 'Edit budget', icon: Upload, onClick: () => setActiveTab('editor') },
              { label: 'Copy account code', icon: Layers, onClick: () => { navigator.clipboard?.writeText(r.accountCode); toast.success(`${r.accountCode} copied`); } },
            ]}
            contextMenuTitle={(r: any) => `${r.accountCode} · ${r.accountName}`}
          />
        </div>
      )}

      {activeTab === 'editor' && (
        <div className="ui-rise-in flex flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold tracking-tight text-text-primary">Budget by month</h2>
              <p className="text-[13px] text-text-muted">Click any amount to change it. Changes save when you leave the cell.</p>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/${coSlug}/import`)}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition hover:bg-surface-neutral cursor-pointer"
            >
              <Upload className="size-4 text-text-muted" />
              <span>Import from CSV</span>
            </button>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[900px] border-collapse text-left text-[13px]">
              <thead>
                <tr className="h-9 border-b border-border bg-surface-neutral/60 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  <th className="sticky left-0 z-10 w-56 bg-surface-neutral px-3">Account</th>
                  {periods.map((p) => (
                    <th key={p.id} className="w-24 px-2 text-right">{p.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {pnlAccounts.map((acc) => (
                  <tr key={acc.id} className="h-10 transition hover:bg-accent-soft/40">
                    <td className="sticky left-0 z-10 max-w-[220px] truncate border-r border-border bg-surface px-3 font-medium text-text-primary">
                      <span className="mr-1.5 font-mono text-accent">{acc.code}</span>
                      {acc.name}
                    </td>
                    {periods.map((p) => {
                      const line = selectedBudget?.lines.find((l) => l.account_id === acc.id && l.period_id === p.id);
                      const val = line ? (line.amount / 100).toFixed(0) : '0';
                      return (
                        <td key={p.id} className="px-1 text-right">
                          <input
                            type="number"
                            defaultValue={val}
                            onBlur={(e) => handleCellBlur(acc.id, p.id, e.target.value)}
                            className="h-8 w-full rounded-md bg-transparent px-1.5 text-right font-mono tabular-nums text-text-primary hover:bg-surface-neutral focus:bg-surface focus:outline-none focus:ring-2 focus:ring-accent/40"
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
  );
};
