import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  Bell,
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
  Repeat,
  Send,
} from 'lucide-react';
import type { Invoice, Contact, Settlement } from '@/types';
import { StatusPill } from '@/components/domain/StatusPill';
import { NameAvatar } from '@/components/domain/NameAvatar';
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
import { CARD, BTN_PRIMARY, BTN_SECONDARY } from './shared';
import { MakeRecurringDialog } from '../MakeRecurringDialog';

export interface JournalPreviewLine {
  id: string;
  account_code: string;
  account_name: string;
  debit: number;
  credit: number;
}

export interface InvoiceSidebarActions {
  approve: () => void;
  recordPayment: () => void;
  sendReminder: () => void;
  submit: () => void;
  print: () => void;
  duplicate: () => void;
  creditNote: () => void;
  copyLink: () => void;
  email: () => void;
  attach: () => void;
  refund: () => void;
  fixThis: () => void;
  reverse: () => void;
}

interface Props {
  invoice: Invoice;
  contact?: Contact;
  contactBalance: number;
  payments: Settlement[];
  journalLines: JournalPreviewLine[];
  coSlug: string;
  actions: InvoiceSidebarActions;
}

const SectionTitle: React.FC<{ children: React.ReactNode; aside?: React.ReactNode }> = ({ children, aside }) => (
  <div className="flex items-center justify-between">
    <h3 className="text-sm font-semibold text-text-primary">{children}</h3>
    {aside}
  </div>
);

