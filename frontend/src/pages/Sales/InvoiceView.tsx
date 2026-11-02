import { selectByMode } from '@/data/select';
import { InvoiceViewLive } from './live/InvoiceViewLive';
import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerStore } from '@/mock/store';
import { Invoice } from '@/types';
import { ApprovalBar } from '@/components/domain/ApprovalBar';
import { SignDialog } from '@/components/domain/SignDialog';
import { StatusPill } from '@/components/domain/StatusPill';
import { PageHeader } from '@/components/domain/PageHeader';
import { CustomerRefundDialog } from '@/components/domain/CustomerRefundDialog';
import { formatMoney } from '@/lib/format';
import { paymentStatus, amountDue } from '@/lib/docStatus';
import { toast } from 'sonner';
import { AlertCircle, Download, Link2, RotateCcw } from 'lucide-react';
import { InvoicePaper } from './invoice-view/InvoicePaper';
import { InvoiceSidebar, type JournalPreviewLine } from './invoice-view/InvoiceSidebar';
import {
  ReverseInvoiceDialog,
  FixInvoiceDialog,
  EmailInvoiceDialog,
  AttachmentsDialog,
} from './invoice-view/InvoiceDialogs';
import { BTN_SECONDARY } from './invoice-view/shared';

/** Loads the invoice (store first, then API) and hands it to the detail page. */
const MockInvoiceView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentCompany, invoices } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const invoiceFromStore = invoices.find((i) => i.id === id);
  const [invoice, setInvoice] = useState<Invoice | null>(invoiceFromStore || null);
  const [loading, setLoading] = useState(!invoiceFromStore);

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
        <span>Loading invoice...</span>
      </div>
    );
  }

  if (!invoice) {
    return (
      <div className="p-12 text-center max-w-md mx-auto flex flex-col items-center gap-4">
        <AlertCircle className="w-10 h-10 text-danger" />
        <h2 className="text-base font-semibold text-text-primary">Invoice not found</h2>
        <p className="text-xs text-text-muted">
          We couldn't find <span className="font-mono text-text-primary font-medium">{id}</span>. It may have been removed.
        </p>
        <button
          onClick={() => navigate(`/${coSlug}/invoices`)}
          className="h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition"
        >
          Back to invoices
        </button>
      </div>
    );
  }

  return <InvoiceDetail invoice={invoice} setInvoice={setInvoice} />;
};

