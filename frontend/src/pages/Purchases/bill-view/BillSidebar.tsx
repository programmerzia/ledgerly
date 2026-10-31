import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  Download,
  FileMinus,
  Link2,
  Copy,
  Mail,
  MoreHorizontal,
  Paperclip,
  RotateCcw,
  Wrench,
  Send,
  Layers,
} from 'lucide-react';
import type { Bill, Contact, Settlement } from '@/types';
import { StatusPill } from '@/components/domain/StatusPill';
import { Avatar } from '@/components/ui/avatar';
import { DocumentAuditTimeline } from '@/components/domain/DocumentAuditTimeline';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatMoney, formatDate } from '@/lib/format';
import { amountDue, daysOverdue, paymentStatus, BUSINESS_TODAY } from '@/lib/docStatus';
import { cn } from '@/lib/utils';
import { CARD, BTN_PRIMARY, BTN_SECONDARY } from '@/pages/Sales/invoice-view/shared';

export interface BillJournalLine {
  id: string;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
}

export interface BillSidebarActions {
  approve: () => void;
  submit: () => void;
  pay: () => void;
  batch: () => void;
  print: () => void;
  duplicate: () => void;
  debitNote: () => void;
  copyLink: () => void;
  email: () => void;
  attach: () => void;
  fixThis: () => void;
  reverse: () => void;
}

interface Props {
  bill: Bill;
  contact?: Contact;
  supplierBalance: number;
  payments: Settlement[];
  journalLines: BillJournalLine[];
  coSlug: string;
  actions: BillSidebarActions;
}

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-sm font-semibold text-text-primary">{children}</h3>
);

