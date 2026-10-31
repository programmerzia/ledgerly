import React, { useState } from 'react';
import { useLedgerStore } from '@/mock/store';
import { Bill } from '@/types';
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
import { CreditCard, Building } from 'lucide-react';
import { toast } from 'sonner';

interface SupplierPaymentDialogProps {
  isOpen: boolean;
  onClose: () => void;
  bill: Bill;
}

export const SupplierPaymentDialog: React.FC<SupplierPaymentDialogProps> = ({
  isOpen,
  onClose,
  bill,
}) => {
  const { currentCompany, currentUser, bankAccounts, contacts, companySettings, recordPayment } =
    useLedgerStore();

  const openBalance = bill.total - bill.settled;
  const supplier = contacts.find((c) => c.id === bill.contact_id);

  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id || 'bnk-1');
  const [amountFc, setAmountFc] = useState(openBalance);
  const [paymentDate, setPaymentDate] = useState('2026-10-28');
  const [reference, setReference] = useState(`WIRE-DAH-${Date.now().toString().slice(-4)}`);
  const [memo, setMemo] = useState(`Direct disbursement for ${bill.number || 'bill'}`);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedBank = bankAccounts.find((b) => b.id === bankAccountId);

  const handleDisburse = async () => {
    if (amountFc <= 0) {
      toast.error('Payment amount must be greater than zero');
      return;
    }

    try {
      setIsSubmitting(true);

      const settlement = recordPayment(
        {
          contact_id: bill.contact_id,
          bank_account_id: bankAccountId,
          settlement_date: paymentDate,
          currency: bill.currency,
          fx_rate: bill.fx_rate,
          amount_fc: amountFc,
          amount: amountFc,
          reference,
          memo,
          allocations: [
            {
              id: `alloc-${bill.id}-${Date.now()}`,
              invoice_id: bill.id,
              invoice_number: bill.number || '',
              invoice_total_fc: bill.total,
              invoice_open_fc: openBalance,
              allocated_amount_fc: amountFc,
              allocated_amount_base: amountFc,
              fx_gain_loss: 0,
            },
          ],
        },
        currentUser,
        companySettings
      );

      toast.success(
        `Disbursed payment ${settlement.number} for ${formatMoney(amountFc, bill.currency)} to ${supplier?.name || 'supplier'}`,
        {
          action: {
            label: 'Undo',
            onClick: () => toast.info('Payment reversal requested'),
          },
        }
      );

      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to record supplier payment');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-6 bg-surface border border-border shadow-xl rounded-lg">
        <DialogHeader className="pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-accent-soft text-accent flex items-center justify-center font-bold">
              <CreditCard className="w-4 h-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-text-primary">
                Disburse Supplier Payment
              </DialogTitle>
              <DialogDescription className="text-xs text-text-muted mt-0.5">
                Single bill settlement from treasury account (Dr Accounts Payable, Cr Bank)
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-4 flex flex-col gap-4 text-xs">
          {/* Bill summary banner */}
          <div className="p-3 bg-surface-neutral/60 border border-border rounded-md flex items-center justify-between">
            <div>
              <span className="font-semibold text-text-primary">{supplier?.name || 'Supplier'}</span>
              <p className="text-[11px] text-text-muted font-mono">{bill.number || 'BILL'} • Ref: {bill.reference}</p>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-text-muted block">Balance Due</span>
              <span className="font-mono font-bold text-danger text-sm">{formatMoney(openBalance, bill.currency)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary flex items-center">
                Disbursement Account
                <FieldHelp help="Bank account paying the vendor." example="Premier Bank USD (1010)" />
              </label>
              <select
                value={bankAccountId}
                onChange={(e) => setBankAccountId(e.target.value)}
                className="h-8 px-2 rounded-sm border border-border bg-surface text-text-primary font-medium focus:outline-none focus:border-accent text-xs"
              >
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.currency})
                  </option>
                ))}
              </select>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary flex items-center">
                Payment Amount ($)
                <FieldHelp help="Amount disbursed (can be full or partial)." example="4275.00" />
              </label>
              <input
                type="number"
                step="0.01"
                max={(openBalance / 100).toFixed(2)}
                value={(amountFc / 100).toFixed(2)}
                onChange={(e) => setAmountFc(Math.round((parseFloat(e.target.value) || 0) * 100))}
                className="h-8 px-2.5 font-mono text-right rounded-sm border border-border bg-surface text-text-primary focus:outline-none focus:border-accent text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary flex items-center">
                Payment Date
                <FieldHelp help="Date disbursement was executed." example="2026-10-28" />
              </label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="h-8 px-2.5 font-mono rounded-sm border border-border bg-surface text-text-primary focus:outline-none focus:border-accent text-xs"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary flex items-center">
                Payment Reference #
                <FieldHelp help="Bank wire confirmation code or voucher number." example="WIRE-DAH-4412" />
              </label>
              <input
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="h-8 px-2.5 font-mono rounded-sm border border-border bg-surface text-text-primary focus:outline-none focus:border-accent text-xs"
              />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary flex items-center">
              Payment Memo
              <FieldHelp help="Remittance description for vendor payment records." example="Direct disbursement for network bill" />
            </label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary focus:outline-none focus:border-accent text-xs"
            />
          </div>

          {/* Accounting consequence */}
          <div className="p-3 bg-accent-soft/30 border border-accent/20 rounded-md">
            <span className="text-[10px] uppercase font-bold text-accent block mb-1">
              General Ledger Impact
            </span>
            <p className="text-[11px] text-text-secondary leading-relaxed">
              This will debit Accounts Payable (2000) for{' '}
              <strong className="text-text-primary font-mono">{formatMoney(amountFc, bill.currency)}</strong>, credit{' '}
              {selectedBank?.name || 'Bank Account'} for{' '}
              <strong className="text-text-primary font-mono">{formatMoney(amountFc, bill.currency)}</strong>, and mark this bill as settled.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-3 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="h-8 px-3.5 rounded-sm border border-border text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-neutral transition"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDisburse}
            disabled={isSubmitting}
            className="h-8 px-4 rounded-sm bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-xs transition"
          >
            {isSubmitting ? 'Processing...' : 'Confirm & Disburse'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
