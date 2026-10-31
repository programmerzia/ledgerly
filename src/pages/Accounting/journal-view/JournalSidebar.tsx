import React from 'react';
import { RotateCcw, Printer, Copy, Wrench, Paperclip, Hash } from 'lucide-react';
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
}

interface Props {
  journal: Journal;
  currency: string;
  actions: JournalSidebarActions;
}

export const JournalSidebar: React.FC<Props> = ({ journal, currency, actions }) => {
  const posted = journal.status === 'posted';
  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
      <section className={cn(CARD, 'flex flex-col gap-4 p-5')} aria-label="Journal status">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill status={journal.status} />
        </div>
        <div>
          <div className="text-xs text-text-muted">Total of this entry</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums tracking-tight text-text-primary">
            {formatMoney(journal.total_debit, currency)}
          </div>
          <div className="mt-1 text-[13px] text-text-muted">
            {journal.lines.length} lines · {journal.status === 'posted' ? 'in the books' : journal.status === 'reversed' ? 'cancelled by a reversal' : 'not in the books yet'}
          </div>
        </div>
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
