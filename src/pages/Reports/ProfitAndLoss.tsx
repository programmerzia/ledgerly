import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerlyStore } from '@/mock/store';
import { formatMoney } from '@/lib/format';
import { BarChart3, Download, Printer, ArrowLeft } from 'lucide-react';

export const ProfitAndLoss: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany } = useLedgerlyStore();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadPL() {
      const res = await api.getProfitAndLoss('Oct 2026');
      setData(res);
      setLoading(false);
    }
    loadPL();
  }, []);

  if (loading || !data) {
    return <div className="p-8 text-center text-xs text-ink-500">Loading Profit & Loss statement...</div>;
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-ink-200">
        <div>
          <h1 className="text-h1 font-bold text-ink-900 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-brand-600" />
            Statement of Profit & Loss (P&L)
          </h1>
          <p className="text-xs text-ink-500 mt-0.5">
            {currentCompany.name} • Month of October 2026
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 h-8 px-3 rounded-sm border border-ink-200 hover:border-ink-300 bg-surface text-ink-700 text-xs font-medium transition-colors"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print</span>
          </button>
          <button
            type="button"
            onClick={() => alert('P&L Exported')}
            className="flex items-center gap-1.5 h-8 px-3 bg-brand-600 hover:bg-brand-700 text-white rounded-sm text-xs font-semibold shadow-sm transition-colors"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* P&L Statement Card */}
      <div className="bg-surface border border-border rounded-md p-6 flex flex-col gap-6 w-full">
        <div className="text-center pb-4 border-b border-border">
          <h2 className="text-base font-bold text-text-primary">{currentCompany.legal_name}</h2>
          <div className="text-xs text-text-muted mt-1">Income Statement for Period Ended October 31, 2026</div>
          <div className="text-[11px] font-mono text-text-muted">Presentation Currency: USD • Accrual Basis</div>
        </div>

        {/* Operating Revenue */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted border-b border-border pb-1">
            Operating Revenue
          </span>
          <div className="divide-y divide-border text-xs">
            {data.revenue.map((acc: any) => (
              <div
                key={acc.id}
                onClick={() => navigate(`/${currentCompany.slug}/reports/general-ledger?account=${acc.code}`)}
                className="py-2 px-2 flex items-center justify-between hover:bg-surface-neutral rounded cursor-pointer group transition"
                title="Click to view underlying GL transactions"
              >
                <span className="text-text-primary group-hover:underline">
                  <strong className="font-mono text-accent mr-2">{acc.code}</strong>
                  {acc.name}
                </span>
                <span className="font-mono text-num text-text-primary">{formatMoney(acc.balance, 'USD', { parenthesesNegative: true })}</span>
              </div>
            ))}
            <div className="py-2.5 px-3 flex items-center justify-between font-semibold text-xs bg-surface-neutral rounded-sm mt-1 border-t border-border">
              <span className="text-text-primary">Total Operating Revenue:</span>
              <span className="font-mono text-num text-accent">{formatMoney(data.totalRevenue, 'USD', { parenthesesNegative: true })}</span>
            </div>
          </div>
        </div>

        {/* Operating Expenses */}
        <div className="flex flex-col gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-text-muted border-b border-border pb-1">
            Operating Expenses
          </span>
          <div className="divide-y divide-border text-xs">
            {data.expenses.map((acc: any) => (
              <div
                key={acc.id}
                onClick={() => navigate(`/${currentCompany.slug}/reports/general-ledger?account=${acc.code}`)}
                className="py-2 px-2 flex items-center justify-between hover:bg-surface-neutral rounded cursor-pointer group transition"
                title="Click to view underlying GL transactions"
              >
                <span className="text-text-primary group-hover:underline">
                  <strong className="font-mono text-accent mr-2">{acc.code}</strong>
                  {acc.name}
                </span>
                <span className="font-mono text-num text-text-primary">{formatMoney(acc.balance, 'USD', { parenthesesNegative: true })}</span>
              </div>
            ))}
            <div className="py-2.5 px-3 flex items-center justify-between font-semibold text-xs bg-surface-neutral rounded-sm mt-1 border-t border-border">
              <span className="text-text-primary">Total Operating Expenses:</span>
              <span className="font-mono text-num text-danger">{formatMoney(data.totalExpense, 'USD', { parenthesesNegative: true })}</span>
            </div>
          </div>
        </div>

        {/* Net Operating Income with Double Rule */}
        <div className="p-4 bg-surface-neutral/60 border-t-2 border-b-4 border-double border-border rounded-sm flex items-center justify-between font-semibold text-sm">
          <span className="text-text-primary uppercase tracking-wide">Net Operating Income:</span>
          <span className="font-mono text-base font-bold text-accent">{formatMoney(data.netIncome, 'USD', { parenthesesNegative: true })}</span>
        </div>
      </div>
    </div>
  );
};
