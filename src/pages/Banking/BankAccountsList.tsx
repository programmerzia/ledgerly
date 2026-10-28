import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { BankAccount, BankStatementLine } from '@/types';
import { formatMoney, formatDate } from '@/lib/format';
import { StatusPill } from '@/components/domain/StatusPill';
import {
  CreditCard,
  Building,
  ShieldCheck,
  ArrowRight,
  Plus,
  Layers,
  Calendar,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { toast } from 'sonner';

export const BankAccountsList: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, bankAccounts, balanceOf, bankStatementLines, addBankAccount } =
    useLedgerStore();
  const coSlug = currentCompany.slug;

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedBankId, setSelectedBankId] = useState<string | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    bank_name: '',
    account_number: '',
    currency: currentCompany.base_currency,
    opening_balance: 0,
    account_id: 'acc-1010',
  });

  const selectedBank = bankAccounts.find((b) => b.id === selectedBankId) || null;

  // Statement lines for selected bank account
  const bankLines = selectedBank
    ? bankStatementLines.filter((l: BankStatementLine) => l.bank_account_id === selectedBank.id)
    : [];

  const handleOpenAddModal = () => {
    setFormData({
      name: '',
      bank_name: '',
      account_number: '',
      currency: currentCompany.base_currency,
      opening_balance: 0,
      account_id: 'acc-1010',
    });
    setIsAddModalOpen(true);
  };

  const handleCreateBankAccount = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim() || !formData.bank_name.trim()) {
      toast.error('Account name and bank name are required');
      return;
    }

    const last4 = formData.account_number.slice(-4) || '1234';
    const newBank: BankAccount = {
      id: `bnk-${Date.now()}`,
      company_id: currentCompany.id,
      name: formData.name.trim(),
      bank_name: formData.bank_name.trim(),
      account_number_masked: `•••• ${last4}`,
      currency: formData.currency,
      account_id: formData.account_id,
      kind: 'bank',
      last_statement_balance: Number(formData.opening_balance) || 0,
    };

    addBankAccount(newBank);
    toast.success(`Bank account "${newBank.name}" added successfully`);
    setIsAddModalOpen(false);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Page Header */}
      <div className="flex items-center justify-between pb-3 border-b border-border">
        <div>
          <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-accent" />
            Bank & Cash Accounts
          </h1>
          <p className="text-xs text-text-muted mt-0.5">
            {currentCompany.name} • Treasury, operating accounts & statement reconciliation feeds
          </p>
        </div>

        <button
          type="button"
          onClick={handleOpenAddModal}
          className="flex items-center gap-1.5 h-8 px-3.5 bg-accent hover:bg-accent-hover text-white rounded-sm text-xs font-semibold shadow-xs transition"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add Bank Account</span>
        </button>
      </div>

      {/* Account Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        {bankAccounts.map((b) => {
          const bookBalance = balanceOf(b.account_id);
          const unreconciledCount = bankStatementLines.filter(
            (l) => l.bank_account_id === b.id && l.status === 'unmatched'
          ).length;

          return (
            <div
              key={b.id}
              onClick={() => setSelectedBankId(b.id)}
              className="p-5 bg-surface border border-border hover:border-border-strong rounded-lg shadow-2xs hover:shadow-xs transition cursor-pointer flex flex-col justify-between gap-5 group"
            >
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-md bg-accent-soft text-accent flex items-center justify-center font-bold">
                      <Building className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-semibold text-text-primary group-hover:text-accent transition">
                        {b.name}
                      </h3>
                      <div className="text-xs text-text-muted">
                        {b.bank_name} • {b.account_number_masked}
                      </div>
                    </div>
                  </div>
                  <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-surface-neutral text-text-secondary border border-border">
                    {b.currency}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 mt-3 p-3 bg-surface-neutral/60 rounded-md border border-border font-mono text-xs">
                  <div>
                    <span className="text-[10px] text-text-muted uppercase font-sans font-medium block">
                      Book Balance
                    </span>
                    <div className="font-bold text-text-primary text-sm mt-0.5">
                      {formatMoney(bookBalance, b.currency)}
                    </div>
                  </div>
                  <div>
                    <span className="text-[10px] text-text-muted uppercase font-sans font-medium block">
                      Last Statement
                    </span>
                    <div className="font-bold text-text-primary text-sm mt-0.5">
                      {formatMoney(b.last_statement_balance, b.currency)}
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-border">
                <div className="flex items-center gap-2">
                  {unreconciledCount > 0 ? (
                    <span className="text-xs font-medium text-warning bg-warning-soft px-2 py-0.5 rounded-full border border-warning/30 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" />
                      {unreconciledCount} unreconciled lines
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-success bg-success-soft px-2 py-0.5 rounded-full flex items-center gap-1 border border-success/30">
                      <ShieldCheck className="w-3.5 h-3.5" />
                      Reconciled
                    </span>
                  )}
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(`/${coSlug}/banking/${b.id}/reconcile`);
                  }}
                  className="flex items-center gap-1.5 h-8 px-3 bg-surface hover:bg-surface-neutral text-text-primary border border-border rounded-sm text-xs font-semibold shadow-2xs transition"
                >
                  <span>Reconcile</span>
                  <ArrowRight className="w-3.5 h-3.5 text-accent" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Detail Drawer on Bank Account Card Click */}
      <Sheet open={Boolean(selectedBank)} onOpenChange={(open) => !open && setSelectedBankId(null)}>
        {selectedBank && (
          <SheetContent className="w-full sm:max-w-xl overflow-y-auto flex flex-col justify-between">
            <div className="flex flex-col gap-5">
              <SheetHeader className="border-b border-border pb-4">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-accent bg-accent-soft px-2 py-0.5 rounded">
                    {selectedBank.currency}
                  </span>
                  <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                    Operating Bank Feed
                  </span>
                </div>
                <SheetTitle className="text-xl font-bold text-text-primary mt-1">
                  {selectedBank.name}
                </SheetTitle>
                <SheetDescription className="text-xs text-text-muted">
                  {selectedBank.bank_name} • Account {selectedBank.account_number_masked} • Linked GL Account #1010
                </SheetDescription>
              </SheetHeader>

              {/* Balances Card */}
              <div className="grid grid-cols-2 gap-3 p-3.5 rounded-md bg-surface-neutral/60 border border-border font-mono text-xs">
                <div>
                  <span className="text-[10px] text-text-muted uppercase font-sans font-medium block">
                    Current Book Balance
                  </span>
                  <div className="font-bold text-text-primary text-base mt-1">
                    {formatMoney(balanceOf(selectedBank.account_id), selectedBank.currency)}
                  </div>
                </div>
                <div>
                  <span className="text-[10px] text-text-muted uppercase font-sans font-medium block">
                    Last Statement Balance
                  </span>
                  <div className="font-bold text-text-primary text-base mt-1">
                    {formatMoney(selectedBank.last_statement_balance, selectedBank.currency)}
                  </div>
                </div>
              </div>

              {/* Statement Feeds Stream */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-text-primary flex items-center justify-between">
                  <span>Recent Statement Lines ({bankLines.length})</span>
                  <span className="text-[11px] text-text-muted">Direct Electronic Bank Feed</span>
                </span>

                <div className="border border-border rounded-md overflow-hidden bg-surface">
                  <table className="w-full text-left text-xs table-dense">
                    <thead className="bg-surface-neutral border-b border-border text-[11px] font-semibold text-text-muted uppercase">
                      <tr>
                        <th className="px-2.5 py-1.5">Date</th>
                        <th className="px-2.5 py-1.5">Description</th>
                        <th className="px-2 py-1.5 text-right">Amount</th>
                        <th className="px-2.5 py-1.5 text-center">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {bankLines.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-text-muted">
                            No imported statement lines for this account.
                          </td>
                        </tr>
                      ) : (
                        bankLines.map((line) => (
                          <tr key={line.id} className="hover:bg-surface-neutral/40">
                            <td className="px-2.5 py-1.5 font-mono text-text-muted text-[11px]">
                              {formatDate(line.txn_date)}
                            </td>
                            <td className="px-2.5 py-1.5 truncate max-w-[180px] text-text-primary">
                              {line.description}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono font-medium text-text-primary">
                              {formatMoney(line.amount, selectedBank.currency)}
                            </td>
                            <td className="px-2.5 py-1.5 text-center">
                              <StatusPill status={line.status} />
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <SheetFooter className="mt-6 flex items-center justify-between sm:justify-between w-full">
              <button
                type="button"
                onClick={() => setSelectedBankId(null)}
                className="h-8 px-3 rounded-sm border border-border text-text-muted hover:text-text-primary text-xs font-medium hover:bg-surface-neutral transition"
              >
                Close
              </button>
              <button
                type="button"
                onClick={() => {
                  const bId = selectedBank.id;
                  setSelectedBankId(null);
                  navigate(`/${coSlug}/banking/${bId}/reconcile`);
                }}
                className="flex items-center gap-1.5 h-8 px-3.5 bg-accent hover:bg-accent-hover text-white rounded-sm text-xs font-semibold shadow-xs transition"
              >
                <span>Open Reconciliation Workspace</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </SheetFooter>
          </SheetContent>
        )}
      </Sheet>

      {/* Add Bank Account Dialog */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-[480px] p-5">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-accent" />
              Add Bank or Cash Account
            </DialogTitle>
            <DialogDescription className="text-xs text-text-muted">
              Connect a treasury account and map it to a general ledger asset code.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateBankAccount} className="flex flex-col gap-3 py-2 text-xs">
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-text-secondary">
                Account Display Name <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Premier Bank Operating Account"
                className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary focus:outline-none focus:border-accent"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">
                  Bank Institution <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.bank_name}
                  onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                  placeholder="e.g. Premier Bank"
                  className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">
                  Account Number (Last 4)
                </label>
                <input
                  type="text"
                  maxLength={4}
                  value={formData.account_number}
                  onChange={(e) => setFormData({ ...formData, account_number: e.target.value })}
                  placeholder="e.g. 8821"
                  className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary font-mono focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">
                  Currency
                </label>
                <select
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                  className="h-8 px-2 rounded-sm border border-border bg-surface text-text-primary font-mono focus:outline-none focus:border-accent"
                >
                  <option value="USD">USD — US Dollar</option>
                  <option value="SOS">SOS — Somali Shilling</option>
                  <option value="KES">KES — Kenyan Shilling</option>
                  <option value="EUR">EUR — Euro</option>
                  <option value="GBP">GBP — British Pound</option>
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">
                  Linked GL Account
                </label>
                <select
                  value={formData.account_id}
                  onChange={(e) => setFormData({ ...formData, account_id: e.target.value })}
                  className="h-8 px-2 rounded-sm border border-border bg-surface text-text-primary font-mono focus:outline-none focus:border-accent"
                >
                  <option value="acc-1010">1010 — Operating Bank Account</option>
                  <option value="acc-1020">1020 — Petty Cash</option>
                  <option value="acc-1030">1030 — USD Treasury Holding</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-text-secondary">
                Opening Statement Balance ($)
              </label>
              <input
                type="number"
                step="100"
                value={formData.opening_balance / 100}
                onChange={(e) => setFormData({ ...formData, opening_balance: Number(e.target.value) * 100 })}
                className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary font-mono text-right focus:outline-none focus:border-accent"
              />
            </div>

            <DialogFooter className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="h-8 px-3 rounded-sm border border-border text-text-muted hover:text-text-primary text-xs font-medium hover:bg-surface-neutral transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-8 px-3.5 bg-accent hover:bg-accent-hover text-white rounded-sm text-xs font-semibold shadow-xs transition"
              >
                Connect Account
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
