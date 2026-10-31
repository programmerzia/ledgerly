import React, { useState } from 'react';
import { useLedgerStore } from '@/mock/store';
import { formatMoney } from '@/lib/format';
import { FieldHelp } from '@/components/domain/FieldHelp';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

import { toast } from 'sonner';

interface BankTransferDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BankTransferDialog: React.FC<BankTransferDialogProps> = ({
  isOpen,
  onClose,
}) => {
  const { currentCompany, currentUser, bankAccounts, accounts, companySettings, postJournalDirect } =
    useLedgerStore();

  const [fromBankId, setFromBankId] = useState(bankAccounts[0]?.id || 'bnk-1');
  const [toBankId, setToBankId] = useState(bankAccounts[1]?.id || 'bnk-2');
  const [amountFc, setAmountFc] = useState(500000); // $5,000.00
  const [transferDate, setTransferDate] = useState('2026-10-28');
  const [reference, setReference] = useState('TRF-2026-004');
  const [memo, setMemo] = useState('Treasury operational liquidity rebalancing');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fromBank = bankAccounts.find((b) => b.id === fromBankId);
  const toBank = bankAccounts.find((b) => b.id === toBankId);

  const fromAccount = accounts.find((a) => a.id === fromBank?.account_id) || accounts.find((a) => a.code === '1010');
  const toAccount = accounts.find((a) => a.id === toBank?.account_id) || accounts.find((a) => a.code === '1020');
  const inTransitAccount = accounts.find((a) => a.code === '1090') || accounts.find((a) => a.code === '9999');

  const handleExecuteTransfer = async () => {
    if (fromBankId === toBankId) {
      toast.error('Choose two different accounts');
      return;
    }
    if (amountFc <= 0) {
      toast.error('Enter an amount above zero');
      return;
    }

    try {
      setIsSubmitting(true);

      // Balanced journal entry through in-transit clearing account
      const journalDraft = {
        journal_date: transferDate,
        fiscal_period_id: 'per-2026-10',
        source_type: 'bank_transfer',
        reference,
        memo: `Bank Transfer from ${fromBank?.name} to ${toBank?.name}: ${memo}`,
        lines: [
          // Step 1: Disburse from source bank into in-transit
          {
            id: `trf-line-1-${Date.now()}`,
            line_no: 1,
            account_id: inTransitAccount?.id || 'acc-1090',
            description: `In-Transit Clearing: Transfer to ${toBank?.name}`,
            debit: amountFc,
            credit: 0,
            dimensions: { branch: 'MG' },
          },
          {
            id: `trf-line-2-${Date.now()}`,
            line_no: 2,
            account_id: fromAccount?.id || 'acc-1010',
            description: `Transfer Out to ${toBank?.name} (${reference})`,
            debit: 0,
            credit: amountFc,
            dimensions: { branch: 'MG' },
          },
          // Step 2: Deposit from in-transit into destination bank
          {
            id: `trf-line-3-${Date.now()}`,
            line_no: 3,
            account_id: toAccount?.id || 'acc-1020',
            description: `Transfer In from ${fromBank?.name} (${reference})`,
            debit: amountFc,
            credit: 0,
            dimensions: { branch: 'MG' },
          },
          {
            id: `trf-line-4-${Date.now()}`,
            line_no: 4,
            account_id: inTransitAccount?.id || 'acc-1090',
            description: `In-Transit Settlement from ${fromBank?.name}`,
            debit: 0,
            credit: amountFc,
            dimensions: { branch: 'MG' },
          },
        ],
      };

      postJournalDirect(journalDraft, currentUser, companySettings);

      toast.success(
        `Successfully transferred ${formatMoney(amountFc)} from ${fromBank?.name} to ${toBank?.name} via In-Transit Account (1090)`,
        {
          action: {
            label: 'Undo',
            onClick: () => toast.info('Transfer reversal scheduled'),
          },
        }
      );

      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to execute bank transfer');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg p-6 bg-surface-elevated border border-border shadow-popover rounded-lg">
        <DialogHeader className="pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div>
              <DialogTitle className="text-base font-semibold text-text-primary">
                Move money between accounts
              </DialogTitle>
              <DialogDescription className="text-xs text-text-muted mt-0.5">
                Moves cash from one of your accounts to another, with a clear record in between.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-4 flex flex-col gap-4 text-xs">
          {/* Account selector cards */}
          <div className="grid grid-cols-2 gap-3 p-3.5 bg-surface-neutral/50 border border-border rounded-lg">
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">From</span>
              <select
                value={fromBankId}
                onChange={(e) => setFromBankId(e.target.value)}
                className="h-9 px-2 rounded-lg border border-border bg-surface font-semibold text-text-primary focus:outline-none focus:border-accent text-xs"
              >
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.currency})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-text-muted">To</span>
              <select
                value={toBankId}
                onChange={(e) => setToBankId(e.target.value)}
                className="h-9 px-2 rounded-lg border border-border bg-surface font-semibold text-text-primary focus:outline-none focus:border-accent text-xs"
              >
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.currency})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Amount and Date */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary flex items-center">
                Amount ($)
                <FieldHelp help="How much to move out of the first account." example="5000.00" />
              </label>
              <input
                type="number"
                step="0.01"
                value={(amountFc / 100).toFixed(2)}
                onChange={(e) => setAmountFc(Math.round((parseFloat(e.target.value) || 0) * 100))}
                className="h-9 px-2.5 tabular-nums text-right rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:border-accent text-xs"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary flex items-center">
                Date
                <FieldHelp help="The day the money left the first account." example="2026-10-28" />
              </label>
              <input
                type="date"
                value={transferDate}
                onChange={(e) => setTransferDate(e.target.value)}
                className="h-9 px-2.5 tabular-nums rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:border-accent text-xs"
              />
            </div>
          </div>

          {/* Reference & Memo */}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary flex items-center">
                Reference
                <FieldHelp help="The bank's confirmation code, if you have one." example="TRF-2026-004" />
              </label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="h-9 px-2.5 tabular-nums rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:border-accent text-xs"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary flex items-center">
                Held in (while moving)
                <FieldHelp help="A holding account that keeps the books balanced while money is on its way." example="1090 Cash-in-Transit" />
              </label>
              <div className="h-9 px-2.5 flex items-center tabular-nums rounded-lg border border-border bg-surface-neutral text-text-muted text-[11px]">
                1090 · Cash in transit
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary flex items-center">
              Note
              <FieldHelp help="Why you are moving this money." example="Treasury liquidity rebalancing" />
            </label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="h-9 px-2.5 rounded-lg border border-border bg-surface text-text-primary focus:outline-none focus:border-accent text-xs"
            />
          </div>

          {/* Consequence Box */}
          <div className="p-3 bg-surface-neutral border border-border rounded-md">
            <span className="text-[11px] font-semibold tracking-wide text-accent block mb-1">
              What will be recorded
            </span>
            <p className="text-[11px] text-text-secondary leading-relaxed">
              We will take{' '}
              <strong className="text-text-primary">{formatMoney(amountFc)}</strong> out of {fromBank?.name}, hold it briefly in Cash in transit, and add{' '}
              <strong className="text-text-primary">{formatMoney(amountFc)}</strong> to {toBank?.name}.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-3 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="h-8 px-3 rounded-md border border-border text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-neutral transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExecuteTransfer}
            disabled={isSubmitting}
            className="h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition disabled:opacity-60"
          >
            {isSubmitting ? 'Moving...' : 'Move money'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
