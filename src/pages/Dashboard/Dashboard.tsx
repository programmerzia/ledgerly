import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerStore } from '@/mock/store';
import { formatMoney, formatDateTime, formatDate } from '@/lib/format';
import { StatusPill } from '@/components/domain/StatusPill';
import { toast } from 'sonner';
import {
  Wallet,
  Clock,
  ShieldAlert,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  AlertCircle,
  FileCheck2,
  TrendingUp,
  Activity,
  Plus,
  Building,
  LogOut,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

export const Dashboard: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, currentUser, bankAccounts, bankStatementLines, auditEvents, balanceOf, invoices, bills, journals } = useLedgerStore();
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const coSlug = currentCompany.slug;

  const pendingCount =
    invoices.filter((i) => i.status === 'pending_approval').length +
    bills.filter((b) => b.status === 'pending_approval').length +
    journals.filter((j) => j.status === 'pending_approval').length;

  useEffect(() => {
    async function loadStats() {
      const data = await api.getDashboardStats();
      setStats(data);
      setLoading(false);
    }
    loadStats();
  }, [currentCompany, invoices, bills, journals, bankStatementLines]);

  const unreconciledCount = bankStatementLines.filter((l) => l.status === 'unmatched').length;

  // Chart data: P&L Month to Date vs Budget (in $ thousands)
  const pnlData = [
    { category: 'Sales Rev', actual: 184.5, budget: 175.0 },
    { category: 'Service Rev', actual: 41.2, budget: 45.0 },
    { category: 'Cost of Sales', actual: 88.4, budget: 85.0 },
    { category: 'Salaries', actual: 45.0, budget: 45.0 },
    { category: 'Rent', actual: 18.0, budget: 18.0 },
    { category: 'Utilities', actual: 7.5, budget: 8.0 },
  ];

  const handleLogout = () => {
    toast.info('Signed out of session');
    navigate('/login');
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Top Welcome & Context */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl sm:text-h1 font-bold text-text-primary tracking-tight">Financial Control Dashboard</h1>
          <p className="text-xs text-text-muted mt-0.5 flex flex-wrap items-center gap-1.5 sm:gap-2">
            <span>{currentCompany.name} • Active Session:</span>
            <span className="font-semibold text-text-secondary">{currentUser.name}</span>
            <span>({currentUser.roleTitle})</span>
            <span className="text-text-muted">•</span>
            <button
              type="button"
              onClick={handleLogout}
              className="text-danger hover:underline font-medium inline-flex items-center gap-1 cursor-pointer"
            >
              <LogOut className="w-3 h-3 text-danger" />
              <span>Log out</span>
            </button>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5">
          <button
            type="button"
            onClick={handleLogout}
            className="flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-sm border border-border hover:border-danger/40 hover:bg-danger-soft text-text-secondary hover:text-danger text-xs font-medium transition cursor-pointer"
            title="Sign out of current user session"
          >
            <LogOut className="w-3.5 h-3.5 text-danger" />
            <span>Sign Out</span>
          </button>
          <button
            type="button"
            onClick={() => navigate(`/${coSlug}/invoices/new`)}
            className="flex items-center gap-1.5 h-8 px-3 sm:px-3.5 bg-accent hover:bg-accent-hover text-white rounded-sm text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Invoice</span>
          </button>
          <button
            type="button"
            onClick={() => navigate(`/${coSlug}/journals/new`)}
            className="flex items-center gap-1.5 h-8 px-3 sm:px-3.5 bg-surface border border-border hover:border-border-strong text-text-primary rounded-sm text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Journal</span>
          </button>
        </div>
      </div>

      {/* KPI Metric Cards Grid (12-column, 16px gutters, 1px border, no shadow, delta pill) */}
      <div className="grid grid-cols-12 gap-3 sm:gap-4">
        {/* Cash Position */}
        <div
          onClick={() => navigate(`/${coSlug}/banking`)}
          className="col-span-12 sm:col-span-6 lg:col-span-3 p-3.5 sm:p-4 bg-surface border border-border rounded-md hover:border-accent/50 cursor-pointer transition flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-[13px] font-semibold text-text-secondary mb-2">
            <span>Total Cash Position</span>
            <Wallet className="w-4 h-4 text-accent" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-xl sm:text-[24px] font-bold font-mono text-num text-text-primary leading-tight">
              {formatMoney(stats?.cashPosition || 17055000, currentCompany.base_currency)}
            </div>
            <span className="text-[11px] font-medium font-sans text-success bg-success-soft px-1.5 py-0.5 rounded">
              +4.8% MoM
            </span>
          </div>
          <div className="mt-2 text-[12px] text-text-muted flex items-center justify-between">
            <span>2 Operating Accounts</span>
            <span className="font-mono text-[11px]">USD + SOS</span>
          </div>
        </div>

        {/* Approvals Waiting (Demo Step 1: 3 approvals waiting) */}
        <div
          onClick={() => navigate(`/${coSlug}/approvals`)}
          className="col-span-12 sm:col-span-6 lg:col-span-3 p-4 bg-surface border border-border rounded-md hover:border-warning/60 cursor-pointer transition flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-[13px] font-semibold text-text-secondary mb-2">
            <span>Approvals Waiting</span>
            <Clock className="w-4 h-4 text-warning" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[24px] font-bold font-mono text-num text-text-primary leading-tight">
              {pendingCount}
            </div>
            <span className="text-[11px] font-medium font-sans text-warning bg-warning-soft px-1.5 py-0.5 rounded">
              Requires Review
            </span>
          </div>
          <div className="mt-2 text-[12px] text-text-muted">
            Assigned to Finance Manager (Fatima)
          </div>
        </div>

        {/* Unreconciled Bank Lines (Demo Step 1: 7 unreconciled lines) */}
        <div
          onClick={() => navigate(`/${coSlug}/banking/bnk-1/reconcile`)}
          className="col-span-12 sm:col-span-6 lg:col-span-3 p-4 bg-surface border border-border rounded-md hover:border-danger/50 cursor-pointer transition flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-[13px] font-semibold text-text-secondary mb-2">
            <span>Unreconciled Bank Lines</span>
            <AlertCircle className="w-4 h-4 text-danger" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[24px] font-bold font-mono text-num text-danger leading-tight">
              {unreconciledCount}
            </div>
            <span className="text-[11px] font-medium font-sans text-danger bg-danger-soft px-1.5 py-0.5 rounded">
              Needs Attention
            </span>
          </div>
          <div className="mt-2 text-[12px] text-text-muted">
            Premier Bank USD statement • Reconcile
          </div>
        </div>

        {/* Fiscal Period Status (Demo Step 1: Oct 2026 Open) */}
        <div
          onClick={() => navigate(`/${coSlug}/periods`)}
          className="col-span-12 sm:col-span-6 lg:col-span-3 p-4 bg-surface border border-border rounded-md hover:border-success/50 cursor-pointer transition flex flex-col justify-between"
        >
          <div className="flex items-center justify-between text-[13px] font-semibold text-text-secondary mb-2">
            <span>Fiscal Period</span>
            <Calendar className="w-4 h-4 text-success" />
          </div>
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[24px] font-bold font-mono text-text-primary leading-tight">
              Oct 2026
            </div>
            <StatusPill status="open" label="Open" size="sm" />
          </div>
          <div className="mt-2 text-[12px] text-text-muted">
            Period 10 of FY 2026 • Cutoff Nov 05
          </div>
        </div>
      </div>

      {/* Main Grid: Chart and Cash Accounts (12-column, 16px gutters) */}
      <div className="grid grid-cols-12 gap-4">
        {/* Recharts P&L MTD vs Budget Chart */}
        <div className="col-span-12 lg:col-span-8 p-3.5 sm:p-5 bg-surface border border-border rounded-md flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border pb-3">
            <div>
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-accent" />
                <span>P&L Month-to-Date vs. Budget ($k)</span>
              </h2>
              <p className="text-[12px] text-text-muted mt-0.5">Oct 2026 Operating Performance Comparison</p>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/${coSlug}/reports/profit-and-loss`)}
              className="text-xs text-accent hover:underline flex items-center gap-1 font-medium cursor-pointer self-start sm:self-auto"
            >
              <span>View P&L Report</span>
              <ArrowUpRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="h-64 min-h-[200px] w-full text-xs">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={pnlData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                <XAxis dataKey="category" stroke="var(--color-text-muted)" fontSize={10} tickLine={false} interval={0} />
                <YAxis stroke="var(--color-text-muted)" fontSize={10} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-border)',
                    borderRadius: '6px',
                    fontSize: '12px',
                    color: 'var(--color-text-primary)',
                  }}
                  formatter={(val: any) => [`$${val}k`, '']}
                />
                <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="actual" name="Actual MTD" fill="var(--color-accent)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="budget" name="Approved Budget" fill="var(--color-text-muted)" radius={[2, 2, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Bank Accounts Breakdown */}
        <div className="col-span-12 lg:col-span-4 p-3.5 sm:p-5 bg-surface border border-border rounded-md flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between border-b border-border pb-3 mb-4">
              <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
                <Building className="w-4 h-4 text-accent" />
                <span>Bank Balances</span>
              </h2>
              <button
                type="button"
                onClick={() => navigate(`/${coSlug}/banking`)}
                className="text-xs text-accent hover:underline cursor-pointer"
              >
                Manage
              </button>
            </div>

            <div className="flex flex-col gap-3">
              {bankAccounts.map((b) => {
                const bookBal = balanceOf(b.account_id);
                const unrecCount = bankStatementLines.filter(
                  (l) => l.bank_account_id === b.id && l.status === 'unmatched'
                ).length;

                return (
                  <div
                    key={b.id}
                    onClick={() => navigate(`/${coSlug}/banking/${b.id}/reconcile`)}
                    className="p-3 rounded-md border border-border hover:border-accent/60 bg-surface-neutral/30 cursor-pointer transition-colors flex flex-col gap-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-xs text-text-primary">{b.name}</span>
                      <span className="font-mono text-[11px] text-text-muted">{b.account_number_masked}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold font-mono text-num text-text-primary">
                        {formatMoney(bookBal, b.currency)}
                      </span>
                      {unrecCount > 0 ? (
                        <span className="text-[10px] font-medium text-danger bg-danger-soft px-1.5 py-0.2 rounded">
                          {unrecCount} unmatched
                        </span>
                      ) : (
                        <span className="text-[10px] font-medium text-success bg-success-soft px-1.5 py-0.2 rounded">
                          Reconciled
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="p-3 rounded-sm bg-accent-soft/60 border border-accent/20 mt-4 text-[11px] text-text-secondary">
            <strong>Controls Notice:</strong> Bank feeds import automatically at 06:00 UTC. Daily variance check completed with zero unassigned exceptions.
          </div>
        </div>
      </div>

      {/* Recent Activity / Controls Audit Trail (12-column, 1px border, no shadow) */}
      <div className="p-3.5 sm:p-5 bg-surface border border-border rounded-md">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-2 border-b border-border pb-3 mb-3">
          <h2 className="text-[13px] font-semibold text-text-primary flex items-center gap-2">
            <Activity className="w-4 h-4 text-accent" />
            <span>Controls Activity & Immutable Audit Log</span>
          </h2>
          <span className="text-[11px] sm:text-xs text-text-muted font-mono">Cryptographically Hash-Chained</span>
        </div>

        <div className="divide-y divide-border">
          {auditEvents.slice(0, 4).map((evt) => (
            <div key={evt.id} className="py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1 sm:gap-4 text-xs">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <FileCheck2 className="w-3.5 h-3.5 text-accent shrink-0" />
                <span className="text-text-primary truncate">{evt.detail}</span>
              </div>
              <div className="flex items-center gap-2 sm:gap-4 text-text-muted shrink-0 text-[11px] self-end sm:self-auto">
                <span className="font-mono text-[10px] sm:text-[11px]">{formatDateTime(evt.occurred_at)}</span>
                <span className="font-mono text-[9px] sm:text-[10px] bg-surface-neutral px-1.5 py-0.5 rounded text-text-secondary border border-border">
                  {evt.actor_name}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