const InvoiceDetail: React.FC<{ invoice: Invoice; setInvoice: (i: Invoice) => void }> = ({ invoice, setInvoice }) => {
  const navigate = useNavigate();
  const { currentCompany, currentUser, currentPeriod, users, contacts, accounts, settlements, invoices } = useLedgerStore();
  const coSlug = currentCompany.slug;
  const contact = contacts.find((c) => c.id === invoice.contact_id);
  const makerName = users.find((u) => u.id === invoice.created_by)?.name ?? 'the maker';

  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [signAction, setSignAction] = useState<'approve' | 'reverse' | 'fix_this' | null>(null);
  const [isReverseDialogOpen, setIsReverseDialogOpen] = useState(false);
  const [isFixThisDialogOpen, setIsFixThisDialogOpen] = useState(false);
  const [emailMode, setEmailMode] = useState<'invoice' | 'reminder' | null>(null);
  const [isAttachDialogOpen, setIsAttachDialogOpen] = useState(false);
  const [isRefundDialogOpen, setIsRefundDialogOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState('');

  // Journal preview is derived from the invoice lines, never hard-coded.
  const journalLines: JournalPreviewLine[] = [
    { id: 'prev-ar', account_code: '1200', account_name: 'Accounts receivable', debit: invoice.total, credit: 0 },
    ...invoice.lines.map((l, idx) => {
      const acc = accounts.find((a) => a.id === l.account_id);
      return {
        id: `prev-rev-${idx}`,
        account_code: acc?.code || '4000',
        account_name: acc?.name || 'Sales revenue',
        debit: 0,
        credit: l.line_total_fc,
      };
    }),
    ...(invoice.tax_total > 0
      ? [{ id: 'prev-tax', account_code: '2100', account_name: 'VAT output', debit: 0, credit: invoice.tax_total }]
      : []),
  ];

  const payments = (settlements || []).filter(
    (s) => s.kind === 'receipt' && s.status !== 'void' && s.allocations.some((a) => a.invoice_id === invoice.id)
  );

  const handleApprove = async () => {
    if (invoice.created_by === currentUser.id || invoice.submitted_by === currentUser.id) {
      toast.error('Segregation of Duties: Creator cannot approve their own invoice. Switch persona to Fatima Hassan.');
      return;
    }
    setSignAction('approve');
    setSignDialogOpen(true);
  };

  const handleConfirmSign = async (pin: string) => {
    try {
      if (signAction === 'approve') {
        const res = await api.approveInvoice(invoice.id, pin);
        setInvoice(res);
        toast.success(`Invoice ${res.number} authorized and posted to General Ledger`);
      } else if (signAction === 'reverse') {
        const res = await api.reverseInvoice(invoice.id, reverseReason, pin);
        setInvoice(res.original);
        toast.success(`Invoice reversed. Reversal document ${res.reversal.number} created and posted.`);
      } else if (signAction === 'fix_this') {
        await api.reverseInvoice(invoice.id, 'Reversed via Fix This flow', pin);
        const dup = await api.duplicateInvoice(invoice.id);
        toast.success('Original invoice reversed. Now editing corrected draft copy.');
        navigate(`/${coSlug}/invoices/${dup.id}`);
        return;
      }
      setSignAction(null);
      setSignDialogOpen(false);
    } catch (err: any) {
      toast.error(err.message || 'Operation failed');
    }
  };

  const handleReturn = async (comment: string) => {
    try {
      const prevInvoice = { ...invoice };
      const res = await api.returnInvoice(invoice.id, comment);
      setInvoice(res);
      toast.info(`Invoice returned to Maker for revisions: "${comment}"`, {
        duration: 10000,
        action: {
          label: 'Undo',
          onClick: () => {
            useLedgerStore.setState((s: any) => ({
              invoices: s.invoices.map((i: Invoice) => (i.id === invoice.id ? prevInvoice : i)),
            }));
            setInvoice(prevInvoice);
            toast.success('Return undone. Invoice restored to pending approval.');
          },
        },
      });
    } catch (err: any) {
      toast.error(err.message || 'Return failed');
    }
  };

  const handleDuplicate = async () => {
    const dup = await api.duplicateInvoice(invoice.id);
    toast.success(`Duplicate draft created: ${dup.number}`);
    navigate(`/${coSlug}/invoices/${dup.id}`);
  };

  const handleCreditNote = async () => {
    const cn = await api.createCreditNote(invoice.id);
    toast.success(`Credit Note created referencing ${invoice.number}`);
    navigate(`/${coSlug}/invoices/${cn.id}`);
  };

  const openSign = (a: 'approve' | 'reverse' | 'fix_this') => {
    setSignAction(a);
    setSignDialogOpen(true);
  };

  const handleSubmit = async () => {
    try {
      const res = await api.submitInvoice(invoice.id);
      setInvoice(res);
      toast.success('Submitted for approval');
    } catch (err: any) {
      toast.error(err.message || 'Could not submit invoice');
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard?.writeText(window.location.href).catch(() => undefined);
    toast.success('Link copied');
  };

  const pay = paymentStatus(invoice);
  const owed = invoices
    .filter((i) => i.contact_id === invoice.contact_id && i.status === 'posted')
    .reduce((sum, i) => sum + amountDue(i), 0);

  return (
    <div className="flex flex-col gap-6 pb-20">
      <PageHeader
        breadcrumb={[{ label: 'Invoices', to: `/${coSlug}/invoices` }, { label: invoice.number || 'Draft' }]}
        title={invoice.number || 'Draft invoice'}
        subtitle={contact ? `For ${contact.name}` : undefined}
        meta={<StatusPill status={pay} />}
        actions={
          <button type="button" onClick={() => window.print()} className={BTN_SECONDARY}>
            <Download className="size-4 text-text-muted" /> Download PDF
          </button>
        }
      />

      {invoice.status === 'reversed' && invoice.reversed_by_id && (
        <div className="px-4 py-3 bg-violet-soft border border-violet/30 rounded-lg text-[13px] flex items-center gap-2 text-violet font-medium">
          <RotateCcw className="size-4 shrink-0" />
          <span>
            This invoice was reversed.{' '}
            <button type="button" className="underline" onClick={() => navigate(`/${coSlug}/invoices/${invoice.reversed_by_id}`)}>
              View the reversal ({invoice.reversed_by_id})
            </button>
          </span>
        </div>
      )}

      {invoice.reversal_of_id && (
        <div className="px-4 py-3 bg-violet-soft border border-violet/30 rounded-lg text-[13px] flex items-center gap-2 text-violet font-medium">
          <Link2 className="size-4 shrink-0" />
          <span>
            This document cancels another invoice.{' '}
            <button type="button" className="underline" onClick={() => navigate(`/${coSlug}/invoices/${invoice.reversal_of_id}`)}>
              View the original ({invoice.reversal_of_id})
            </button>
          </span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <InvoicePaper invoice={invoice} contact={contact} company={currentCompany} />
        <InvoiceSidebar
          invoice={invoice}
          contact={contact}
          contactBalance={owed}
          payments={payments}
          journalLines={journalLines}
          coSlug={coSlug}
          canApprove={invoice.created_by !== currentUser.id && invoice.submitted_by !== currentUser.id}
          actions={{
            approve: handleApprove,
            submit: handleSubmit,
            recordPayment: () => navigate(`/${coSlug}/receipts/new?invoiceId=${invoice.id}`),
            sendReminder: () => setEmailMode('reminder'),
            print: () => window.print(),
            duplicate: handleDuplicate,
            creditNote: handleCreditNote,
            copyLink: handleCopyLink,
            email: () => setEmailMode('invoice'),
            attach: () => setIsAttachDialogOpen(true),
            refund: () => setIsRefundDialogOpen(true),
            fixThis: () => setIsFixThisDialogOpen(true),
            reverse: () => setIsReverseDialogOpen(true),
          }}
        />
      </div>

      {invoice.status === 'pending_approval' && (
        <ApprovalBar
          makerId={invoice.created_by}
          makerName={makerName}
          currentUserId={currentUser.id}
          submittedAt={invoice.created_at}
          amount={invoice.total}
          currency={invoice.currency}
          periodName={currentPeriod.name}
          documentNumber={invoice.number || 'Draft'}
          onApprove={handleApprove}
          onReturn={handleReturn}
        />
      )}

      <ReverseInvoiceDialog
        invoice={invoice}
        open={isReverseDialogOpen}
        onOpenChange={setIsReverseDialogOpen}
        reason={reverseReason}
        onReasonChange={setReverseReason}
        onAuthorize={() => {
          setIsReverseDialogOpen(false);
          openSign('reverse');
        }}
      />
      <FixInvoiceDialog
        invoice={invoice}
        open={isFixThisDialogOpen}
        onOpenChange={setIsFixThisDialogOpen}
        onAuthorize={() => {
          setIsFixThisDialogOpen(false);
          openSign('fix_this');
        }}
      />
      <EmailInvoiceDialog
        invoice={invoice}
        companyName={currentCompany.name}
        defaultTo={contact?.email}
        mode={emailMode ?? 'invoice'}
        open={emailMode !== null}
        onOpenChange={(o) => !o && setEmailMode(null)}
      />
      <AttachmentsDialog open={isAttachDialogOpen} onOpenChange={setIsAttachDialogOpen} />

      {/* 6-Digit PIN Signing Modal (Block D) */}
      <SignDialog
        isOpen={signDialogOpen}
        onClose={() => {
          setSignDialogOpen(false);
          setSignAction(null);
        }}
        onConfirm={handleConfirmSign}
        documentTitle={`Invoice for ${contact?.name || 'Customer'}`}
        documentNumber={invoice.number || 'Draft'}
        amount={invoice.total}
        currency={invoice.currency}
        periodName={currentPeriod.name}
        makerName={makerName}
        actionTitle={
          signAction === 'reverse'
            ? 'Authorize & Post Reversal'
            : signAction === 'fix_this'
            ? 'Authorize Fix (Reverse & Draft)'
            : 'Authorize & Post Invoice'
        }
        consequenceText={
          signAction === 'reverse'
            ? `Reversing will post offsetting entries (Dr Revenue ${formatMoney(invoice.subtotal, invoice.currency)}, Cr AR Control ${formatMoney(invoice.total, invoice.currency)}) and restore Trial Balance.`
            : signAction === 'fix_this'
            ? `Reversing original invoice and generating a new editable draft with identical lines.`
            : `Approving will assign sequence ${invoice.number || 'INV-2026-0043'}, post ${formatMoney(invoice.total, invoice.currency)} to AR Control, credit Revenue and VAT Output in Oct 2026.`
        }
      />

      <CustomerRefundDialog
        isOpen={isRefundDialogOpen}
        onClose={() => setIsRefundDialogOpen(false)}
        invoice={invoice}
      />
    </div>
  );
};

/** The demo keeps its store-backed screen; live mode reads the API (docs/15). */
export const InvoiceView: React.FC = selectByMode({ mock: MockInvoiceView, live: InvoiceViewLive });
