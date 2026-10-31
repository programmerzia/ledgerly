import React from 'react';
import { RotateCcw, Printer, Copy, Wrench, Paperclip, Hash, CheckCircle, Send, Clock } from 'lucide-react';
import type { Journal } from '@/types';
import { StatusPill } from '@/components/domain/StatusPill';
import { DocumentAuditTimeline } from '@/components/domain/DocumentAuditTimeline';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { CARD, BTN_SECONDARY } from '@/pages/Sales/invoice-view/shared';

export interface JournalSidebarActions {
  print: () => void;
  reverse: () => void;
  fixThis: () => void;
  duplicate: () => void;
  attach: () => void;
  copyNumber: () => void;
  submit?: () => void;
  approve?: () => void;
  sendBack?: () => void;
}

interface Props {
  journal: Journal;
  currency: string;
  actions: JournalSidebarActions;
  /** Id of the signed-in user, to tell maker from approver. */
  currentUserId?: string;
  /** Name of the person who sent it for approval or created it. */
  makerName?: string;
  /** Bank statement line description when the journal came from the bank feed. */
  bankLineDescription?: string;
}

export const JournalSidebar: React.FC<Props> = ({ journal, currency, actions, currentUserId, makerName, bankLineDescription }) => {
  const posted = journal.status === 'posted';
  const isMaker = !!currentUserId && (journal.created_by === currentUserId || journal.submitted_by === currentUserId);
  const pending = journal.status === 'pending_approval';
  const canSubmit = journal.status === 'draft' && journal.source_type === 'bank_transaction' && !!actions.submit;
  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
      <section className={cn(CARD, 'flex flex-col gap-4 p-5')} aria-label="Journal status">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill status={journal.status} />
        </div>
        <div>
          <div className="text-xs text-text-muted">Total of this entry</div>
          <div className="mt-1 text-[22px] leading-7 font-medium tabular-nums text-text-primary">
            {formatMoney(journal.total_debit, currency)}
          </div>
          <div className="mt-1 text-[13px] text-text-muted">
            {journal.lines.length} lines · {journal.status === 'posted' ? 'in the books' : journal.status === 'reversed' ? 'cancelled by a reversal' : 'not in the books yet'}
          </div>
        </div>
        {journal.source_type === 'bank_transaction' && (
          <div className="flex items-start gap-2 rounded-md bg-surface-neutral px-3 py-2 text-xs text-text-secondary">
            <span>From bank line: <span className="font-medium text-text-primary">{bankLineDescription ?? journal.memo}</span></span>
          </div>
        )}
        {pending && (
          isMaker ? (
            <div className="flex items-center gap-2 rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-[13px] font-medium text-warning">
              <Clock className="size-4 shrink-0" /> Waiting for someone else to approve{makerName ? ` (sent by ${makerName})` : ""}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={actions.sendBack} className={cn(BTN_SECONDARY, 'hover:border-danger/50 hover:text-danger')}>
                <RotateCcw className="size-4" /> Return
              </button>
              <button
                type="button"
                onClick={actions.approve}
                className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-success px-3 text-[13px] font-medium text-white transition hover:opacity-90"
              >
                <CheckCircle className="size-4" /> Approve
              </button>
            </div>
          )
        )}
        {canSubmit && (
          <button
            type="button"
            onClick={actions.submit}
            className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover"
          >
            <Send className="size-4" /> Submit for approval
          </button>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={actions.print} className={BTN_SECONDARY}>
            <Printer className="size-4 text-text-muted" /> Print
          </button>
          <button type="button" onClick={actions.duplicate} className={BTN_SECONDARY}>
            <Copy className="size-4 text-text-muted" /> Duplicate
          </button>
          <button type="button" onClick={actions.copyNumber} className={BTN_SECONDARY}>
            <Hash className="size-4 text-text-muted" /> Copy number
          </button>
          <button type="button" onClick={actions.attach} className={BTN_SECONDARY}>
            <Paperclip className="size-4 text-text-muted" /> Files
          </button>
          {posted && (
            <>
              <button type="button" onClick={actions.fixThis} className={BTN_SECONDARY}>
                <Wrench className="size-4 text-text-muted" /> Fix this
              </button>
              <button
                type="button"
                onClick={actions.reverse}
                title="Cancel this entry with an equal and opposite one"
                className={cn(BTN_SECONDARY, 'border-danger/40 text-danger hover:bg-danger-soft hover:border-danger/60')}
              >
                <RotateCcw className="size-4" /> Reverse
              </button>
            </>
          )}
        </div>
      </section>

      <section className={cn(CARD, 'flex flex-col gap-3 p-5')} aria-label="Activity">
        <h3 className="text-sm font-semibold text-text-primary">Activity</h3>
        <DocumentAuditTimeline
          documentId={journal.id}
          documentNumber={journal.number}
          documentType="journal"
          documentStatus={journal.status}
          createdAt={journal.created_at}
          createdBy={journal.created_by}
          submittedBy={journal.submitted_by}
          postedAt={journal.posted_at}
          approvedBy={journal.approved_by}
          signedAt={journal.signed_at}
          signatureHash={journal.signature_hash}
          memo={journal.memo}
          total={journal.total_debit}
          currency={currency}
          linesCount={journal.lines.length}
        />
      </section>
    </aside>
  );
};
