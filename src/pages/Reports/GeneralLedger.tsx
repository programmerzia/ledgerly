import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { ReportShell, ReportParameters } from './ReportShell';
import { formatMoney } from '@/lib/format';
import { Account } from '@/types';
import { BookOpen, ExternalLink, Calendar } from 'lucide-react';

export const GeneralLedger: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, accounts, movements, openTab } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.id || 'acc-1010');
  const [parameters, setParameters] = useState<ReportParameters>({
    periodFrom: 'per-2026-01',
    periodTo: 'per-2026-10',
    comparison: 'none',
    pivotDimension: 'none',
    hideZeroRows: false,
    presentationCurrency: 'USD',
    levelOfDetail: 'detailed',
  });

  const selectedAccount = useMemo(() => {
    return accounts.find((a) => a.id === selectedAccountId) || accounts[0];
  }, [accounts, selectedAccountId]);

  // Movements with running balance
  const lines = useMemo(() => {
    if (!selectedAccount) return [];
    return movements(selectedAccount.id);
  }, [selectedAccount, movements]);

  const handleOpenJournal = (journalNumber: string) => {
    openTab({
      id: `journal-${journalNumber}`,
      title: journalNumber,
      url: `/${coSlug}/journals`,
      type: 'journal',
    });
    navigate(`/${coSlug}/journals`);
  };

  return (
    <ReportShell
      title="General Ledger Account Detail"
      subtitle={`${currentCompany.legal_name} • Full Audit History & Running Balances`}
      parameters={parameters}
      onParametersChange={setParameters}
    >
      <div className="w-full flex flex-col gap-5">
        {/* Account Selector */}
        <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex items-center justify-between text-xs">
          <div className="flex items-center gap-3">
            <BookOpen className="w-4 h-4 text-brand-teal" />
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-semibold text-ink-muted uppercase">
                Select General Ledger Account
              </label>
              <select
                value={selectedAccountId}
                onChange={(e) => setSelectedAccountId(e.target.value)}
                className="h-8 px-2.5 rounded-sm border border-line-border bg-surface-subtle font-mono text-xs text-ink-900 font-medium min-w-[320px]"
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.code} — {a.name} ({a.account_type.toUpperCase()})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-ink-muted block">
              Closing Balance ({selectedAccount?.normal_balance.toUpperCase()} Normal)
            </span>
            <span className="text-lg font-bold font-mono text-num text-brand-teal">
              {formatMoney(lines[lines.length - 1]?.running_balance || 0)}
            </span>
          </div>
        </div>

        {/* Ledger Detail Table */}
        <div className="border border-line-border rounded-md overflow-hidden bg-surface-elevated shadow-2xs text-xs">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="h-9 bg-surface-neutral border-b border-line-border text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                <th className="px-3">Date</th>
                <th className="px-3">Journal #</th>
                <th className="px-3">Description</th>
                <th className="px-3">Branch</th>
                <th className="px-3 text-right">Debit</th>
                <th className="px-3 text-right">Credit</th>
                <th className="px-3 text-right font-bold text-ink-900">Running Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-border">
              {lines.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-ink-muted">
                    No posted ledger transactions found for this account.
                  </td>
                </tr>
              ) : (
                lines.map((l) => (
                  <tr
                    key={l.id}
                    onClick={() => handleOpenJournal(l.journal_number)}
                    className="h-9 hover:bg-surface-neutral cursor-pointer transition"
                  >
                    <td className="px-3 font-mono text-[11px] text-ink-muted whitespace-nowrap">
                      {l.journal_date}
                    </td>
                    <td className="px-3 font-mono font-medium text-brand-teal whitespace-nowrap flex items-center gap-1">
                      <span>{l.journal_number}</span>
                      <ExternalLink className="w-2.5 h-2.5 opacity-50" />
                    </td>
                    <td className="px-3 text-ink-900 truncate max-w-xs">{l.description}</td>
                    <td className="px-3 font-mono text-[11px] text-ink-muted">
                      {l.dimensions?.branch || 'HQ'}
                    </td>
                    <td className="px-3 text-right font-mono text-num text-ink-900">
                      {l.debit > 0 ? formatMoney(l.debit) : '—'}
                    </td>
                    <td className="px-3 text-right font-mono text-num text-ink-900">
                      {l.credit > 0 ? formatMoney(l.credit) : '—'}
                    </td>
                    <td className="px-3 text-right font-mono text-num font-semibold text-ink-900">
                      {formatMoney(l.running_balance)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </ReportShell>
  );
};
