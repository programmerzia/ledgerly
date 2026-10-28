import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerStore } from '@/mock/store';
import { Invoice, Contact, Account, AuditEvent } from '@/types';
import { DocumentHeader } from '@/components/domain/DocumentHeader';
import { ApprovalBar } from '@/components/domain/ApprovalBar';
import { SignDialog } from '@/components/domain/SignDialog';
import { StatusPill } from '@/components/domain/StatusPill';
import { formatMoney, formatDate, formatDateTime } from '@/lib/format';
import { toast } from 'sonner';
import { DocumentAuditTimeline } from '@/components/domain/DocumentAuditTimeline';
import {
  FileText,
  BookOpen,
  CreditCard,
  History,
  Printer,
  Copy,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  ShieldCheck,
  Building,
  Calendar,
  Hash,
} from 'lucide-react';

export const InvoiceView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // All Hooks declared at the very top (per Rules of Hooks)
  const { currentCompany, currentUser, contacts, accounts, invoices } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const invoiceFromStore = invoices.find((i) => i.id === id);
  const [invoice, setInvoice] = useState<Invoice | null>(invoiceFromStore || null);
  const [activeTab, setActiveTab] = useState<'doc' | 'journal' | 'payments' | 'activity'>('doc');
  const [loading, setLoading] = useState(!invoiceFromStore);
  const [signDialogOpen, setSignDialogOpen] = useState(false);

  useEffect(() => {
    let active = true;
    async function fetchDoc() {
      if (!id) return;
      try {
        const doc = await api.getInvoiceById(id);
        if (active && doc) setInvoice(doc);
      } catch (err) {
        const fallback = invoices.find((i) => i.id === id);
        if (active && fallback) setInvoice(fallback);
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchDoc();
    return () => {
      active = false;
    };
  }, [id, invoices]);

  if (loading && !invoice) {
    return (
      <div className="p-8 text-center text-xs text-text-muted flex items-center justify-center gap-2">
        <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <span>Loading invoice {id}...</span>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-12 text-center max-w-md mx-auto flex flex-col items-center gap-4">
        <AlertCircle className="w-10 h-10 text-danger" />
        <h2 className="text-base font-bold text-text-primary">Invoice Not Found</h2>
        <p className="text-xs text-text-muted">
          The requested document ID <span className="font-mono text-text-primary font-medium">{id}</span> does not exist or has been removed.
        </p>
        <button
          onClick={() => navigate(`/${coSlug}/invoices`)}
          className="h-8 px-4 rounded-sm bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-xs transition"
        >
          Return to Sales Invoices
        </button>
      </div>
    );
  }

  const contact = contacts.find((c) => c.id === invoice.contact_id);

  // Derived Journal Preview (07_Mock_Brief §7 requirement: derived from lines, never hard-coded!)
  const derivedJournalLines = [
    {
      id: 'prev-ar',
      account_code: '1200',
      account_name: 'Accounts Receivable (AR Control)',
      debit: invoice.total,
      credit: 0,
      description: `Receivable for ${invoice.number || 'Invoice'}`,
    },
    ...invoice.lines.map((l, idx) => {
      const acc = accounts.find((a) => a.id === l.account_id);
      return {
        id: `prev-rev-${idx}`,
        account_code: acc?.code || '4000',
        account_name: acc?.name || 'Sales Revenue',
        debit: 0,
        credit: l.line_total_fc,
        description: l.description,
      };
    }),
    ...(invoice.tax_total > 0
      ? [
          {
            id: 'prev-tax',
            account_code: '2100',
            account_name: 'VAT Output',
            debit: 0,
            credit: invoice.tax_total,
            description: `VAT Output for ${invoice.number || 'Invoice'}`,
          },
        ]
      : []),
  ];

  const totalDr = derivedJournalLines.reduce((s, l) => s + l.debit, 0);
  const totalCr = derivedJournalLines.reduce((s, l) => s + l.credit, 0);

  const handleApprove = async () => {
    if (invoice.created_by === currentUser.id || invoice.submitted_by === currentUser.id) {
      toast.error('Segregation of Duties: Creator cannot approve their own invoice. Switch persona to Fatima Hassan.');
      return;
    }
    setSignDialogOpen(true);
  };

  const handleConfirmSign = async (pin: string) => {
    try {
      const res = await api.approveInvoice(invoice.id, pin);
      setInvoice(res);
      toast.success(`Invoice ${res.number} authorized and posted to General Ledger`);
      setSignDialogOpen(false);
    } catch (err: any) {
      toast.error(err.message || 'Approval signing failed');
    }
  };

  const handleReturn = async (comment: string) => {
    try {
      const res = await api.returnInvoice(invoice.id, comment);
      setInvoice(res);
      toast.info('Invoice returned to Maker for revisions');
    } catch (err: any) {
      toast.error(err.message || 'Return failed');
    }
  };

  return (
    <div className="flex flex-col gap-6 pb-20">
      {/* Document Header */}
      <DocumentHeader
        documentType="Sales Invoice"
        number={invoice.number}
        status={invoice.status}
        issueDate={invoice.issue_date}
        dueDate={invoice.due_date}
        amount={invoice.total}
        currency={invoice.currency}
        contactName={contact?.name}
        reference={invoice.reference}
        onBack={() => navigate(`/${coSlug}/invoices`)}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="flex items-center gap-1.5 h-8 px-3 rounded-sm border border-border hover:border-border-strong bg-surface text-text-primary text-xs font-medium hover:bg-surface-neutral transition"
            >
              <Printer className="w-3.5 h-3.5 text-text-muted" />
              <span>Print / PDF</span>
            </button>
            {invoice.status === 'posted' && (
              <button
                type="button"
                onClick={() => navigate(`/${coSlug}/receipts/new?invoiceId=${invoice.id}`)}
                className="flex items-center gap-1.5 h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded-sm text-xs font-semibold shadow-xs transition"
              >
                <CreditCard className="w-3.5 h-3.5" />
                <span>Record Receipt</span>
              </button>
            )}
          </div>
        }
      />

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1 border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab('doc')}
          className={`flex items-center gap-2 px-4 py-2 border-b-2 text-xs font-medium transition-colors ${
            activeTab === 'doc'
              ? 'border-accent text-accent font-semibold'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <FileText className="w-3.5 h-3.5" />
          <span>Document</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('journal')}
          className={`flex items-center gap-2 px-4 py-2 border-b-2 text-xs font-medium transition-colors ${
            activeTab === 'journal'
              ? 'border-accent text-accent font-semibold'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <BookOpen className="w-3.5 h-3.5" />
          <span>Journal Preview</span>
          <span className="text-[10px] bg-accent-soft text-accent px-1.5 py-0.2 rounded font-mono">
            {invoice.status === 'posted' ? 'Committed' : 'Live Derived'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('payments')}
          className={`flex items-center gap-2 px-4 py-2 border-b-2 text-xs font-medium transition-colors ${
            activeTab === 'payments'
              ? 'border-accent text-accent font-semibold'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <CreditCard className="w-3.5 h-3.5" />
          <span>Payments & Settlements</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('activity')}
          className={`flex items-center gap-2 px-4 py-2 border-b-2 text-xs font-medium transition-colors ${
            activeTab === 'activity'
              ? 'border-accent text-accent font-semibold'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <History className="w-3.5 h-3.5" />
          <span>Full Audit Log</span>
          <span className="text-[10px] bg-surface-neutral text-text-muted px-1.5 py-0.2 rounded font-mono">
            Immutable
          </span>
        </button>
      </div>

      {/* Tab 1: Document View */}
      {activeTab === 'doc' && (
        <div className="flex flex-col gap-6 bg-surface border border-border rounded-lg p-6 shadow-2xs">
          {/* Customer & Company Details Block */}
          <div className="grid grid-cols-2 gap-8 pb-6 border-b border-border text-xs">
            <div>
              <span className="text-[10px] uppercase font-bold text-text-muted tracking-wider">
                Billed To
              </span>
              <div className="text-sm font-bold text-text-primary mt-1">{contact?.name}</div>
              <div className="text-text-secondary mt-0.5">{contact?.legal_name || contact?.name}</div>
              <div className="text-text-muted font-mono mt-1">Tax ID: {contact?.tax_id || 'N/A'}</div>
              <div className="text-text-secondary mt-1">{contact?.email}</div>
            </div>

            <div className="text-right">
              <span className="text-[10px] uppercase font-bold text-text-muted tracking-wider">
                Issuer Details
              </span>
              <div className="text-sm font-bold text-text-primary mt-1">{currentCompany.name}</div>
              <div className="text-text-secondary mt-0.5">{currentCompany.legal_name}</div>
              <div className="text-text-muted font-mono mt-1">Tax ID: {currentCompany.tax_id}</div>
              <div className="text-text-muted font-mono mt-1">Base Currency: {currentCompany.base_currency}</div>
            </div>
          </div>

          {/* Lines Table */}
          <table className="w-full border-collapse table-dense text-left text-xs">
            <thead>
              <tr className="bg-surface-neutral border-b border-border text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                <th className="w-10 text-center">#</th>
                <th>Item / Description</th>
                <th className="w-32">Dimension</th>
                <th className="w-20 text-right">Qty</th>
                <th className="w-32 text-right">Unit Price</th>
                <th className="w-24 text-right">Tax</th>
                <th className="w-32 text-right">Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {invoice.lines.map((l, idx) => (
                <tr key={l.id} className="hover:bg-surface-neutral/40">
                  <td className="text-center font-mono text-text-muted">{idx + 1}</td>
                  <td className="font-medium text-text-primary">{l.description}</td>
                  <td>
                    <span className="font-mono text-[11px] bg-accent-soft text-accent px-1.5 py-0.5 rounded">
                      Branch: {l.dimensions?.branch || 'Mogadishu'}
                    </span>
                  </td>
                  <td className="text-right font-mono text-text-primary">{l.quantity}</td>
                  <td className="text-right font-mono text-text-muted">
                    {formatMoney(l.unit_price_fc, invoice.currency)}
                  </td>
                  <td className="text-right font-mono text-text-muted">
                    {formatMoney(l.tax_amount_fc, invoice.currency)}
                  </td>
                  <td className="text-right font-mono font-semibold text-text-primary pr-3">
                    {formatMoney(l.line_total_fc, invoice.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals Summary */}
          <div className="flex justify-end pt-4 border-t border-border">
            <div className="w-72 flex flex-col gap-2 text-xs font-mono">
              <div className="flex justify-between text-text-muted">
                <span>Subtotal:</span>
                <span className="font-medium text-text-primary">{formatMoney(invoice.subtotal, invoice.currency)}</span>
              </div>
              <div className="flex justify-between text-text-muted">
                <span>Tax Total:</span>
                <span className="font-medium text-text-primary">{formatMoney(invoice.tax_total, invoice.currency)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-border text-sm font-bold text-text-primary">
                <span>Grand Total:</span>
                <span className="text-accent">{formatMoney(invoice.total, invoice.currency)}</span>
              </div>
              <div className="flex justify-between text-[11px] text-text-muted pt-1">
                <span>Settled Amount:</span>
                <span>{formatMoney(invoice.settled, invoice.currency)}</span>
              </div>
              <div className="flex justify-between text-xs font-semibold text-danger">
                <span>Balance Due:</span>
                <span>{formatMoney(invoice.total - invoice.settled, invoice.currency)}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Derived Journal Preview (Demo Step 3 Requirement!) */}
      {activeTab === 'journal' && (
        <div className="flex flex-col gap-4 bg-surface border border-border rounded-lg p-6 shadow-2xs">
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h3 className="text-sm font-semibold text-text-primary flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-accent" />
                Double-Entry General Ledger Derivation
              </h3>
              <p className="text-xs text-text-muted mt-0.5">
                Automatically generated debit/credit postings derived from invoice lines and control account policies.
              </p>
            </div>
            {invoice.status === 'posted' && (
              <span className="text-xs font-mono font-semibold text-success flex items-center gap-1.5">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Committed to General Ledger
              </span>
            )}
          </div>

          <table className="w-full border-collapse table-dense text-left text-xs">
            <thead>
              <tr className="bg-surface-neutral border-b border-border text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                <th className="w-24">GL Code</th>
                <th>Account Title</th>
                <th>Memo / Description</th>
                <th className="w-32 text-right">Debit (Dr)</th>
                <th className="w-32 text-right">Credit (Cr)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {derivedJournalLines.map((row) => (
                <tr key={row.id}>
                  <td className="font-mono font-semibold text-accent">{row.account_code}</td>
                  <td className="font-medium text-text-primary">{row.account_name}</td>
                  <td className="text-text-muted">{row.description}</td>
                  <td className="text-right font-mono font-semibold text-text-primary">
                    {row.debit > 0 ? formatMoney(row.debit, invoice.currency) : '—'}
                  </td>
                  <td className="text-right font-mono font-semibold text-text-primary pr-3">
                    {row.credit > 0 ? formatMoney(row.credit, invoice.currency) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface-neutral/60 font-mono font-bold text-xs border-t border-border-strong">
                <td colSpan={3} className="text-right pr-4 uppercase tracking-wider text-text-muted">
                  Total Balanced Postings:
                </td>
                <td className="text-right text-text-primary">{formatMoney(totalDr, invoice.currency)}</td>
                <td className="text-right text-text-primary pr-3">{formatMoney(totalCr, invoice.currency)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Tab 3: Payments */}
      {activeTab === 'payments' && (
        <div className="p-6 bg-surface border border-border rounded-lg shadow-2xs text-xs">
          {invoice.settled > 0 ? (
            <div className="flex flex-col gap-3">
              <span className="font-semibold text-text-primary">Applied Customer Receipts</span>
              <div className="p-3 bg-success-soft border border-success/30 rounded-md flex items-center justify-between">
                <div>
                  <div className="font-mono font-semibold text-success">RCT-2026-0016</div>
                  <div className="text-text-muted text-[11px]">Wire Transfer • Premier Bank USD</div>
                </div>
                <div className="text-right font-mono font-bold text-success">
                  {formatMoney(invoice.settled, invoice.currency)}
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-8 text-text-muted">
              No payments recorded against this invoice yet.
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Full Audit Log Trail */}
      {activeTab === 'activity' && (
        <div className="p-6 bg-surface border border-border rounded-lg shadow-2xs text-xs flex flex-col gap-4">
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
        </div>
      )}

      {/* Sticky Bottom Approval Bar for Pending Invoices (Demo Step 3 Requirement) */}
      {invoice.status === 'pending_approval' && (
        <ApprovalBar
          makerId={invoice.created_by}
          makerName="Rahim Ahmed"
          currentUserId={currentUser.id}
          submittedAt={invoice.created_at}
          amount={invoice.total}
          currency={invoice.currency}
          periodName="Oct 2026"
          documentNumber={invoice.number || 'DRAFT-0043'}
          onApprove={handleApprove}
          onReturn={handleReturn}
        />
      )}

      {/* 6-Digit PIN Signing Modal (Block D) */}
      <SignDialog
        isOpen={signDialogOpen}
        onClose={() => setSignDialogOpen(false)}
        onConfirm={handleConfirmSign}
        documentTitle={`Sales Invoice: ${contact?.name || 'Customer'}`}
        documentNumber={invoice.number || 'DRAFT-0043'}
        amount={invoice.total}
        currency={invoice.currency}
        periodName="Oct 2026"
        makerName="Rahim Ahmed"
        actionTitle="Authorize & Post Invoice"
        consequenceText={`Approving will assign sequence INV-2026-0043, post $4,200.00 to AR Control, credit Service Revenue $4,000.00 and VAT Output $200.00 in Oct 2026.`}
      />
    </div>
  );
};