export const InvoiceSidebar: React.FC<Props> = ({
  invoice,
  contact,
  contactBalance,
  payments,
  journalLines,
  coSlug,
  actions,
}) => {
  const [journalOpen, setJournalOpen] = useState(false);
  const [recurringOpen, setRecurringOpen] = useState(false);
  const pay = paymentStatus(invoice);
  const due = amountDue(invoice);
  const pct = invoice.total > 0 ? Math.min(100, Math.round((invoice.settled / invoice.total) * 100)) : 0;
  const late = daysOverdue(invoice);
  const posted = invoice.status === 'posted';
  const daysToDue = Math.round(
    (new Date(invoice.due_date).getTime() - new Date(BUSINESS_TODAY).getTime()) / 86_400_000
  );
  const dueText =
    pay === 'paid'
      ? 'Fully paid'
      : pay === 'overdue'
      ? `${late} ${late === 1 ? 'day' : 'days'} overdue`
      : posted
      ? daysToDue <= 0
        ? 'Due today'
        : `Due in ${daysToDue} ${daysToDue === 1 ? 'day' : 'days'}`
      : `Due ${formatDate(invoice.due_date)}`;
  const hasPrimary = invoice.status === 'draft' || invoice.status === 'pending_approval' || (posted && due > 0);
  const totalDr = journalLines.reduce((s, l) => s + l.debit, 0);
  const totalCr = journalLines.reduce((s, l) => s + l.credit, 0);

  return (
    <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
      <MakeRecurringDialog open={recurringOpen} onOpenChange={setRecurringOpen} invoiceId={invoice.id} />
      {/* Status card */}
      <section className={cn(CARD, 'p-5 flex flex-col gap-4')} aria-label="Payment status">
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusPill status={pay} />
          {posted && pay !== 'reversed' && <StatusPill status="posted" label="In the books" />}
        </div>
        <div>
          <div className="text-xs text-text-muted">{pay === 'paid' ? 'Total paid' : 'Amount due'}</div>
          <div
            className={cn(
              'mt-1 text-3xl font-semibold tracking-tight tabular-nums',
              pay === 'overdue' ? 'text-danger' : pay === 'paid' ? 'text-success' : 'text-text-primary'
            )}
          >
            {formatMoney(pay === 'paid' ? invoice.total : due, invoice.currency)}
          </div>
          <div className={cn('mt-1 text-[13px]', pay === 'overdue' ? 'text-danger font-medium' : 'text-text-muted')}>
            {dueText}
          </div>
        </div>
        {posted && (
          <div>
            <div className="h-2 rounded-full bg-surface-neutral overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Paid">
              <div
                className={cn('h-full rounded-full transition-all duration-300', pct === 100 ? 'bg-success' : 'bg-accent')}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-text-muted tabular-nums">
              <span>{formatMoney(invoice.settled, invoice.currency)} paid</span>
              <span>of {formatMoney(invoice.total, invoice.currency)}</span>
            </div>
          </div>
        )}

        {/* Primary action by state */}
        <div className="flex flex-wrap gap-2">
          {invoice.status === 'draft' && (
            <button type="button" onClick={actions.submit} className={cn(BTN_PRIMARY, 'flex-1')}>
              <Send className="size-4" /> Submit for approval
            </button>
          )}
          {invoice.status === 'pending_approval' && (
            <button type="button" onClick={actions.approve} className={cn(BTN_PRIMARY, 'flex-1')}>
              <CheckCircle2 className="size-4" /> Approve
            </button>
          )}
          {posted && due > 0 && (
            <button type="button" onClick={actions.recordPayment} className={cn(BTN_PRIMARY, 'flex-1 whitespace-nowrap', pay === 'overdue' && 'basis-full')}>
              <CreditCard className="size-4" /> Record payment
            </button>
          )}
          {posted && due > 0 && pay === 'overdue' && (
            <button type="button" onClick={actions.sendReminder} className={cn(BTN_SECONDARY, 'flex-1 whitespace-nowrap')}>
              <Bell className="size-4 text-text-muted" /> Send reminder
            </button>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="More actions"
                className={cn(BTN_SECONDARY, hasPrimary ? 'px-2.5' : 'flex-1')}
              >
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
                  <Mail className="size-4 text-text-muted" /> Email invoice
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={actions.duplicate} className="h-8 gap-2 rounded-md">
                <Copy className="size-4 text-text-muted" /> Duplicate
              </DropdownMenuItem>
              {posted && (
                <DropdownMenuItem onSelect={() => setRecurringOpen(true)} className="h-8 gap-2 rounded-md">
                  <Repeat className="size-4 text-text-muted" /> Make recurring…
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={actions.copyLink} className="h-8 gap-2 rounded-md">
                <Link2 className="size-4 text-text-muted" /> Copy link
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={actions.attach} className="h-8 gap-2 rounded-md">
                <Paperclip className="size-4 text-text-muted" /> Attachments
              </DropdownMenuItem>
              {posted && (
                <>
                  <DropdownMenuSeparator className="my-1" />
                  <DropdownMenuItem onSelect={actions.creditNote} className="h-8 gap-2 rounded-md">
                    <FileMinus className="size-4 text-text-muted" /> Issue credit note
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={actions.refund} className="h-8 gap-2 rounded-md">
                    <RotateCcw className="size-4 text-text-muted" /> Issue refund
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={actions.fixThis} className="h-8 gap-2 rounded-md">
                    <Wrench className="size-4 text-text-muted" /> Fix this invoice
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="my-1" />
                  <DropdownMenuItem
                    onSelect={actions.reverse}
                    className="h-8 gap-2 rounded-md text-danger focus:bg-danger-soft focus:text-danger"
                  >
                    <RotateCcw className="size-4" /> Reverse invoice
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>

      {/* Customer */}
      {contact && (
        <section className={cn(CARD, 'p-5 flex flex-col gap-3')} aria-label="Customer">
          <SectionTitle>Customer</SectionTitle>
          <div className="flex items-center gap-3">
            <NameAvatar name={contact.name} size="lg" />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text-primary">{contact.name}</div>
              <div className="truncate text-xs text-text-muted">{contact.email}</div>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-surface-neutral px-3 py-2 text-[13px]">
            <span className="text-text-muted">Balance owed</span>
            <span className="font-semibold tabular-nums text-text-primary">
              {formatMoney(contactBalance, contact.default_currency)}
            </span>
          </div>
          <Link to={`/${coSlug}/customers/${contact.id}`} className="text-[13px] font-medium text-accent hover:underline">
            View customer
          </Link>
        </section>
      )}

      {/* Payments */}
      <section className={cn(CARD, 'p-5 flex flex-col gap-3')} aria-label="Payments">
        <SectionTitle>Payments</SectionTitle>
        {invoice.settled > 0 ? (
          <ul className="flex flex-col divide-y divide-border">
            {payments.length > 0 ? (
              payments.map((p) => {
                const alloc = p.allocations.find((a) => a.invoice_id === invoice.id);
                return (
                  <li key={p.id} className="flex items-center justify-between py-2 first:pt-0 last:pb-0 text-[13px]">
                    <div>
                      <div className="font-medium text-text-primary">{p.number}</div>
                      <div className="text-xs text-text-muted">{formatDate(p.settlement_date)}</div>
                    </div>
                    <span className="font-medium tabular-nums text-success">
                      {formatMoney(alloc ? alloc.allocated_amount_base : p.amount, invoice.currency)}
                    </span>
                  </li>
                );
              })
            ) : (
              <li className="flex items-center justify-between text-[13px]">
                <span className="text-text-secondary">Payment received</span>
                <span className="font-medium tabular-nums text-success">{formatMoney(invoice.settled, invoice.currency)}</span>
              </li>
            )}
          </ul>
        ) : (
          <p className="text-[13px] text-text-muted">No payments recorded yet.</p>
        )}
      </section>

      {/* Activity */}
      <section className={cn(CARD, 'p-5 flex flex-col gap-3')} aria-label="Activity">
        <SectionTitle>Activity</SectionTitle>
        <DocumentAuditTimeline
          documentId={invoice.id}
          documentNumber={invoice.number}
          documentType="invoice"
          documentStatus={invoice.status}
          createdAt={invoice.created_at}
          createdBy={invoice.created_by}
          submittedBy={invoice.submitted_by}
          postedAt={invoice.posted_at}
          approvedBy={invoice.approved_by}
          signedAt={invoice.signed_at}
          signatureHash={invoice.signature_hash}
          memo={invoice.memo}
          total={invoice.total}
          currency={invoice.currency}
          linesCount={invoice.lines.length}
          contactName={contact?.name}
          settledAmount={invoice.settled}
          journalId={invoice.journal_id}
        />
      </section>

      {/* How it's recorded */}
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
              {posted ? 'Entries in the general ledger for this invoice.' : 'Entries that will be recorded once this invoice is approved.'}
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
                    <td className="py-1.5 text-right">{l.debit > 0 ? formatMoney(l.debit, invoice.currency) : ''}</td>
                    <td className="py-1.5 text-right">{l.credit > 0 ? formatMoney(l.credit, invoice.currency) : ''}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border-strong font-semibold text-text-primary">
                  <td className="pt-2">Total</td>
                  <td className="pt-2 text-right">{formatMoney(totalDr, invoice.currency)}</td>
                  <td className="pt-2 text-right">{formatMoney(totalCr, invoice.currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </aside>
  );
};
