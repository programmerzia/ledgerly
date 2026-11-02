import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { useAccounts, useAccountActions, useAccountBalances } from '@/data/accounts';
import { IS_LIVE } from '@/api/config';
import { describeError } from '@/api/messages';
import { toApiDate } from '@/api/adapters/dates';
import { Handled, describeProblem } from '@/api/live/writeProblems';
import { Account } from '@/types';
import { CoaGroupedTable, TypePill, type CoaAction } from './CoaGroupedTable';
import { SplitPane } from '@/components/domain/SplitPane';
import { formatMoney } from '@/lib/format';
import { Plus, Layers, ShieldCheck, Tag, FileText, Pencil, ListPlus, Ban, Tags } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { EmptyState } from '@/components/domain/EmptyState';
import { Kbd } from '@/components/ui/kbd';
import { AccountDimensionRules } from './AccountDimensionRules';
import { AccountDialog, DeactivateAccountDialog, type AccountDialogMode } from './AccountDialogs';
import { toast } from 'sonner';

export const ChartOfAccounts: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, balanceOf, journals, uiDensity, openTab } = useLedgerStore();
  const { data: accounts, isLoading, error, refetch } = useAccounts();
  const actions = useAccountActions();
  // Live mode: accounts, edits, deactivation, rules and the manual-journal switch are the API's. Not wired yet, so
  // hidden rather than faked: the per-row balance column and subtotals (browser arithmetic on money), recent
  // postings, and the ledger drill-down (those reports are other steps).
  const live = IS_LIVE;
  // `can` hints decide; the list has no "can create" hint, so use the update hint of the accounts we can see.
  const canManage = !live || accounts.length === 0 || accounts.some((a) => a.can?.update);
  const asOf = useMemo(() => toApiDate(new Date()), []);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const balances = useAccountBalances(live && selectedAccountId !== null, asOf);
  const [problem, setProblem] = useState<string | null>(null);
  const [dialog, setDialog] = useState<AccountDialogMode | null>(null);
  const [deactivating, setDeactivating] = useState<Account | null>(null);
  const coSlug = currentCompany.slug;

  const handleOpenDrillDown = (account: Account) => {
    openTab({
      id: `gl-account-${account.code}`,
      title: `${account.code} Ledger`,
      url: `/${coSlug}/reports/general-ledger?account=${account.code}`,
      type: 'report',
    });
    navigate(`/${coSlug}/reports/general-ledger?account=${account.code}`);
  };

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
      if (canManage && e.key.toLowerCase() === 'n' && !typing && !e.ctrlKey && !e.metaKey && !e.altKey && !dialog && !deactivating) {
        e.preventDefault();
        setDialog({ kind: 'new' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog, deactivating, canManage]);

  const rowActions = (a: Account): CoaAction[] => {
    if (live) {
      const can = a.can?.update === true;
      return [
        { label: 'Edit', icon: Pencil, onClick: () => setDialog({ kind: 'edit', account: a }), disabled: !can, disabledReason: !can ? 'You do not have permission to change accounts' : undefined },
        { label: 'Add sub-account', icon: ListPlus, onClick: () => setDialog({ kind: 'sub', parent: a }), disabled: !can, disabledReason: !can ? 'You do not have permission to change accounts' : undefined },
        {
          label: 'Deactivate',
          icon: Ban,
          destructive: true,
          onClick: () => setDeactivating(a),
          disabled: !a.is_active || a.can?.deactivate !== true,
          disabledReason: !a.is_active ? 'Already inactive' : a.can?.deactivate !== true ? 'You cannot deactivate this account' : undefined,
        },
      ];
    }
    const bal = balanceOf(a.id);
    return [
      { label: 'View ledger', icon: FileText, onClick: () => handleOpenDrillDown(a) },
      { label: 'Edit', icon: Pencil, onClick: () => setDialog({ kind: 'edit', account: a }) },
      { label: 'Add sub-account', icon: ListPlus, onClick: () => setDialog({ kind: 'sub', parent: a }) },
      {
        label: 'Deactivate',
        icon: Ban,
        destructive: true,
        onClick: () => setDeactivating(a),
        disabled: !a.is_active || bal !== 0,
        disabledReason: !a.is_active ? 'Already inactive' : bal !== 0 ? 'Only accounts with a zero balance can be deactivated' : undefined,
      },
    ];
  };

  const selectedAccount = useMemo(() => {
    return accounts.find((a) => a.id === selectedAccountId) || null;
  }, [accounts, selectedAccountId]);

  // Find recent journal lines for this account
  const recentPostings = useMemo(() => {
    if (!selectedAccount) return [];
    const lines: { date: string; memo: string; debit: number; credit: number; journalNumber: string }[] = [];
    journals.forEach((j) => {
      j.lines.forEach((l) => {
        if (l.account_id === selectedAccount.id) {
          lines.push({
            date: j.journal_date,
            memo: j.memo,
            debit: l.debit,
            credit: l.credit,
            journalNumber: j.number || 'DRAFT',
          });
        }
      });
    });
    return lines.slice(-5).reverse();
  }, [selectedAccount, journals]);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Chart of accounts"
        subtitle={`${currentCompany.name} · the list of accounts your books are organised by`}
        actions={
          <>
            {live && (
              <button
                type="button"
                onClick={() => navigate(`/${coSlug}/dimensions`)}
                className="flex items-center gap-1.5 h-8 px-3 border border-border bg-surface hover:bg-surface-neutral rounded-md text-[13px] font-medium text-text-primary transition-colors cursor-pointer"
              >
                <Tags className="w-4 h-4 text-text-muted" />
                <span>Dimensions</span>
              </button>
            )}
            {canManage && (
              <button
                type="button"
                onClick={() => setDialog({ kind: 'new' })}
                className="flex items-center gap-1.5 h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded-md text-[13px] font-medium transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>New account</span>
                <Kbd className="ml-1 border-white/30 bg-white/20 text-white">N</Kbd>
              </button>
            )}
          </>
        }
      />
      <AccountDialog mode={dialog} onClose={() => setDialog(null)} />
      <DeactivateAccountDialog account={deactivating} onClose={() => setDeactivating(null)} />

      {/* Main SplitPane Layout */}
      <SplitPane
        storageKey="ledgerly_accounts_split_width"
        isOpen={Boolean(selectedAccount)}
        onClose={() => setSelectedAccountId(null)}
        title={selectedAccount ? `${selectedAccount.code} - ${selectedAccount.name}` : 'Account details'}
        subtitle={
          selectedAccount
            ? `Normal side: ${selectedAccount.normal_balance} · Subtype: ${selectedAccount.account_subtype}`
            : undefined
        }
        icon={<Layers className="w-4 h-4" />}
        onOpenFull={live ? undefined : () => selectedAccount && handleOpenDrillDown(selectedAccount)}
        openFullLabel="Open ledger"
        badge={
          selectedAccount ? (
            <TypePill type={selectedAccount.account_type} />
          ) : undefined
        }
        detailContent={
          selectedAccount && (
            <div className="flex flex-col gap-4 text-xs">
              {/* Account Meta */}
              <div className="p-3 bg-surface-neutral/60 border border-border rounded-md flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="font-code font-semibold text-text-primary text-sm">{selectedAccount.code}</span>
                  <span className="text-[11px] text-text-muted capitalize">
                    Normal side: {selectedAccount.normal_balance}
                  </span>
                </div>
                <div className="font-semibold text-text-primary text-sm">{selectedAccount.name}</div>
                <p className="text-text-muted text-[11px] leading-relaxed">
                  Classification: {selectedAccount.account_type}, {selectedAccount.account_subtype}
                </p>
              </div>

              {/* Balance KPI */}
              {live && (
                <div className="p-3 rounded-md bg-accent/5 border border-accent/20 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] text-text-muted block">Balance</span>
                    {balances.isLoading ? (
                      <span className="text-[11px] text-text-muted mt-0.5 block" role="status">Loading balance…</span>
                    ) : balances.error ? (
                      <span className="text-[11px] text-danger mt-0.5 block" role="alert">
                        {describeError(balances.error)}{' '}
                        <button type="button" onClick={balances.refetch} className="text-accent hover:underline cursor-pointer">Try again</button>
                      </span>
                    ) : (
                      <div className="mt-0.5 flex items-baseline gap-4 font-mono text-text-primary">
                        {(() => {
                          const b = balances.data[selectedAccount.id];
                          if (!b) return <span className="text-sm text-text-muted">—</span>;
                          return (
                            <>
                              <span className="text-sm"><span className="mr-1 font-sans text-[10px] text-text-muted">Debit</span>{formatMoney(b.debit, b.currency)}</span>
                              <span className="text-sm"><span className="mr-1 font-sans text-[10px] text-text-muted">Credit</span>{formatMoney(b.credit, b.currency)}</span>
                            </>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                  <span className="text-[10px] text-text-muted">As of {asOf}</span>
                </div>
              )}
              {!live && <div className="p-3 rounded-md bg-accent/5 border border-accent/20 flex items-center justify-between">
                <div>
                  <span className="text-[10px] text-text-muted block">Balance</span>
                  <span className="font-mono font-semibold text-text-primary text-base mt-0.5 block">
                    {formatMoney(balanceOf(selectedAccount.id), currentCompany.base_currency)}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-accent text-[11px] font-medium font-mono">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Live balance</span>
                </div>
              </div>}

              {/* Dimension Rules */}
              {live && <AccountDimensionRules account={selectedAccount} />}
              {!live && <div className="p-3 bg-surface border border-border rounded-md flex flex-col gap-1.5">
                <span className="text-[10px] font-semibold text-text-muted flex items-center gap-1">
                  <Tag className="w-3 h-3 text-accent" />
                  Dimension rules
                </span>
                <p className="text-[11px] text-text-secondary leading-relaxed">
                  {selectedAccount.account_type === 'income' || selectedAccount.account_type === 'expense'
                    ? 'Branch dimension is mandatory for all postings. Cost center is optional.'
                    : 'Standard balance sheet account. Dimension allocation optional.'}
                </p>
              </div>}

              {/* Manual journals toggle */}
              <div className="p-3 bg-surface border border-border rounded-md flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex flex-col">
                    <span className="text-[11px] font-semibold text-text-primary">
                      Allow manual journals
                    </span>
                    <span className="text-[10px] text-text-muted">
                      {selectedAccount.control_type && ['ar', 'ap', 'bank'].includes(selectedAccount.control_type)
                        ? 'Control account: direct manual postings prohibited unless enabled here.'
                        : 'Enables direct debit/credit entry via Manual Journal form.'}
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(selectedAccount.allow_manual_journals)}
                    disabled={live && selectedAccount.can?.update !== true}
                    onChange={(e) => {
                      const isChecked = e.target.checked;
                      setProblem(null);
                      actions
                        .setAllowManual(selectedAccount, isChecked)
                        .then(() =>
                          toast.success(
                            `Updated ${selectedAccount.code}: Allow manual journals set to ${isChecked ? 'Allowed' : 'Prohibited'}`
                          ),
                        )
                        .catch((err) => {
                          if (!(err instanceof Handled)) setProblem(describeProblem(err));
                        });
                    }}
                    className="h-4 w-4 rounded text-accent focus:ring-accent cursor-pointer"
                  />
                </div>
              </div>

              {problem && <p className="text-[11px] text-danger" role="alert">{problem}</p>}

              {/* Recent Activity */}
              {!live && <div className="flex flex-col gap-1.5">
                <span className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-text-muted" />
                  Recent postings ({recentPostings.length})
                </span>
                {recentPostings.length === 0 ? (
                  <p className="text-text-muted text-[11px] p-2 bg-surface-neutral/40 rounded border border-border">
                    No postings in the active period.
                  </p>
                ) : (
                  <div className="border border-border rounded-md overflow-hidden bg-surface">
                    <table className="w-full text-left text-xs table-dense">
                      <thead className="bg-surface-neutral border-b border-border text-[11px] font-semibold text-text-muted uppercase">
                        <tr>
                          <th className="px-2 py-1">Date</th>
                          <th className="px-2 py-1">Journal</th>
                          <th className="px-2 py-1 text-right">Debit</th>
                          <th className="px-2 py-1 text-right">Credit</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {recentPostings.map((p, idx) => (
                          <tr key={idx} className="hover:bg-surface-neutral/40">
                            <td className="px-2 py-1 font-mono text-[10px] text-text-muted">{p.date}</td>
                            <td className="px-2 py-1 font-mono text-[10px] text-accent">{p.journalNumber}</td>
                            <td className="px-2 py-1 text-right font-mono text-[10px] text-text-primary">
                              {p.debit > 0 ? formatMoney(p.debit) : '—'}
                            </td>
                            <td className="px-2 py-1 text-right font-mono text-[10px] text-text-primary">
                              {p.credit > 0 ? formatMoney(p.credit) : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>}
            </div>
          )
        }
      >
        {isLoading ? (
          <p className="p-4 text-[13px] text-text-muted" role="status">Loading accounts…</p>
        ) : error ? (
          <div className="p-4 text-[13px] text-danger" role="alert">
            {describeError(error)}{' '}
            <button type="button" onClick={refetch} className="text-accent hover:underline cursor-pointer">Try again</button>
          </div>
        ) : live && accounts.length === 0 ? (
          <EmptyState
            icon={Layers}
            title="No accounts yet"
            description="Your chart of accounts is empty. Add your first account, or apply a chart template from the setup guide."
            actionLabel={canManage ? 'New account' : undefined}
            onAction={canManage ? () => setDialog({ kind: 'new' }) : undefined}
          />
        ) : (
        <CoaGroupedTable
          accounts={accounts}
          currency={currentCompany.base_currency}
          balanceOf={live ? undefined : balanceOf}
          activeId={selectedAccountId}
          rowHeightClass={uiDensity === 'compact' ? 'h-8' : uiDensity === 'comfortable' ? 'h-10' : 'h-9'}
          onSelect={(row) => setSelectedAccountId(row.id)}
          onOpen={live ? () => {} : handleOpenDrillDown}
          rowActions={rowActions}
        />
        )}
      </SplitPane>
    </div>
  );
};