export const BillSidebar: React.FC<Props> = ({ bill, contact, supplierBalance, payments, journalLines, coSlug, actions }) => {
  const [journalOpen, setJournalOpen] = useState(false);
  const pay = paymentStatus(bill);
  const due = amountDue(bill);
  const pct = bill.total > 0 ? Math.min(100, Math.round((bill.settled / bill.total) * 100)) : 0;
  const late = daysOverdue(bill);
  const posted = bill.status === 'posted';
  const daysToDue = Math.round((new Date(bill.due_date).getTime() - new Date(BUSINESS_TODAY).getTime()) / 86_400_000);
  const dueText =
    pay === 'paid'
      ? 'Fully paid'
      : pay === 'overdue'
      ? `${late} ${late === 1 ? 'day' : 'days'} overdue`
      : posted
      ? daysToDue <= 0
        ? 'Due today'
        : `Due in ${daysToDue} ${daysToDue === 1 ? 'day' : 'days'}`
      : `Due ${formatDate(bill.due_date)}`;
  const hasPrimary = bill.status === 'draft' || bill.status === 'pending_approval' || (posted && due > 0);
  const totalDr = journalLines.reduce((s, l) => s + l.debit, 0);
  const totalCr = journalLines.reduce((s, l) => s + l.credit, 0);

  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
      <section className={cn(CARD, 'p-5 flex flex-col gap-4')} aria-label="Payment status">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill status={pay} />
          {posted && pay !== 'reversed' && <StatusPill status="posted" label="In the books" />}
        </div>
        <div>
          <div className="text-xs text-text-muted">{pay === 'paid' ? 'Total paid' : 'Amount to pay'}</div>
          <div
            className={cn(
              'mt-1 text-[22px] leading-7 font-medium tabular-nums',
              pay === 'overdue' ? 'text-danger' : pay === 'paid' ? 'text-success' : 'text-text-primary'
            )}
          >
            {formatMoney(pay === 'paid' ? bill.total : due, bill.currency)}
          </div>
          <div className={cn('mt-1 text-[13px]', pay === 'overdue' ? 'text-danger font-medium' : 'text-text-muted')}>{dueText}</div>
        </div>
        {posted && (
          <div>
            <div className="h-2 rounded-[2px] bg-surface-neutral overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Paid">
              <div className={cn('h-full rounded-[2px] transition-all duration-150', pct === 100 ? 'bg-success' : 'bg-accent')} style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-text-muted tabular-nums">
              <span>{formatMoney(bill.settled, bill.currency)} paid</span>
              <span>of {formatMoney(bill.total, bill.currency)}</span>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {bill.status === 'draft' && (
            <button type="button" onClick={actions.submit} className={cn(BTN_PRIMARY, 'flex-1')}>
              <Send className="size-4" /> Submit for approval
            </button>
          )}
          {bill.status === 'pending_approval' && (
            <button type="button" onClick={actions.approve} className={cn(BTN_PRIMARY, 'flex-1')}>
              <CheckCircle2 className="size-4" /> Approve
            </button>
          )}
          {posted && due > 0 && (
            <button type="button" onClick={actions.pay} className={cn(BTN_PRIMARY, 'flex-1 whitespace-nowrap')}>
              <CreditCard className="size-4" /> {bill.settled > 0 ? 'Record payment' : 'Pay bill'}
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label="More actions" className={cn(BTN_SECONDARY, hasPrimary ? 'px-2.5' : 'flex-1')}>
                <MoreHorizontal className="size-4" />
                {!hasPrimary && <span>Actions</span>}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 rounded-lg p-1">
              <DropdownMenuItem onSelect={actions.print} className="h-8 gap-2 rounded-md">
                <Download className="size-4 text-text-muted" /> Download PDF
              </DropdownMenuItem>
              {posted && (
                <DropdownMenuItem onSelect={actions.email} className="h-8 gap-2 rounded-md">
                  <Mail className="size-4 text-text-muted" /> Email remittance
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={actions.duplicate} className="h-8 gap-2 rounded-md">
                <Copy className="size-4 text-text-muted" /> Duplicate
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={actions.copyLink} className="h-8 gap-2 rounded-md">
                <Link2 className="size-4 text-text-muted" /> Copy link
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={actions.attach} className="h-8 gap-2 rounded-md">
                <Paperclip className="size-4 text-text-muted" /> Attachments
              </DropdownMenuItem>
              {posted && (
                <>
                  <DropdownMenuSeparator className="my-1" />
                  {due > 0 && (
                    <DropdownMenuItem onSelect={actions.batch} className="h-8 gap-2 rounded-md">
                      <Layers className="size-4 text-text-muted" /> Add to payment run
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={actions.debitNote} className="h-8 gap-2 rounded-md">
                    <FileMinus className="size-4 text-text-muted" /> Issue debit note
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={actions.fixThis} className="h-8 gap-2 rounded-md">
                    <Wrench className="size-4 text-text-muted" /> Fix this bill
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="my-1" />
                  <DropdownMenuItem onSelect={actions.reverse} variant="destructive" className="h-8 gap-2 rounded-md">
                    <RotateCcw className="size-4" /> Reverse bill
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>

      {contact && (
        <section className={cn(CARD, 'p-5 flex flex-col gap-3')} aria-label="Supplier">
          <SectionTitle>Supplier</SectionTitle>
          <div className="flex items-center gap-3">
            <Avatar name={contact.name} size="lg" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text-primary">{contact.name}</div>
              <div className="truncate text-xs text-text-muted">{contact.email}</div>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-surface-neutral px-3 py-2 text-[13px]">
            <span className="text-text-muted">We owe them</span>
            <span className="font-semibold tabular-nums text-text-primary">{formatMoney(supplierBalance, contact.default_currency)}</span>
          </div>
          <Link to={`/${coSlug}/suppliers/${contact.id}`} className="text-[13px] font-medium text-accent hover:underline">
            View supplier
          </Link>
        </section>
      )}

      <section className={cn(CARD, 'p-5 flex flex-col gap-3')} aria-label="Payments">
        <SectionTitle>Payments</SectionTitle>
        {bill.settled > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {payments.length > 0 ? (
              payments.map((p) => {
                const alloc = p.allocations.find((a) => a.invoice_id === bill.id);
                return (
                  <li key={p.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0 text-[13px]">
                    <div>
                      <div className="font-medium text-text-primary">{p.number}</div>
                      <div className="text-xs text-text-muted">{formatDate(p.settlement_date)}</div>
                    </div>
                    <span className="font-medium tabular-nums text-success">
                      {formatMoney(alloc ? alloc.allocated_amount_base : p.amount, bill.currency)}
                    </span>
                  </li>
                );
              })
            ) : (
              <li className="flex items-center justify-between text-[13px]">
                <span className="text-text-secondary">Payment sent</span>
                <span className="font-medium tabular-nums text-success">{formatMoney(bill.settled, bill.currency)}</span>
              </li>
            )}
          </ul>
        ) : (
          <p className="text-[13px] text-text-muted">No payments made yet.</p>
        )}
      </section>

      <section className={cn(CARD, 'p-5 flex flex-col gap-3')} aria-label="Activity">
        <SectionTitle>Activity</SectionTitle>
        <DocumentAuditTimeline
          documentId={bill.id}
          documentNumber={bill.number || bill.reference}
          documentType="bill"
          documentStatus={bill.status}
          createdAt={bill.created_at}
          createdBy={bill.created_by}
          submittedBy={bill.submitted_by}
          postedAt={bill.posted_at}
          approvedBy={bill.approved_by}
          signedAt={bill.signed_at}
          signatureHash={bill.signature_hash}
          memo={bill.memo}
          total={bill.total}
          currency={bill.currency}
          linesCount={bill.lines.length}
          contactName={contact?.name}
          settledAmount={bill.settled}
          journalId={bill.journal_id}
        />
      </section>

      <section className={cn(CARD, 'overflow-hidden')} aria-label="How it's recorded">
        <button
          type="button"
          onClick={() => setJournalOpen((o) => !o)}
          aria-expanded={journalOpen}
          className="flex w-full items-center justify-between gap-2 px-5 py-4 text-left hover:bg-surface-neutral/60 transition-colors"
        >
          <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <BookOpen className="size-4 text-text-muted" /> How it's recorded
          </span>
          <ChevronDown className={cn('size-4 text-text-muted transition-transform', journalOpen && 'rotate-180')} />
        </button>
        {journalOpen && (
          <div className="border-t border-border px-5 py-4">
            <p className="mb-3 text-xs text-text-muted">
              {posted ? 'Entries in the general ledger for this bill.' : 'Entries that will be recorded once this bill is approved.'}
            </p>
            <table className="w-full text-xs tabular-nums">
              <thead>
                <tr className="text-[11px] text-text-muted">
                  <th className="pb-1.5 text-left font-medium">Account</th>
                  <th className="pb-1.5 text-right font-medium">Dr</th>
                  <th className="pb-1.5 text-right font-medium">Cr</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/70">
                {journalLines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-1.5 pr-2 text-text-primary">
                      <span className="text-text-muted">{l.account_code}</span> {l.account_name}
                    </td>
                    <td className="py-1.5 text-right">{l.debit > 0 ? formatMoney(l.debit, bill.currency) : ''}</td>
                    <td className="py-1.5 text-right">{l.credit > 0 ? formatMoney(l.credit, bill.currency) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border-strong font-semibold text-text-primary">
                  <td className="pt-2">Total</td>
                  <td className="pt-2 text-right">{formatMoney(totalDr, bill.currency)}</td>
                  <td className="pt-2 text-right">{formatMoney(totalCr, bill.currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </aside>
  );
};
