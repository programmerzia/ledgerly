import { BUSINESS_TODAY } from '@/lib/docStatus';
import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ChevronDown, ChevronUp, FileText, Mail, Paperclip, RotateCcw, Upload, Wrench } from 'lucide-react';
import type { Invoice } from '@/types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { formatMoney, formatDate } from '@/lib/format';

const GHOST_BTN = 'h-8 px-3 rounded-lg border border-border bg-surface text-text-primary text-xs hover:bg-surface-neutral cursor-pointer';
const FIELD = 'w-full h-8 px-2.5 rounded-lg border border-border bg-surface text-xs text-text-primary focus:border-accent outline-hidden';
const CONTENT = 'bg-surface border border-border p-6 shadow-xl rounded-lg';

/* ---------------------------- Reverse ---------------------------- */
interface ReverseProps {
  invoice: Invoice;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  reason: string;
  onReasonChange: (v: string) => void;
  onAuthorize: () => void;
}

export const ReverseInvoiceDialog: React.FC<ReverseProps> = ({ invoice, open, onOpenChange, reason, onReasonChange, onAuthorize }) => {
  const [showPreview, setShowPreview] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-w-lg ${CONTENT}`}>
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-text-primary flex items-center gap-2">
            <RotateCcw className="w-5 h-5 text-danger" />
            Reverse invoice {invoice.number}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4 text-xs text-text-secondary mt-2">
          <div className="p-3 bg-danger-soft border border-danger/30 rounded-lg text-danger">
            <p className="font-semibold">This can't be undone</p>
            <p className="mt-1 text-[11px]">
              Reversing creates a mirror document that cancels this invoice in the books. The original stays on record.
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-text-primary mb-1">
              Reason <span className="text-danger">*</span>
            </label>
            <input
              type="text"
              value={reason}
              onChange={(e) => onReasonChange(e.target.value)}
              className={FIELD}
              placeholder="Why is this invoice being reversed?"
            />
          </div>
          <div className="border border-border rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setShowPreview(!showPreview)}
              className="w-full flex items-center justify-between p-2.5 bg-surface-neutral text-xs font-semibold text-text-primary hover:bg-surface-neutral/80"
            >
              <span>What changes in the books</span>
              {showPreview ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
            {showPreview && (
              <div className="p-3 bg-surface text-[11px] border-t border-border flex flex-col gap-1.5 tabular-nums">
                <div className="flex justify-between text-text-muted">
                  <span>Dr 4000 Sales revenue</span>
                  <span className="text-text-primary">{formatMoney(invoice.subtotal, invoice.currency)}</span>
                </div>
                {invoice.tax_total > 0 && (
                  <div className="flex justify-between text-text-muted">
                    <span>Dr 2100 VAT output</span>
                    <span className="text-text-primary">{formatMoney(invoice.tax_total, invoice.currency)}</span>
                  </div>
                )}
                <div className="flex justify-between text-text-muted border-t border-border/50 pt-1">
                  <span>Cr 1200 Accounts receivable</span>
                  <span className="text-text-primary">{formatMoney(invoice.total, invoice.currency)}</span>
                </div>
                <p className="text-[10px] text-text-muted italic mt-1">The customer's balance returns to what it was before this invoice.</p>
              </div>
            )}
          </div>
        </div>
        <DialogFooter className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className={GHOST_BTN}>
            Cancel
          </button>
          <button
            type="button"
            disabled={!reason.trim()}
            onClick={onAuthorize}
            className="h-8 px-3 rounded-lg bg-danger hover:bg-danger/90 text-white text-xs font-semibold disabled:opacity-50 cursor-pointer"
          >
            Authorize reversal with PIN
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ---------------------------- Fix this ---------------------------- */
interface FixProps {
  invoice: Invoice;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onAuthorize: () => void;
}

export const FixInvoiceDialog: React.FC<FixProps> = ({ invoice, open, onOpenChange, onAuthorize }) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className={`max-w-md ${CONTENT}`}>
      <DialogHeader>
        <DialogTitle className="text-base font-semibold text-text-primary flex items-center gap-2">
          <Wrench className="w-5 h-5 text-accent" />
          Fix invoice {invoice.number}
        </DialogTitle>
      </DialogHeader>
      <div className="flex flex-col gap-3 text-xs text-text-secondary mt-2">
        <p>"Fix this" corrects a posted invoice in three steps:</p>
        <ol className="list-decimal pl-5 flex flex-col gap-1 text-[11px] text-text-primary">
          <li>Reverses this invoice and offsets its entries in the books.</li>
          <li>Creates a new editable draft with the same lines and customer.</li>
          <li>Opens the draft so you can correct it and resubmit.</li>
        </ol>
        <p className="text-[11px] text-text-muted">Your PIN is needed to authorize the reversal.</p>
      </div>
      <DialogFooter className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={() => onOpenChange(false)} className={GHOST_BTN}>
          Cancel
        </button>
        <button
          type="button"
          onClick={onAuthorize}
          className="h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium cursor-pointer"
        >
          Authorize fix and create draft
        </button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

/* ---------------------------- Email ---------------------------- */
interface EmailProps {
  invoice: Invoice;
  companyName: string;
  defaultTo?: string;
  mode: 'invoice' | 'reminder';
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export const EmailInvoiceDialog: React.FC<EmailProps> = ({ invoice, companyName, defaultTo, mode, open, onOpenChange }) => {
  const [to, setTo] = useState(defaultTo ?? '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');

  useEffect(() => {
    if (!open) return;
    setTo(defaultTo ?? '');
    const total = formatMoney(invoice.total, invoice.currency);
    if (mode === 'reminder') {
      setSubject(`Reminder: invoice ${invoice.number} is overdue`);
      setBody(
        `Hello,\n\nA friendly reminder that invoice ${invoice.number} for ${total} was due on ${formatDate(invoice.due_date)}. Please arrange payment at your earliest convenience.\n\nThank you,\n${companyName}`
      );
    } else {
      setSubject(`Invoice ${invoice.number} from ${companyName}`);
      setBody(
        `Hello,\n\nPlease find attached invoice ${invoice.number} for ${total}, due on ${formatDate(invoice.due_date)}.\n\nThank you,\n${companyName}`
      );
    }
  }, [open, mode, invoice, companyName, defaultTo]);

  const send = () => {
    onOpenChange(false);
    toast.success(mode === 'reminder' ? `Reminder sent to ${to}` : `Invoice ${invoice.number} sent to ${to} with PDF attached.`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-w-md ${CONTENT}`}>
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-text-primary flex items-center gap-2">
            <Mail className="w-5 h-5 text-accent" />
            {mode === 'reminder' ? 'Send payment reminder' : `Email invoice ${invoice.number}`}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-xs text-text-secondary mt-2">
          <div>
            <label className="block text-[11px] font-semibold text-text-muted mb-1">To</label>
            <input type="email" value={to} onChange={(e) => setTo(e.target.value)} className={FIELD} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-text-muted mb-1">Subject</label>
            <input type="text" value={subject} onChange={(e) => setSubject(e.target.value)} className={FIELD} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-text-muted mb-1">Message</label>
            <textarea
              rows={5}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="w-full p-2.5 rounded-lg border border-border bg-surface text-xs text-text-primary focus:border-accent outline-hidden font-sans"
            />
          </div>
          <div className="flex items-center gap-2 p-2 bg-surface-neutral rounded-lg border border-border text-[11px]">
            <Paperclip className="w-4 h-4 text-text-muted" />
            <span className="text-text-primary font-medium">{invoice.number}.pdf</span>
            <span className="text-text-muted text-[10px]">PDF · 128 KB</span>
          </div>
        </div>
        <DialogFooter className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => onOpenChange(false)} className={GHOST_BTN}>
            Cancel
          </button>
          <button
            type="button"
            onClick={send}
            className="h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium cursor-pointer"
          >
            {mode === 'reminder' ? 'Send reminder' : 'Send invoice'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/* ---------------------------- Attachments ---------------------------- */
interface AttachProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

export const AttachmentsDialog: React.FC<AttachProps> = ({ open, onOpenChange }) => {
  const [attachments, setAttachments] = useState<Array<{ name: string; size: string; date: string }>>([
    { name: 'PO_Reference_PO-88192.pdf', size: '145 KB', date: '2026-10-25' },
    { name: 'Signed_Delivery_Proof.pdf', size: '280 KB', date: '2026-10-26' },
  ]);

  const upload = () => {
    const f = {
      name: `Contract_Annex_${Date.now().toString().slice(-4)}.pdf`,
      size: '190 KB',
      date: BUSINESS_TODAY,
    };
    setAttachments((prev) => [f, ...prev]);
    toast.success(`Attached ${f.name} to invoice.`);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`max-w-md ${CONTENT}`}>
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-text-primary flex items-center gap-2">
            <Paperclip className="w-5 h-5 text-accent" />
            Attachments ({attachments.length})
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-xs mt-2">
          <div className="flex justify-between items-center pb-2 border-b border-border">
            <span className="text-text-muted text-[11px]">Files linked to this invoice</span>
            <button
              type="button"
              onClick={upload}
              className="flex items-center gap-1.5 h-7 px-2 bg-surface-neutral hover:bg-surface-neutral/80 text-text-primary rounded-lg text-[11px] font-semibold border border-border cursor-pointer"
            >
              <Upload className="w-3.5 h-3.5 text-accent" />
              <span>Upload file</span>
            </button>
          </div>
          <div className="flex flex-col gap-2 max-h-60 overflow-y-auto">
            {attachments.map((file, i) => (
              <div key={i} className="flex items-center justify-between p-2.5 rounded-lg border border-border bg-surface hover:bg-surface-neutral/40 text-xs">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-accent shrink-0" />
                  <div>
                    <div className="font-medium text-text-primary">{file.name}</div>
                    <div className="text-[10px] text-text-muted">
                      {file.size} · Uploaded {file.date}
                    </div>
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
          <button type="button" onClick={() => onOpenChange(false)} className={GHOST_BTN}>
            Close
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
