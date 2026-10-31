import React from 'react';
import type { Invoice, Contact, Company } from '@/types';
import { formatMoney, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { paymentStatus, amountDue } from '@/lib/docStatus';

interface Props {
  invoice: Invoice;
  contact?: Contact;
  company: Company;
}

/** The invoice rendered as a printable paper sheet. */
export const InvoicePaper: React.FC<Props> = ({ invoice, contact, company }) => {
  const status = paymentStatus(invoice);
  const stamp = status === 'paid' ? 'PAID' : status === 'overdue' ? 'OVERDUE' : status === 'reversed' ? 'REVERSED' : null;
  const due = amountDue(invoice);
  const cur = invoice.currency;
  const isCredit = invoice.kind === 'credit_note';

  return (
    <article
      aria-label={`Invoice ${invoice.number ?? 'draft'}`}
      className="relative overflow-hidden rounded-xl bg-surface border border-border shadow-[var(--shadow-card,0_1px_2px_rgba(16,24,40,0.06))] px-6 py-8 sm:px-12 sm:py-12"
    >
      {stamp && (
        <div
          aria-hidden="true"
          className={cn(
            'pointer-events-none absolute left-12 top-[26rem] -rotate-[14deg] select-none rounded-lg border-[3px] px-5 py-1 text-4xl font-bold tracking-[0.2em] opacity-[0.14]',
            status === 'paid' && 'border-success text-success',
            status === 'overdue' && 'border-danger text-danger',
            status === 'reversed' && 'border-violet text-violet'
          )}
        >
          {stamp}
        </div>
      )}

      {/* Letterhead */}
      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-center gap-3">
          <span
            className="flex size-11 items-center justify-center rounded-xl text-white text-lg font-bold shadow-xs"
            style={{ background: 'var(--gradient-brand, var(--color-accent))' }}
          >
            {company.name.charAt(0).toUpperCase()}
          </span>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold text-text-primary">{company.name}</div>
            <div className="text-xs text-text-muted">{company.legal_name}</div>
            <div className="text-xs text-text-muted">
              {company.country} · Tax ID {company.tax_id}
            </div>
          </div>
        </div>
        <div className="text-right">
          <h2 className="text-3xl font-semibold tracking-tight text-text-primary">
            {isCredit ? 'Credit note' : 'Invoice'}
          </h2>
          <div className="mt-1 text-sm font-medium text-text-secondary tabular-nums">{invoice.number ?? 'Draft'}</div>
        </div>
      </div>

      {/* Bill to + dates */}
      <div className="mt-10 grid gap-8 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Bill to</div>
          <div className="mt-2 text-sm font-semibold text-text-primary">{contact?.name ?? 'Unknown customer'}</div>
          {contact?.legal_name && contact.legal_name !== contact.name && (
            <div className="text-[13px] text-text-secondary">{contact.legal_name}</div>
          )}
          {contact?.email && <div className="text-[13px] text-text-secondary">{contact.email}</div>}
          {contact?.tax_id && <div className="text-xs text-text-muted mt-1">Tax ID {contact.tax_id}</div>}
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:justify-self-end sm:text-right sm:min-w-64">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Issued</dt>
            <dd className="mt-1 text-[13px] text-text-primary">{formatDate(invoice.issue_date)}</dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Due</dt>
            <dd className="mt-1 text-[13px] text-text-primary">{formatDate(invoice.due_date)}</dd>
          </div>
          {invoice.reference && (
            <div className="col-span-2">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Reference</dt>
              <dd className="mt-1 text-[13px] text-text-primary">{invoice.reference}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* Lines */}
      <div className="mt-10 overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="border-b border-border-strong text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              <th className="py-2 text-left font-semibold">Description</th>
              <th className="py-2 w-16 text-right font-semibold">Qty</th>
              <th className="py-2 w-28 text-right font-semibold">Price</th>
              <th className="py-2 w-24 text-right font-semibold">Tax</th>
              <th className="py-2 w-28 text-right font-semibold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {invoice.lines.map((l) => (
              <tr key={l.id} className="border-b border-border/70 align-top">
                <td className="py-3 pr-4 text-text-primary">{l.description}</td>
                <td className="py-3 text-right tabular-nums text-text-secondary">{l.quantity}</td>
                <td className="py-3 text-right tabular-nums text-text-secondary">{formatMoney(l.unit_price_fc, cur)}</td>
                <td className="py-3 text-right tabular-nums text-text-muted">{formatMoney(l.tax_amount_fc, cur)}</td>
                <td className="py-3 text-right tabular-nums font-medium text-text-primary">
                  {formatMoney(l.line_total_fc, cur)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className="mt-6 flex justify-end">
        <dl className="w-full sm:w-72 flex flex-col gap-2 text-[13px] tabular-nums">
          <div className="flex justify-between text-text-secondary">
            <dt>Subtotal</dt>
            <dd className="text-text-primary">{formatMoney(invoice.subtotal, cur)}</dd>
          </div>
          <div className="flex justify-between text-text-secondary">
            <dt>Tax</dt>
            <dd className="text-text-primary">{formatMoney(invoice.tax_total, cur)}</dd>
          </div>
          <div className="flex justify-between border-t border-border-strong pt-3 text-base font-semibold text-text-primary">
            <dt>Total</dt>
            <dd>{formatMoney(invoice.total, cur)}</dd>
          </div>
          {invoice.settled > 0 && (
            <div className="flex justify-between text-text-secondary">
              <dt>Paid</dt>
              <dd className="text-success">{formatMoney(-invoice.settled, cur)}</dd>
            </div>
          )}
          <div
            className={cn(
              'flex justify-between rounded-lg px-3 py-2 text-sm font-semibold',
              due === 0 ? 'bg-success-soft text-success' : status === 'overdue' ? 'bg-danger-soft text-danger' : 'bg-surface-neutral text-text-primary'
            )}
          >
            <dt>Amount due</dt>
            <dd>{formatMoney(due, cur)}</dd>
          </div>
        </dl>
      </div>

      {/* Notes */}
      <div className="mt-12 grid gap-6 border-t border-border pt-6 text-[13px] text-text-secondary sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Notes</div>
          <p className="mt-2 leading-relaxed">{invoice.memo || 'Thank you for your business.'}</p>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Payment instructions</div>
          <p className="mt-2 leading-relaxed">
            Pay by bank transfer within {Math.max(0, Math.round((new Date(invoice.due_date).getTime() - new Date(invoice.issue_date).getTime()) / 86_400_000))}{' '}
            days of the issue date. Please quote <span className="font-medium text-text-primary">{invoice.number ?? 'the invoice number'}</span> as the payment reference.
          </p>
        </div>
      </div>
    </article>
  );
};
