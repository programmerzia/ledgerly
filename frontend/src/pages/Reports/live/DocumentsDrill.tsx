/** Drill from a cell of the aging or a row of the tax return to the documents behind it, and from a document to its journal (3c.21). */
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, XCircle } from 'lucide-react';
import { fetchDrillDocuments } from '@/api/live/listings';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useRouteCompany } from '@/data/session';
import { formatDate } from '@/lib/format';
import { ReportError, ReportLoading, fmt } from './parts';

export interface DocumentsTarget {
  title: string;
  subtitle?: string;
  /** Path under reports/, for example `ar-aging/documents`. */
  path: string;
  query: Record<string, string>;
  /** What the clicked cell showed; the documents must add up to it. For the tax return: net first, then tax. */
  expected: { amount?: number; net?: number; tax?: number };
}

const KIND_LABEL: Record<string, string> = {
  sales_invoice: 'Invoice', credit_note: 'Credit note', purchase_bill: 'Bill', debit_note: 'Debit note',
  receipt: 'Receipt', refund: 'Refund', payment: 'Payment', supplier_refund: 'Supplier refund',
};

/** Where each kind of document opens (credit notes open like invoices, debit notes like bills). */
export function documentPath(slug: string, type: string, id: string): string | null {
  switch (type) {
    case 'sales_invoice':
    case 'credit_note':
      return `/${slug}/invoices/${id}`;
    case 'purchase_bill':
    case 'debit_note':
      return `/${slug}/bills/${id}`;
    case 'receipt':
    case 'refund':
      return `/${slug}/receipts/${id}`;
    case 'payment':
    case 'supplier_refund':
      return `/${slug}/payments/${id}`;
    default:
      return null;
  }
}

const Tie: React.FC<{ ok: boolean; children: React.ReactNode }> = ({ ok, children }) => (
  <span className="inline-flex items-center gap-1.5">
    {ok ? <CheckCircle2 className="size-3.5 text-success" aria-label="yes" /> : <XCircle className="size-3.5 text-danger" aria-label="no" />}
    {children}
  </span>
);

export const DocumentsDrill: React.FC<{ target: DocumentsTarget | null; onClose: () => void }> = ({ target, onClose }) => {
  const company = useRouteCompany();
  const money = fmt(company.base_currency);
  const q = useQuery({
    queryKey: ['reports', company.id, 'documents', target?.path, target?.query],
    queryFn: ({ signal }) => fetchDrillDocuments(company.id, target!.path, target!.query, signal),
    enabled: target !== null,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const d = q.data;
  const tax = d?.totals !== undefined;
  const sumAmount = d ? d.documents.reduce((s, x) => s + (x.amount?.amount ?? 0), 0) : 0;
  const sumNet = d ? d.documents.reduce((s, x) => s + (x.net?.amount ?? 0), 0) : 0;
  const sumTax = d ? d.documents.reduce((s, x) => s + (x.tax?.amount ?? 0), 0) : 0;
  const ties = d && target && (tax
    ? sumNet === (target.expected.net ?? sumNet) && sumTax === (target.expected.tax ?? sumTax)
    : sumAmount === (target.expected.amount ?? sumAmount));

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{target?.title ?? 'Documents'}</DialogTitle>
          <DialogDescription>{target?.subtitle ?? ''}</DialogDescription>
        </DialogHeader>
        {q.isPending && target && <ReportLoading what="documents" />}
        {q.isError && <ReportError error={q.error} onRetry={() => void q.refetch()} what="these documents" />}
        {d && (
          <>
            <div className="max-h-[50vh] overflow-auto rounded-md border border-border" data-testid="documents-drill">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left">Document</th>
                    {!tax && <th className="px-3 py-2 text-left">Contact</th>}
                    <th className="px-3 py-2 text-left">{tax ? 'Date' : 'Due'}</th>
                    <th className="px-3 py-2 text-left">Journal</th>
                    {tax ? <><th className="px-3 py-2 text-right">Net</th><th className="px-3 py-2 text-right">Tax</th></> : <th className="px-3 py-2 text-right">Amount</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {d.documents.map((x, i) => {
                    const href = documentPath(company.slug, x.document.type, x.document.id);
                    const journalId = x.journal?.id ?? x.journal_id ?? null;
                    return (
                      <tr key={`${x.document.id}-${i}`}>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          <span className="text-text-muted">{KIND_LABEL[x.document.type] ?? x.document.type} </span>
                          {href ? <Link to={href} className="text-accent hover:underline">{x.document.number ?? 'Draft'}</Link> : (x.document.number ?? '—')}
                          {x.is_reversal && <span className="ml-1 text-text-muted">(reversal)</span>}
                        </td>
                        {!tax && <td className="px-3 py-1.5 text-text-primary">{x.contact?.name ?? ''}</td>}
                        <td className="px-3 py-1.5 tabular-nums whitespace-nowrap text-text-muted">
                          {formatDate(tax ? x.date : (x.due_date ?? x.date))}
                          {!tax && x.days_overdue ? ` · ${x.days_overdue} days late` : ''}
                        </td>
                        <td className="px-3 py-1.5 whitespace-nowrap">
                          {journalId ? <Link to={`/${company.slug}/journals/${journalId}`} className="text-accent hover:underline">{x.journal?.number ?? 'Open'}</Link> : '—'}
                        </td>
                        {tax ? <><td className="px-3 py-1.5 text-right tabular-nums">{money(x.net?.amount ?? 0)}</td><td className="px-3 py-1.5 text-right tabular-nums">{money(x.tax?.amount ?? 0)}</td></>
                          : <td className="px-3 py-1.5 text-right tabular-nums">{money(x.amount?.amount ?? 0)}</td>}
                      </tr>
                    );
                  })}
                  {d.documents.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-text-muted">No documents.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs" data-testid="documents-total">
              <Tie ok={Boolean(ties)}>
                {tax ? `Net ${money(sumNet)}, tax ${money(sumTax)}` : `Total ${money(sumAmount)}`}
                {ties ? ' · adds up to the figure you clicked' : ' · does not add up to the figure you clicked'}
              </Tie>
              <span className="text-text-muted">{d.documents.length} document{d.documents.length === 1 ? '' : 's'}</span>
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
