import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { formatMoney, formatDateTime } from '@/lib/format';
import { ShieldAlert, CheckCircle, RotateCcw, X, AlertTriangle } from 'lucide-react';

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
      {/* Sticky Bottom Bar */}
      <div
        className={cn(
          'sticky bottom-0 left-0 right-0 z-20 bg-surface border-t border-ink-200 px-6 py-3.5 shadow-lg flex flex-wrap items-center justify-between gap-4 select-none',
          className
        )}
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-warning-bg text-warning flex items-center justify-center shrink-0">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div className="flex flex-col">
            <div className="text-xs font-semibold text-ink-900 flex items-center gap-2">
              <span>Pending Independent Approval</span>
              <span className="font-mono text-ink-500 font-normal">
                {formatMoney(amount, currency)}
              </span>
            </div>
            <div className="text-[11px] text-ink-500">
              Submitted by <span className="font-medium text-ink-700">{makerName}</span>
              {submittedAt && ` on ${formatDateTime(submittedAt)}`} • Fiscal Period: {periodName}
            </div>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2.5">
          {isMaker ? (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-danger-bg/40 text-danger border border-danger/20 rounded-sm text-xs font-medium">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span>Maker-Checker Control: You submitted this document and cannot approve it.</span>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setIsReturnOpen(true)}
                className="flex items-center gap-1.5 h-8 px-3 rounded-sm border border-ink-200 hover:border-danger hover:text-danger bg-surface text-ink-700 text-xs font-medium transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Return to Maker</span>
              </button>

              <button
                type="button"
                onClick={() => setIsApproveOpen(true)}
                className="flex items-center gap-1.5 h-8 px-4 rounded-sm bg-success hover:opacity-90 text-white text-xs font-semibold shadow-sm transition-all"
              >
                <CheckCircle className="w-3.5 h-3.5" />
                <span>Approve & Post</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Confirm Approve Dialog (03_UI_Spec §6: States period, amount, and consequences) */}
      {isApproveOpen && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-surface border border-ink-200 rounded-lg shadow-lg p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-ink-100">
              <h3 className="text-h3 text-ink-900 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-success" />
                Approve & Post Document
              </h3>
              <button
                type="button"
                onClick={() => setIsApproveOpen(false)}
                className="text-ink-500 hover:text-ink-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {errorMsg && (
              <div className="p-2.5 bg-danger-bg text-danger text-xs rounded-sm border border-danger/30">
                {errorMsg}
              </div>
            )}

            <div className="text-xs text-ink-700 flex flex-col gap-2.5">
              <p>You are about to authorize and lock this document into the immutable general ledger:</p>

              <div className="bg-ink-50 p-3 rounded-sm border border-ink-200 flex flex-col gap-1.5 font-mono text-[11px]">
                <div className="flex justify-between">
                  <span className="text-ink-500">Document:</span>
                  <span className="font-semibold text-ink-900">{documentNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-500">Total Amount:</span>
                  <span className="font-semibold text-ink-900">{formatMoney(amount, currency)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-ink-500">Target Fiscal Period:</span>
                  <span className="font-semibold text-brand-700">{periodName} (Open)</span>
                </div>
              </div>

              <p className="text-[11px] text-ink-500 italic">
                Consequence: A permanent, gapless sequence number will be assigned and double-entry
                journal lines will be committed. Posted records cannot be edited, only reversed.
              </p>
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-ink-100">
              <button
                type="button"
                onClick={() => setIsApproveOpen(false)}
                disabled={loading}
                className="px-3 py-1.5 rounded-sm border border-ink-200 hover:bg-ink-100 text-xs font-medium text-ink-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmApprove}
                disabled={loading}
                className="px-4 py-1.5 rounded-sm bg-success hover:opacity-90 text-white text-xs font-semibold shadow-sm flex items-center gap-1.5"
              >
                {loading ? 'Authorizing...' : 'Authorize & Post'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Return Dialog with Mandatory Comment */}
      {isReturnOpen && (
        <div className="fixed inset-0 z-50 bg-ink-900/40 backdrop-blur-[2px] flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-surface border border-ink-200 rounded-lg shadow-lg p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between pb-2 border-b border-ink-100">
              <h3 className="text-h3 text-ink-900 flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-warning" />
                Return Document to Maker
              </h3>
              <button
                type="button"
                onClick={() => setIsReturnOpen(false)}
                className="text-ink-500 hover:text-ink-900"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="text-xs text-ink-700 flex flex-col gap-2">
              <p>
                Explain why this document is being returned to {makerName}. The document will revert
                to <strong>Draft</strong> status for revision.
              </p>
              <textarea
                rows={3}
                value={returnComment}
                onChange={(e) => setReturnComment(e.target.value)}
                placeholder="Specify corrections needed (e.g. incorrect tax code or dimension)..."
                className="w-full p-2 text-xs bg-surface border border-ink-200 rounded-sm text-ink-900 focus:outline-none focus:border-brand-500"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-ink-100">
              <button
                type="button"
                onClick={() => setIsReturnOpen(false)}
                disabled={loading}
                className="px-3 py-1.5 rounded-sm border border-ink-200 hover:bg-ink-100 text-xs font-medium text-ink-700"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmReturn}
                disabled={loading || !returnComment.trim()}
                className="px-4 py-1.5 rounded-sm bg-warning hover:opacity-90 text-white text-xs font-semibold shadow-sm disabled:opacity-40"
              >
                {loading ? 'Returning...' : 'Return with Comment'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
