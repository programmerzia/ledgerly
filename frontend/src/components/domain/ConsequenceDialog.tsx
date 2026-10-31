import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { formatMoney } from '@/lib/format';

export interface ConsequenceAccountingLine {
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
}

interface ConsequenceDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  actionType?: 'submit' | 'post' | 'reverse';
  plainLanguageEffect: string;
  accountingLines?: ConsequenceAccountingLine[];
  confirmLabel?: string;
  isSubmitting?: boolean;
}

export const ConsequenceDialog: React.FC<ConsequenceDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  actionType = 'submit',
  plainLanguageEffect,
  accountingLines = [],
  confirmLabel,
  isSubmitting = false,
}) => {
  const [showAccounting, setShowAccounting] = useState(false);

  const totalDebit = accountingLines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit = accountingLines.reduce((sum, l) => sum + (l.credit || 0), 0);

  const defaultConfirmLabel = actionType === 'submit' ? 'Submit for approval' : 'Post to books';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md p-6 bg-surface-elevated border border-border shadow-popover rounded-lg">
        <DialogHeader className="gap-1.5 pb-2 border-b border-border">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-base font-semibold text-text-primary">
              {title}
            </DialogTitle>
          </div>
          <DialogDescription className="text-xs text-text-muted">
            Here is what happens when you continue.
          </DialogDescription>
        </DialogHeader>

        <div className="py-3 flex flex-col gap-4 text-xs">
          {/* Plain language consequence box */}
          <div className="p-3.5 bg-surface-neutral border border-border rounded-lg">
            <span className="text-[11px] font-semibold tracking-wide text-accent block mb-1.5">
              What will happen
            </span>
            <p className="text-xs text-text-primary leading-relaxed">
              {plainLanguageEffect}
            </p>
          </div>

          {/* Collapsible Accounting section */}
          {accountingLines.length > 0 && (
            <div className="border border-border rounded-lg overflow-hidden bg-surface-neutral/30">
              <button
                type="button"
                onClick={() => setShowAccounting(!showAccounting)}
                className="w-full px-3 py-2 flex items-center justify-between text-left hover:bg-surface-neutral/60 transition"
              >
                <div className="flex items-center gap-1.5 text-xs font-semibold text-text-primary">
                  {showAccounting ? (
                    <ChevronDown className="w-3.5 h-3.5 text-text-muted" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 text-text-muted" />
                  )}
                  <span>See the accounting entries ({accountingLines.length})</span>
                </div>
                <span className="text-[11px] tabular-nums text-text-muted font-medium">
                  {formatMoney(totalDebit)}
                </span>
              </button>

              {showAccounting && (
                <div className="border-t border-border p-2 bg-surface">
                  <table className="w-full text-left text-[11px] table-dense">
                    <thead className="text-[11px] text-text-muted font-semibold border-b border-border/60">
                      <tr>
                        <th className="py-1 px-1.5">Account</th>
                        <th className="py-1 px-1.5 text-right w-20">Debit</th>
                        <th className="py-1 px-1.5 text-right w-20">Credit</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/40 tabular-nums">
                      {accountingLines.map((l, i) => (
                        <tr key={i} className="hover:bg-surface-neutral/30">
                          <td className="py-1 px-1.5 truncate max-w-[170px]">
                            <span className="font-semibold text-accent mr-1">{l.accountCode}</span>
                            <span className="text-text-muted font-sans text-[10px]">{l.accountName}</span>
                          </td>
                          <td className="py-1 px-1.5 text-right text-text-primary text-num">
                            {l.debit > 0 ? formatMoney(l.debit) : '—'}
                          </td>
                          <td className="py-1 px-1.5 text-right text-text-primary text-num">
                            {l.credit > 0 ? formatMoney(l.credit) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t-2 border-border font-semibold text-[11px] tabular-nums">
                      <tr>
                        <td className="py-1 px-1.5 font-sans text-text-primary">Total</td>
                        <td className="py-1 px-1.5 text-right text-num text-text-primary">
                          {formatMoney(totalDebit)}
                        </td>
                        <td className="py-1 px-1.5 text-right text-num text-text-primary">
                          {formatMoney(totalCredit)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0 pt-2 border-t border-border">
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
            onClick={onConfirm}
            disabled={isSubmitting}
            className="h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition disabled:opacity-60"
          >
            {isSubmitting ? 'Working...' : confirmLabel || defaultConfirmLabel}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
