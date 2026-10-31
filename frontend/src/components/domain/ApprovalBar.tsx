import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatMoney, formatDateTime } from '@/lib/format';
import { ShieldAlert, CheckCircle, RotateCcw, AlertTriangle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Avatar } from '@/components/ui/avatar';

interface ApprovalBarProps {
  makerId: string;
  makerName: string;
  currentUserId: string;
  submittedAt?: string;
  amount: number;
  currency: string;
  periodName?: string;
  documentNumber?: string;
  onApprove: () => Promise<void>;
  onReturn: (comment: string) => Promise<void>;
  className?: string;
}

export const ApprovalBar: React.FC<ApprovalBarProps> = ({
  makerId,
  makerName,
  currentUserId,
  submittedAt,
  amount,
  currency,
  periodName = 'Oct 2026',
  documentNumber = 'Document',
  onApprove,
  onReturn,
  className,
}) => {
  const [isApproveOpen, setIsApproveOpen] = useState(false);
  const [isReturnOpen, setIsReturnOpen] = useState(false);
  const [returnComment, setReturnComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const isMaker = currentUserId === makerId;

  const handleConfirmApprove = async () => {
    try {
      setLoading(true);
      setErrorMsg('');
      await onApprove();
      setIsApproveOpen(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Approval failed');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReturn = async () => {
    if (!returnComment.trim()) return;
    try {
      setLoading(true);
      setErrorMsg('');
      await onReturn(returnComment);
      setIsReturnOpen(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Return failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div
        className={cn(
          'sticky bottom-0 left-0 right-0 z-20 flex select-none flex-wrap items-center justify-between gap-4 rounded-lg border border-border bg-surface px-5 py-3.5 shadow-popover',
          className
        )}
      >
        <div className="flex items-center gap-3">
          <ShieldAlert className="size-4 shrink-0 text-warning" />
          <div className="flex flex-col">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
              <span>Waiting for a second person to approve</span>
              <span className="font-normal tabular-nums text-text-muted">{formatMoney(amount, currency)}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs text-text-muted">
              <Avatar name={makerName} size="sm" className="!size-4 !text-[8px]" />
              Sent by <span className="font-medium text-text-secondary">{makerName}</span>
              {submittedAt && ` on ${formatDateTime(submittedAt)}`} · {periodName}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {isMaker ? (
            <div className="flex items-center gap-2 rounded-lg border border-danger/20 bg-danger-soft px-3 py-1.5 text-xs font-medium text-danger">
              <AlertTriangle className="size-3.5 shrink-0" />
              <span>You sent this, so someone else has to approve it.</span>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setIsReturnOpen(true)}
                className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium text-text-secondary transition hover:border-danger/50 hover:bg-danger-soft hover:text-danger"
              >
                <RotateCcw className="size-3.5" />
                Send back
              </button>
              <button
                type="button"
                onClick={() => setIsApproveOpen(true)}
                className="flex h-9 items-center gap-1.5 rounded-lg bg-success px-4 text-[13px] font-semibold text-white transition hover:opacity-90"
              >
                <CheckCircle className="size-3.5" />
                Approve and post
              </button>
            </>
          )}
        </div>
      </div>

      <Dialog open={isApproveOpen} onOpenChange={(o) => !o && setIsApproveOpen(false)}>
        <DialogContent className="max-w-md rounded-lg bg-surface-elevated p-6 shadow-popover">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              Approve and post
            </DialogTitle>
            <DialogDescription className="text-xs text-text-muted">This adds the document to your books for good.</DialogDescription>
          </DialogHeader>
          {errorMsg && <div className="rounded-lg border border-danger/30 bg-danger-soft p-2.5 text-xs text-danger">{errorMsg}</div>}
          <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-surface-neutral p-3 text-xs">
            <div className="flex justify-between">
              <span className="text-text-muted">Document</span>
              <span className="font-semibold text-text-primary">{documentNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Total</span>
              <span className="font-semibold tabular-nums text-text-primary">{formatMoney(amount, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-text-muted">Period</span>
              <span className="font-semibold text-text-primary">{periodName} (open)</span>
            </div>
          </div>
          <p className="text-xs text-text-muted">It gets its permanent number and cannot be edited afterwards. Mistakes are fixed with a reversal.</p>
          <DialogFooter className="gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setIsApproveOpen(false)}
              disabled={loading}
              className="h-8 rounded-md border border-border px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-neutral"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmApprove}
              disabled={loading}
              className="h-9 rounded-lg bg-success px-4 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {loading ? 'Approving...' : 'Approve and post'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isReturnOpen} onOpenChange={(o) => !o && setIsReturnOpen(false)}>
        <DialogContent className="max-w-md rounded-lg bg-surface-elevated p-6 shadow-popover">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold">
              Send back for changes
            </DialogTitle>
            <DialogDescription className="text-xs text-text-muted">
              {makerName} gets it back as a draft, with your note.
            </DialogDescription>
          </DialogHeader>
          <textarea
            rows={3}
            value={returnComment}
            onChange={(e) => setReturnComment(e.target.value)}
            placeholder="What needs to change? e.g. the tax code is wrong."
            className="w-full rounded-lg border border-border bg-surface p-2.5 text-[13px] text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
          />
          <DialogFooter className="gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={() => setIsReturnOpen(false)}
              disabled={loading}
              className="h-8 rounded-md border border-border px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-neutral"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmReturn}
              disabled={loading || !returnComment.trim()}
              className="h-9 rounded-lg bg-warning px-4 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-40"
            >
              {loading ? 'Sending...' : 'Send back'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
