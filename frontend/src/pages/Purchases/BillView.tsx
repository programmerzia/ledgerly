import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerStore } from '@/mock/store';
import { Bill, Contact, Account } from '@/types';
import { PageHeader } from '@/components/domain/PageHeader';
import { BillPaper } from './bill-view/BillPaper';
import { BillSidebar } from './bill-view/BillSidebar';
import { BTN_SECONDARY } from '@/pages/Sales/invoice-view/shared';
import { paymentStatus, amountDue } from '@/lib/docStatus';
import { ApprovalBar } from '@/components/domain/ApprovalBar';
import { SignDialog } from '@/components/domain/SignDialog';
import { StatusPill } from '@/components/domain/StatusPill';
import { formatMoney, formatDate } from '@/lib/format';
import { SupplierPaymentDialog } from '@/components/domain/SupplierPaymentDialog';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  FileText,
  AlertCircle,
  RotateCcw,
  Wrench,
  Mail,
  Paperclip,
  Link2,
  ChevronDown,
  ChevronUp,
  Upload,
  Download,
} from 'lucide-react';


export const BillView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const { currentCompany, currentUser, currentPeriod, users, contacts, accounts, bills } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const billFromStore = bills.find((b) => b.id === id);
  const [bill, setBill] = useState<Bill | null>(billFromStore || null);
  const [loading, setLoading] = useState(!billFromStore);
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [signAction, setSignAction] = useState<'approve' | 'reverse' | 'fix_this' | null>(null);

  const [isReverseDialogOpen, setIsReverseDialogOpen] = useState(false);
  const [isFixThisDialogOpen, setIsFixThisDialogOpen] = useState(false);
  const [isEmailDialogOpen, setIsEmailDialogOpen] = useState(false);
  const [isAttachDialogOpen, setIsAttachDialogOpen] = useState(false);
  const [isPayDialogOpen, setIsPayDialogOpen] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const [showAccountingPreview, setShowAccountingPreview] = useState(false);
  const [reverseReason, setReverseReason] = useState('Supplier billing error & duplicate charge correction');
  const [emailTo, setEmailTo] = useState('finance@supplier.com');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [attachments, setAttachments] = useState<Array<{ name: string; size: string; date: string }>>([
    { name: 'Supplier_Tax_Invoice_Scanned.pdf', size: '210 KB', date: '2026-10-26' },
    { name: 'Goods_Received_Note_GRN.pdf', size: '185 KB', date: '2026-10-27' },
  ]);

  useEffect(() => {
    let active = true;
    async function fetchDoc() {
      if (!id) return;
      try {
        const found = bills.find((b) => b.id === id);
        if (active && found) setBill(found);
      } catch (err) {
        // fallback
      } finally {
        if (active) setLoading(false);
      }
    }
    fetchDoc();
    return () => {
      active = false;
    };
  }, [id, bills]);

  useEffect(() => {
    if (bill) {
      setEmailSubject(`Purchase Bill ${bill.number || bill.reference} - ${currentCompany.name}`);
      setEmailBody(
        `Dear Supplier,\n\nRegarding purchase bill ${bill.number || bill.reference} for ${formatMoney(
          bill.total,
          bill.currency
        )} due on ${formatDate(bill.due_date)}.\n\nThank you,\n${currentCompany.name}`
      );
    }
  }, [bill, currentCompany]);

  // Palette deep link: ?pay=1 opens the payment dialog once, only when the bill can be paid
  useEffect(() => {
    if (searchParams.get('pay') !== '1' || !bill) return;
    if (bill.status === 'posted' && amountDue(bill) > 0) setIsPayDialogOpen(true);
    else toast.info(bill.status !== 'posted' ? 'This bill is not in the books yet, so it cannot be paid.' : 'This bill has nothing left to pay.');
    const next = new URLSearchParams(searchParams);
    next.delete('pay');
    setSearchParams(next, { replace: true });
  }, [bill, searchParams, setSearchParams]);

  if (loading && !bill) {
    return (
      <div className="p-8 text-center text-xs text-text-muted flex items-center justify-center gap-2">
        <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
        <span>Loading purchase bill {id}...</span>
      </div>
    );
  }

  if (!bill) {
    return (
      <div className="p-12 text-center max-w-md mx-auto flex flex-col items-center gap-4">
        <AlertCircle className="w-10 h-10 text-danger" />
        <h2 className="text-base font-semibold text-text-primary">Bill not found</h2>
        <p className="text-xs text-text-muted">
          The requested document ID <span className="font-mono text-text-primary font-medium">{id}</span> does not exist or has been removed.
        </p>
        <button
          onClick={() => navigate(`/${coSlug}/bills`)}
          className="h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition"
        >
          Return to Purchase Bills
        </button>
      </div>
    );
  }

  const contact = contacts.find((c) => c.id === bill.contact_id);

  // Derived Journal Lines for Purchase Bill:
  // Dr Expense accounts for each line
  // Dr VAT Input (if tax)
  // Cr AP Control for net/total
  const derivedJournalLines = [
    ...bill.lines.map((l, idx) => {
      const acc = accounts.find((a) => a.id === l.account_id);
      return {
        id: `prev-exp-${idx}`,
        account_code: acc?.code || '6200',
        account_name: acc?.name || 'Operating Expenses',
        debit: l.line_total_fc,
        credit: 0,
        description: l.description,
      };
    }),
    ...(bill.tax_total > 0
      ? [
          {
            id: 'prev-tax',
            account_code: '1300',
            account_name: 'VAT Input (Recoverable)',
            debit: bill.tax_total,
            credit: 0,
            description: `VAT Input for ${bill.number || 'Bill'}`,
          },
        ]
      : []),
    {
      id: 'prev-ap',
      account_code: '2000',
      account_name: 'Accounts Payable (AP Control)',
      debit: 0,
      credit: bill.total,
      description: `Payable to ${contact?.name || 'Supplier'}`,
    },
  ];

  const { settlements, bills: allBills } = useLedgerStore.getState();
  const payments = (settlements || []).filter(
    (st) => st.kind === 'payment' && st.status !== 'void' && st.allocations.some((al) => al.invoice_id === bill.id)
  );
  const owed = allBills
    .filter((b) => b.contact_id === bill.contact_id && b.status === 'posted')
    .reduce((sum, b) => sum + amountDue(b), 0);

  const handleSubmit = async () => {
    try {
      const res = await api.submitBill(bill.id);
      setBill(res);
      toast.success('Submitted for approval');
    } catch (err: any) {
      toast.error(err.message || 'Could not submit bill');
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard?.writeText(window.location.href).catch(() => undefined);
    toast.success('Link copied');
  };

  const handleApprove = async () => {
    if (bill.created_by === currentUser.id || bill.submitted_by === currentUser.id) {
      toast.error('Segregation of Duties: Creator cannot approve their own bill. Switch persona to Fatima Hassan.');
      return;
    }
    setSignAction('approve');
    setSignDialogOpen(true);
  };

  const handleConfirmSign = async (pin: string) => {
    try {
      if (signAction === 'approve') {
        const res = await api.approveBill(bill.id, pin);
        setBill(res);
        toast.success(`Bill ${res.number} authorized and posted to AP Ledger`);
      } else if (signAction === 'reverse') {
        const res = await api.reverseBill(bill.id, reverseReason, pin);
        setBill(res.original);
        toast.success(`Bill reversed. Reversal document ${res.reversal.number} created and posted.`);
      } else if (signAction === 'fix_this') {
        await api.reverseBill(bill.id, 'Reversed via Fix This flow', pin);
        const dup = await api.duplicateBill(bill.id);
        toast.success('Original bill reversed. Now editing corrected draft copy.');
        navigate(`/${coSlug}/bills/${dup.id}`);
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
      const prevBill = { ...bill };
      const res = await api.returnBill(bill.id, comment);
      setBill(res);
      toast.info(`Bill returned to Maker for revisions: "${comment}"`, {
        duration: 10000,
        action: {
          label: 'Undo',
          onClick: () => {
            useLedgerStore.setState((s: any) => ({
              bills: s.bills.map((b: Bill) => (b.id === bill.id ? prevBill : b)),
            }));
            setBill(prevBill);
            toast.success('Return undone. Bill restored to pending approval.');
          },
        },
      });
    } catch (err: any) {
      toast.error(err.message || 'Return failed');
    }
  };

  const handleDuplicate = async () => {
    const dup = await api.duplicateBill(bill.id);
    toast.success(`Duplicate draft created: ${dup.number}`);
    navigate(`/${coSlug}/bills/${dup.id}`);
  };

  const handleDebitNote = async () => {
    const dn = await api.createDebitNote(bill.id);
    toast.success(`Debit Note created referencing ${bill.number}`);
    navigate(`/${coSlug}/bills/${dn.id}`);
  };

  const handleSendEmail = () => {
    setIsEmailDialogOpen(false);
    toast.success(`Bill ${bill.number || bill.reference} remittance details sent to ${emailTo}.`);
  };

  const handleUploadAttachment = () => {
    const mockFile = {
      name: `Supplier_Receipt_${Date.now().toString().slice(-4)}.pdf`,
      size: '175 KB',
      date: new Date().toISOString().split('T')[0],
    };
    setAttachments((prev) => [mockFile, ...prev]);
    toast.success(`Attached ${mockFile.name} to bill.`);
  };

  return (
    <div className="flex flex-col gap-6 pb-20">
      <PageHeader
        breadcrumb={[{ label: 'Bills', to: `/${coSlug}/bills` }, { label: bill.number || bill.reference || 'Draft' }]}
        title={bill.number || bill.reference || 'Draft bill'}
        subtitle={contact ? `From ${contact.name}` : undefined}
        meta={<StatusPill status={paymentStatus(bill)} />}
        actions={
          <button type="button" onClick={() => window.print()} className={BTN_SECONDARY}>
            <Download className="size-4 text-text-muted" /> Download PDF
          </button>
        }
      />

      {bill.status === 'reversed' && bill.reversed_by_id && (
        <div className="px-4 py-3 bg-violet-soft border border-violet/30 rounded-lg text-[13px] flex items-center gap-2 text-violet font-medium">
          <RotateCcw className="size-4 shrink-0" />
          <span>
            This bill was reversed.{' '}
            <button type="button" className="underline" onClick={() => navigate(`/${coSlug}/bills/${bill.reversed_by_id}`)}>
              View the reversal ({bill.reversed_by_id})
            </button>
          </span>
        </div>
      )}

      {bill.reversal_of_id && (
        <div className="px-4 py-3 bg-violet-soft border border-violet/30 rounded-lg text-[13px] flex items-center gap-2 text-violet font-medium">
          <Link2 className="size-4 shrink-0" />
          <span>
            This document cancels another bill.{' '}
            <button type="button" className="underline" onClick={() => navigate(`/${coSlug}/bills/${bill.reversal_of_id}`)}>
              View the original ({bill.reversal_of_id})
            </button>
          </span>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px] items-start">
        <BillPaper bill={bill} contact={contact} company={currentCompany} />
        <BillSidebar
          bill={bill}
          contact={contact}
          supplierBalance={owed}
          payments={payments}
          journalLines={derivedJournalLines}
          coSlug={coSlug}
          actions={{
            approve: handleApprove,
            submit: handleSubmit,
            pay: () => setIsPayDialogOpen(true),
            batch: () => navigate(`/${coSlug}/payment-run`),
            print: () => window.print(),
            duplicate: handleDuplicate,
            debitNote: handleDebitNote,
            copyLink: handleCopyLink,
            email: () => setIsEmailDialogOpen(true),
            attach: () => setIsAttachDialogOpen(true),
            fixThis: () => setIsFixThisDialogOpen(true),
            reverse: () => setIsReverseDialogOpen(true),
          }}
        />
      </div>

      {/* Sticky Bottom Approval Bar for Pending Bills */}
      {bill.status === 'pending_approval' && (
        <ApprovalBar
          makerId={bill.created_by}
          makerName={users.find((u) => u.id === bill.created_by)?.name ?? 'the maker'}
          currentUserId={currentUser.id}
          submittedAt={bill.created_at}
          amount={bill.total}
          currency={bill.currency}
          periodName={currentPeriod.name}
          documentNumber={bill.number || bill.reference}
          onApprove={handleApprove}
          onReturn={handleReturn}
        />
      )}

      {/* Reverse Modal Dialog */}
      <Dialog open={isReverseDialogOpen} onOpenChange={setIsReverseDialogOpen}>
        <DialogContent className="max-w-lg bg-surface border border-border p-6 shadow-xl rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-danger" />
              Reverse posted bill ({bill.number || bill.reference})
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4 text-xs text-text-secondary mt-2">
            <div className="p-3 bg-danger-soft border border-danger/30 rounded-md text-danger">
              <p className="font-semibold">This cannot be undone</p>
              <p className="mt-1 text-[11px]">
                Reversing this bill creates a mirror reversal document and posts offsetting entries directly to the General Ledger. The original bill remains immutable in the audit trail.
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-text-primary mb-1">
                Reason for Reversal <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                className="w-full h-8 px-2.5 rounded-sm border border-border bg-surface text-xs text-text-primary focus:border-accent outline-hidden"
                placeholder="State why this bill is being reversed..."
              />
            </div>

            <div className="border border-border rounded-md overflow-hidden">
              <button
                type="button"
                onClick={() => setShowAccountingPreview(!showAccountingPreview)}
                className="w-full flex items-center justify-between p-2.5 bg-surface-neutral text-xs font-semibold text-text-primary hover:bg-surface-neutral/80"
              >
                <span>Consequence & Accounting Entries Preview</span>
                {showAccountingPreview ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
              {showAccountingPreview && (
                <div className="p-3 bg-surface text-[11px] font-mono border-t border-border flex flex-col gap-1.5">
                  <div className="flex justify-between text-text-muted">
                    <span>Dr 2000 AP Control:</span>
                    <span className="text-text-primary">{formatMoney(bill.total, bill.currency)}</span>
                  </div>
                  <div className="flex justify-between text-text-muted border-t border-border/50 pt-1">
                    <span>Cr Operating Expenses:</span>
                    <span className="text-text-primary">{formatMoney(bill.subtotal, bill.currency)}</span>
                  </div>
                  {bill.tax_total > 0 && (
                    <div className="flex justify-between text-text-muted">
                      <span>Cr 1300 VAT Input:</span>
                      <span className="text-text-primary">{formatMoney(bill.tax_total, bill.currency)}</span>
                    </div>
                  )}
                  <p className="text-[10px] text-text-muted italic mt-1 font-sans">
                    Restores Trial Balance and supplier balance to prior state.
                  </p>
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsReverseDialogOpen(false)}
              className="h-8 px-3 rounded-sm border border-border bg-surface text-text-primary text-xs hover:bg-surface-neutral cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!reverseReason.trim()}
              onClick={() => {
                setIsReverseDialogOpen(false);
                setSignAction('reverse');
                setSignDialogOpen(true);
              }}
              className="h-8 px-3 rounded-sm bg-danger hover:bg-danger/90 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
            >
              Authorize Reversal with PIN
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Fix This Modal Dialog */}
      <Dialog open={isFixThisDialogOpen} onOpenChange={setIsFixThisDialogOpen}>
        <DialogContent className="max-w-md bg-surface border border-border p-6 shadow-xl rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary flex items-center gap-2">
              <Wrench className="w-5 h-5 text-accent" />
              Fix posted bill ({bill.number || bill.reference})
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-xs text-text-secondary mt-2">
            <p>
              "Fix this" automates the accounting correction standard:
            </p>
            <ol className="list-decimal pl-5 flex flex-col gap-1 text-[11px] text-text-primary">
              <li>Reverses this posted bill and mirror offsets its ledger entries.</li>
              <li>Generates a new editable Draft copy with the same line items and supplier.</li>
              <li>Takes you directly to the new draft editor so you can make corrections and resubmit.</li>
            </ol>
            <p className="text-[11px] text-text-muted">
              Requires PIN authorization to execute the ledger reversal.
            </p>
          </div>
          <DialogFooter className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsFixThisDialogOpen(false)}
              className="h-8 px-3 rounded-sm border border-border bg-surface text-text-primary text-xs hover:bg-surface-neutral cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => {
                setIsFixThisDialogOpen(false);
                setSignAction('fix_this');
                setSignDialogOpen(true);
              }}
              className="h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium cursor-pointer"
            >
              Authorize Fix & Create Draft
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Email Bill Modal Dialog */}
      <Dialog open={isEmailDialogOpen} onOpenChange={setIsEmailDialogOpen}>
        <DialogContent className="max-w-md bg-surface border border-border p-6 shadow-xl rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary flex items-center gap-2">
              <Mail className="w-5 h-5 text-accent" />
              Email remittance advice ({bill.number || bill.reference})
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-xs text-text-secondary mt-2">
            <div>
              <label className="block text-[11px] font-semibold text-text-muted mb-1">Recipient email</label>
              <input
                type="email"
                value={emailTo}
                onChange={(e) => setEmailTo(e.target.value)}
                className="w-full h-8 px-2.5 rounded-sm border border-border bg-surface text-xs text-text-primary focus:border-accent outline-hidden"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-text-muted mb-1">Subject</label>
              <input
                type="text"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                className="w-full h-8 px-2.5 rounded-sm border border-border bg-surface text-xs text-text-primary focus:border-accent outline-hidden"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-text-muted mb-1">Message</label>
              <textarea
                rows={4}
                value={emailBody}
                onChange={(e) => setEmailBody(e.target.value)}
                className="w-full p-2.5 rounded-sm border border-border bg-surface text-xs text-text-primary focus:border-accent outline-hidden font-sans"
              />
            </div>
            <div className="flex items-center gap-2 p-2 bg-surface-neutral rounded border border-border text-[11px]">
              <Paperclip className="w-4 h-4 text-text-muted" />
              <span className="font-mono text-text-primary font-medium">{bill.number || 'BILL'}.pdf</span>
              <span className="text-text-muted text-[10px]">(System generated PDF · 134 KB)</span>
            </div>
          </div>
          <DialogFooter className="mt-4 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsEmailDialogOpen(false)}
              className="h-8 px-3 rounded-sm border border-border bg-surface text-text-primary text-xs hover:bg-surface-neutral cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSendEmail}
              className="h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium cursor-pointer"
            >
              Send remittance email
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Attachments Modal Dialog */}
      <Dialog open={isAttachDialogOpen} onOpenChange={setIsAttachDialogOpen}>
        <DialogContent className="max-w-md bg-surface border border-border p-6 shadow-xl rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary flex items-center gap-2">
              <Paperclip className="w-5 h-5 text-accent" />
              Bill attachments ({attachments.length})
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-xs mt-2">
            <div className="flex justify-between items-center pb-2 border-b border-border">
              <span className="text-text-muted text-[11px]">Attached files linked to this purchase bill</span>
              <button
                type="button"
                onClick={handleUploadAttachment}
                className="flex items-center gap-1.5 h-7 px-2 bg-surface-neutral hover:bg-surface-neutral/80 text-text-primary rounded text-[11px] font-semibold border border-border cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5 text-accent" />
                <span>Upload file</span>
              </button>
            </div>
            <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
              {attachments.map((file, i) => (
                <div key={i} className="flex items-center justify-between p-2.5 rounded border border-border bg-surface hover:bg-surface-neutral/40 text-xs">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-accent shrink-0" />
                    <div>
                      <div className="font-medium text-text-primary">{file.name}</div>
                      <div className="text-[10px] text-text-muted">{file.size} · Uploaded {file.date}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => toast.info(`Viewing ${file.name}`)}
                    className="text-accent text-[11px] font-semibold hover:underline cursor-pointer"
                  >
                    View
                  </button>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="mt-4">
            <button
              type="button"
              onClick={() => setIsAttachDialogOpen(false)}
              className="h-8 px-3 rounded-sm border border-border bg-surface text-text-primary text-xs hover:bg-surface-neutral cursor-pointer"
            >
              Close
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 6-Digit PIN Signing Modal */}
      <SignDialog
        isOpen={signDialogOpen}
        onClose={() => {
          setSignDialogOpen(false);
          setSignAction(null);
        }}
        onConfirm={handleConfirmSign}
        documentTitle={`Purchase Bill: ${contact?.name || 'Supplier'}`}
        documentNumber={bill.number || bill.reference}
        amount={bill.total}
        currency={bill.currency}
        periodName={currentPeriod.name}
        makerName={users.find((u) => u.id === bill.created_by)?.name ?? 'the maker'}
        actionTitle={
          signAction === 'reverse'
            ? 'Authorize & Post Bill Reversal'
            : signAction === 'fix_this'
            ? 'Authorize Fix (Reverse & Draft)'
            : 'Authorize & Post Bill'
        }
        consequenceText={
          signAction === 'reverse'
            ? `Reversing will post offsetting entries (Dr AP Control ${formatMoney(bill.total, bill.currency)}, Cr Expenses ${formatMoney(bill.subtotal, bill.currency)}) and restore Trial Balance.`
            : signAction === 'fix_this'
            ? `Reversing original bill and generating a new editable draft with identical lines.`
            : `Approving assigns the next bill number, credits ${formatMoney(bill.total, bill.currency)} to accounts payable and posts the expense lines in ${currentPeriod.name}.`
        }
      />

      {/* Single Supplier Payment Modal */}
      {bill && (
        <SupplierPaymentDialog
          isOpen={isPayDialogOpen}
          onClose={() => setIsPayDialogOpen(false)}
          bill={bill}
        />
      )}
    </div>
  );
};
