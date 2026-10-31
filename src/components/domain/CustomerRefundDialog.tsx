import React, { useState } from 'react';
import { useLedgerStore } from '@/mock/store';
import { Invoice } from '@/types';
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
import { RotateCcw, Building } from 'lucide-react';
import { toast } from 'sonner';

interface CustomerRefundDialogProps {
  isOpen: boolean;
  onClose: () => void;
  invoice: Invoice;
}

export const CustomerRefundDialog: React.FC<CustomerRefundDialogProps> = ({
  isOpen,
  onClose,
  invoice,
}) => {
  const { currentCompany, currentUser, bankAccounts, contacts, accounts, companySettings, postJournalDirect } =
    useLedgerStore();

  const customer = contacts.find((c) => c.id === invoice.contact_id);
  const [bankAccountId, setBankAccountId] = useState(bankAccounts[0]?.id || 'bnk-1');
  const [amountFc, setAmountFc] = useState(Math.abs(invoice.total));
  const [refundDate, setRefundDate] = useState('2026-10-28');
  const [reference, setReference] = useState(`REF-CUST-${Date.now().toString().slice(-4)}`);
  const [memo, setMemo] = useState(`Customer refund against ${invoice.number || 'invoice'}`);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const selectedBank = bankAccounts.find((b) => b.id === bankAccountId);
  const bankAccountGl = accounts.find((a) => a.id === selectedBank?.account_id) || accounts.find((a) => a.code === '1010');
  const arAccountGl = accounts.find((a) => a.code === '1200');

  const handleExecuteRefund = async () => {
    if (amountFc <= 0) {
      toast.error('Refund amount must be positive');
      return;
    }

    try {
      setIsSubmitting(true);

      const journalDraft = {
        journal_date: refundDate,
        fiscal_period_id: 'per-2026-10',
        source_type: 'customer_refund',
        reference,
        memo: `Customer Refund to ${customer?.name}: ${memo}`,
        lines: [
          {
            id: `ref-line-1-${Date.now()}`,
            line_no: 1,
            account_id: arAccountGl?.id || 'acc-1200',
            description: `Customer Refund: ${customer?.name} (${reference})`,
            debit: amountFc,
            credit: 0,
            dimensions: { branch: 'MG' },
          },
          {
            id: `ref-line-2-${Date.now()}`,
            line_no: 2,
            account_id: bankAccountGl?.id || 'acc-1010',
            description: `Bank Disbursement to ${customer?.name}`,
            debit: 0,
            credit: amountFc,
            dimensions: { branch: 'MG' },
          },
        ],
      };

      postJournalDirect(journalDraft, currentUser, companySettings);

      toast.success(
        `Refund of ${formatMoney(amountFc, invoice.currency)} disbursed to ${customer?.name || 'customer'} from ${selectedBank?.name}`,
        {
          action: {
            label: 'Undo',
            onClick: () => toast.info('Refund reversal scheduled'),
          },
        }
      );

      onClose();
    } catch (err: any) {
      toast.error(err.message || 'Failed to disburse refund');
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
              <RotateCcw className="w-4 h-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-bold text-text-primary">
                Issue Customer Refund
              </DialogTitle>
              <DialogDescription className="text-xs text-text-muted mt-0.5">
                Disburse cash back to client (Dr Accounts Receivable 1200, Cr Bank 1010)
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-4 flex flex-col gap-4 text-xs">
          <div className="p-3 bg-surface-neutral/60 border border-border rounded-md flex items-center justify-between">
            <div>
              <span className="font-semibold text-text-primary">{customer?.name || 'Customer'}</span>
              <p className="text-[11px] text-text-muted font-mono">{invoice.number || 'INV'} • Ref: {invoice.reference}</p>
            </div>
            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-text-muted block">Invoice Amount</span>
              <span className="font-mono font-bold text-accent text-sm">{formatMoney(Math.abs(invoice.total), invoice.currency)}</span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary flex items-center">
                Disbursing Bank Account
                <FieldHelp help="Treasury account sending funds." example="Premier Bank USD (1010)" />
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
                Refund Amount ($)
                <FieldHelp help="Sum to disburse back to customer." example="1050.00" />
              </label>
              <input
                type="number"
                step="0.01"
                value={(amountFc / 100).toFixed(2)}
                onChange={(e) => setAmountFc(Math.round((parseFloat(e.target.value) || 0) * 100))}
                className="h-8 px-2.5 font-mono text-right rounded-sm border border-border bg-surface text-text-primary focus:outline-none focus:border-accent text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary flex items-center">
                Refund Date
                <FieldHelp help="Date funds were sent back to customer." example="2026-10-28" />
              </label>
              <input
                type="date"
                value={refundDate}
                onChange={(e) => setRefundDate(e.target.value)}
                className="h-8 px-2.5 font-mono rounded-sm border border-border bg-surface text-text-primary focus:outline-none focus:border-accent text-xs"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-text-secondary flex items-center">
                Refund Reference #
                <FieldHelp help="Bank transfer or cheque reference." example="REF-CUST-8812" />
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
              Refund Memo
              <FieldHelp help="Commercial justification for issuing refund." example="Customer overpayment refund" />
            </label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary focus:outline-none focus:border-accent text-xs"
            />
          </div>

          <div className="p-3 bg-accent-soft/30 border border-accent/20 rounded-md">
            <span className="text-[10px] uppercase font-bold text-accent block mb-1">
              General Ledger Impact
            </span>
            <p className="text-[11px] text-text-secondary leading-relaxed">
              This will debit Accounts Receivable (1200) for{' '}
              <strong className="text-text-primary font-mono">{formatMoney(amountFc, invoice.currency)}</strong> and credit{' '}
              {selectedBank?.name || 'Bank Account'} for{' '}
              <strong className="text-text-primary font-mono">{formatMoney(amountFc, invoice.currency)}</strong>.
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
            onClick={handleExecuteRefund}
            disabled={isSubmitting}
            className="h-8 px-4 rounded-sm bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-xs transition"
          >
            {isSubmitting ? 'Processing...' : 'Disburse Refund'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
