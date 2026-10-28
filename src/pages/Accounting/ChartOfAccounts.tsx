import React, { useState } from 'react';
import { useLedgerStore } from '@/mock/store';
import { Account } from '@/types';
import { formatMoney } from '@/lib/format';
import { BookMarked, Plus, Search, Tag, ShieldCheck } from 'lucide-react';

export const ChartOfAccounts: React.FC = () => {
  const { currentCompany, accounts, balanceOf } = useLedgerStore();
  const [filterType, setFilterType] = useState('all');
  const [search, setSearch] = useState('');

  const accountTypes = [
    { label: 'All Accounts', value: 'all' },
    { label: 'Assets', value: 'asset' },
    { label: 'Liabilities', value: 'liability' },
    { label: 'Equity', value: 'equity' },
    { label: 'Income', value: 'income' },
    { label: 'Expense', value: 'expense' },
  ];

  const filtered = accounts.filter((a) => {
    const matchesType = filterType === 'all' || a.account_type === filterType;
    const matchesSearch =
      a.code.includes(search) ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.account_subtype.toLowerCase().includes(search.toLowerCase());
    return matchesType && matchesSearch;
  });

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'asset':
        return 'bg-brand-50 text-brand-700 border-brand-200';
      case 'liability':
        return 'bg-warning-bg text-warning border-warning/30';
      case 'equity':
        return 'bg-reversed-bg text-reversed border-reversed/30';
      case 'income':
        return 'bg-success-bg text-success border-success/30';
      case 'expense':
        return 'bg-danger-bg text-danger border-danger/30';
      default:
        return 'bg-ink-100 text-ink-700 border-ink-200';
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-ink-200">
        <div>
          <h1 className="text-h1 font-bold text-ink-900 flex items-center gap-2">
            <BookMarked className="w-6 h-6 text-brand-600" />
            Chart of Accounts
          </h1>
          <p className="text-xs text-ink-500 mt-0.5">
            {currentCompany.name} • General ledger account hierarchy and dimension governance rules
          </p>
        </div>

        <button
          type="button"
          onClick={() => alert('Add Account Dialog')}
          className="flex items-center gap-1.5 h-8 px-3.5 bg-brand-600 hover:bg-brand-700 text-white rounded-sm text-xs font-semibold shadow-sm transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Account</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-ink-100/70 p-1 rounded-sm border border-ink-200">
          {accountTypes.map((tab) => (
            <button
              key={tab.value}
              type="button"
              onClick={() => setFilterType(tab.value)}
              className={`px-3 py-1 rounded-sm text-xs font-medium transition-colors ${
                filterType === tab.value
                  ? 'bg-surface text-ink-900 shadow-sm font-semibold'
                  : 'text-ink-500 hover:text-ink-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-ink-500 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search code, name, classification..."
            className="h-8 pl-8 pr-3 text-xs bg-surface border border-ink-200 rounded-sm text-ink-900 placeholder:text-ink-500 focus:outline-none focus:border-brand-500 w-64"
          />
        </div>
      </div>

      {/* Accounts Dense Table */}
      <div className="bg-surface border border-ink-200 rounded-lg shadow-sm overflow-hidden">
        <table className="w-full border-collapse table-dense text-left text-xs">
          <thead>
            <tr className="bg-ink-100/90 border-b border-ink-200 text-col-header">
              <th className="w-24">Code</th>
              <th>Account Name</th>
              <th className="w-32">Classification</th>
              <th className="w-36">Subtype</th>
              <th className="w-28 text-center">Normal</th>
              <th className="w-36">Dimension Rules</th>
              <th className="w-36 text-right pr-4">Balance (USD)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {filtered.map((acc) => (
              <tr key={acc.id} className="hover:bg-brand-50/50 transition-colors">
                <td className="font-mono font-semibold text-brand-600">{acc.code}</td>
                <td className="font-medium text-ink-900">{acc.name}</td>
                <td>
                  <span
                    className={`text-[10px] font-mono uppercase font-medium px-2 py-0.5 rounded border ${getTypeBadge(
                      acc.account_type
                    )}`}
                  >
                    {acc.account_type}
                  </span>
                </td>
                <td className="text-ink-500">{acc.account_subtype}</td>
                <td className="text-center font-mono uppercase text-[10px] text-ink-500">
                  {acc.normal_balance}
                </td>
                <td>
                  {acc.account_type === 'income' || acc.account_type === 'expense' ? (
                    <span className="text-[10px] text-brand-700 bg-brand-50 border border-brand-100 px-1.5 py-0.2 rounded font-mono font-medium">
                      Branch* Required
                    </span>
                  ) : (
                    <span className="text-[10px] text-ink-500">Optional</span>
                  )}
                </td>
                <td className="text-right font-mono font-semibold text-num text-ink-900 pr-4">
                  {formatMoney(balanceOf(acc.id))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
