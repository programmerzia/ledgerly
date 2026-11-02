import { selectByMode } from '@/data/select';
import { InvoiceFormLive } from './live/InvoiceFormLive';
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerStore } from '@/mock/store';
import { LineGrid, GridLineItem } from '@/components/domain/LineGrid';
import { FieldHelp } from '@/components/domain/FieldHelp';
import { ConsequenceDialog, ConsequenceAccountingLine } from '@/components/domain/ConsequenceDialog';
import { formatMoney } from '@/lib/format';
import { paymentStatus, amountDue } from '@/lib/docStatus';
import { ContactPicker } from '@/components/domain/ContactPicker';
import { Kbd } from '@/components/ui/kbd';
import { ArrowLeft, Save, Send, AlertTriangle, ShieldCheck, History } from 'lucide-react';

import { toast } from 'sonner';

const MockInvoiceForm: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentCompany, contacts, accounts, dimensions, taxCodes, invoices, items } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [contactId, setContactId] = useState('cnt-1'); // Hormuud Telecom
  const [issueDate, setIssueDate] = useState('2026-10-28');
  const [dueDate, setDueDate] = useState('2026-11-27');
  const [reference, setReference] = useState('PO-HT-2026-X1');
  const [memo, setMemo] = useState('Telecom tower equipment and maintenance spares');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConsequence, setShowConsequence] = useState(false);

  // Autosave simulation state
  const [dueDateEdited, setDueDateEdited] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // 2 sample lines matching Demo Script Step 2 ($500 + $500 = $1,000 subtotal, VAT 5% = $50, Total = $1,050)
  const [lines, setLines] = useState<GridLineItem[]>([
    {
      id: 'ln-1',
      line_no: 1,
      account_id: 'acc-4000', // Sales Revenue
      description: 'Microwave transmission transceiver modules',
      quantity: 1,
      unit_price_fc: 50000, // $500.00
      tax_code_id: 'tax-vat5',
      line_total_fc: 50000,
      tax_amount_fc: 2500, // $25.00
      dimensions: {}, // Initially empty to trigger required validation in Step 2!
    },
    {
      id: 'ln-2',
      line_no: 2,
      account_id: 'acc-4000', // Sales Revenue
      description: 'High-gain dish antenna mounting hardware',
      quantity: 1,
      unit_price_fc: 50000, // $500.00
      tax_code_id: 'tax-vat5',
      line_total_fc: 50000,
      tax_amount_fc: 2500, // $25.00
      dimensions: {}, // Initially empty to trigger required validation in Step 2!
    },
  ]);

  const subtotal = lines.reduce((s, l) => s + (l.line_total_fc || 0), 0);
  const taxTotal = lines.reduce((s, l) => s + (l.tax_amount_fc || 0), 0);
  const total = subtotal + taxTotal;

  const selectedContact = contacts.find((c) => c.id === contactId);

  // Due date follows issue date + customer terms until the user edits it manually
  useEffect(() => {
    if (dueDateEdited || !selectedContact) return;
    const d = new Date(`${issueDate}T00:00:00Z`);
    if (isNaN(d.getTime())) return;
    d.setUTCDate(d.getUTCDate() + selectedContact.payment_terms_days);
    setDueDate(d.toISOString().slice(0, 10));
  }, [issueDate, selectedContact, dueDateEdited]);

  const lineDefaults = useMemo(
    () => ({
      account_id: selectedContact?.default_account_id,
      tax_code_id: selectedContact?.default_tax_code_id,
      branch: selectedContact?.default_branch,
    }),
    [selectedContact]
  );

  const handleCustomerChange = (id: string, contact: { default_account_id?: string; default_tax_code_id?: string; default_branch?: string }) => {
    setContactId(id);
    // Defaults only pre-fill lines that are still empty
    setLines((prev) =>
      prev.map((l) =>
        !l.description && !l.unit_price_fc && !l.item_id
          ? {
              ...l,
              account_id: contact.default_account_id || l.account_id,
              tax_code_id: contact.default_tax_code_id || l.tax_code_id,
              dimensions: contact.default_branch
                ? { ...l.dimensions, branch: l.dimensions?.branch || contact.default_branch }
                : l.dimensions,
            }
          : l
      )
    );
  };

  // Palette deep link: ?contact=<id> preselects that customer as if picked by hand
  const contactParam = searchParams.get('contact');
  useEffect(() => {
    if (!contactParam) return;
    const c = contacts.find((x) => x.id === contactParam && (x.kind === 'customer' || x.kind === 'both'));
    if (c) handleCustomerChange(c.id, c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contactParam]);

  const balances = useMemo(() => {
    const out: Record<string, number> = {};
    for (const inv of invoices) {
      if (inv.kind !== 'sales_invoice') continue;
      const st = paymentStatus(inv);
      if (st === 'awaiting_payment' || st === 'partially_paid' || st === 'overdue') {
        out[inv.contact_id] = (out[inv.contact_id] || 0) + amountDue(inv);
      }
    }
    return out;
  }, [invoices]);

  const lastInvoice = useMemo(
    () =>
      invoices
        .filter((i) => i.contact_id === contactId && i.kind === 'sales_invoice' && i.lines.length > 0)
        .sort((a, b) => b.issue_date.localeCompare(a.issue_date))[0],
    [invoices, contactId]
  );

  const copyLastInvoice = () => {
    if (!lastInvoice) return;
    const before = { lines, memo, reference };
    const stamp = Date.now();
    setLines(
      lastInvoice.lines.map((l, i) => ({
        id: `ln-${stamp}-${i + 1}`,
        line_no: i + 1,
        account_id: l.account_id,
        description: l.description,
        quantity: l.quantity,
        unit_price_fc: l.unit_price_fc,
        tax_code_id: l.tax_code_id,
        line_total_fc: l.line_total_fc,
        tax_amount_fc: l.tax_amount_fc,
        dimensions: { ...l.dimensions },
      }))
    );
    setMemo(lastInvoice.memo || '');
    setReference(lastInvoice.reference || '');
    setErrorMessage('');
    toast.success(`Copied lines from ${lastInvoice.number ?? 'the last invoice'}`, {
      action: {
        label: 'Undo',
        onClick: () => {
          setLines(before.lines);
          setMemo(before.memo);
          setReference(before.reference);
        },
      },
    });
  };

  const customerSummary = useMemo(() => {
    let outstanding = 0;
    let overdue = 0;
    for (const inv of invoices) {
      if (inv.contact_id !== contactId) continue;
      const st = paymentStatus(inv);
      if (st === 'awaiting_payment' || st === 'partially_paid' || st === 'overdue') {
        outstanding += amountDue(inv);
        if (st === 'overdue') overdue += amountDue(inv);
      }
    }
    return { outstanding, overdue };
  }, [invoices, contactId]);

  // Validation function enforcing controls
  const validateForm = (): boolean => {
    setErrorMessage('');
    setSubmitAttempted(true);
    // Check required Branch dimension on all lines
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].dimensions?.branch) {
        setErrorMessage(
          'Please choose a branch on every line before submitting.'
        );
        // Mark line errors
        const updated = lines.map((l, idx) =>
          idx === i ? { ...l, errors: { branch: 'Branch required' } } : l
        );
        setLines(updated);
        return false;
      }
    }
    return true;
  };

  const accountingPreviewLines: ConsequenceAccountingLine[] = [
    {
      accountCode: '1200',
      accountName: 'Accounts Receivable',
      debit: total,
      credit: 0,
    },
    {
      accountCode: '4000',
      accountName: 'Sales Revenue',
      debit: 0,
      credit: subtotal,
    },
    {
      accountCode: '2110',
      accountName: 'VAT Output',
      debit: 0,
      credit: taxTotal,
    },
  ];

  const handleOpenSubmitConsequence = () => {
    const isValid = validateForm();
    if (!isValid) return;
    setShowConsequence(true);
  };

  const handleSaveDraft = async () => {
    setSubmitAttempted(true);
    try {
      setIsSubmitting(true);
      const invoice = await api.createInvoice({
        kind: 'sales_invoice',
        contact_id: contactId,
        issue_date: issueDate,
        due_date: dueDate,
        reference,
        memo,
        currency: 'USD',
        fx_rate: 1.0,
        status: 'draft',
        lines: lines.map((l) => ({
          id: l.id,
          line_no: l.line_no,
          account_id: l.account_id,
          description: l.description,
          quantity: l.quantity || 1,
          unit_price_fc: l.unit_price_fc || 0,
          discount_pct: 0,
          tax_code_id: l.tax_code_id,
          line_total_fc: l.line_total_fc || 0,
          tax_amount_fc: l.tax_amount_fc || 0,
          dimensions: l.dimensions,
        })),
        subtotal_fc: subtotal,
        tax_total_fc: taxTotal,
        total_fc: total,
        subtotal,
        tax_total: taxTotal,
        total,
      });

      toast.success('Draft invoice saved', {
        action: {
          label: 'Undo',
          onClick: () => toast.info('Draft action restored'),
        },
      });
      navigate(`/${coSlug}/invoices/${invoice.id}`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create invoice');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmSubmit = async () => {
    try {
      setIsSubmitting(true);
      setShowConsequence(false);
      const invoice = await api.createInvoice({
        kind: 'sales_invoice',
        contact_id: contactId,
        issue_date: issueDate,
        due_date: dueDate,
        reference,
        memo,
        currency: 'USD',
        fx_rate: 1.0,
        status: 'pending_approval',
        lines: lines.map((l) => ({
          id: l.id,
          line_no: l.line_no,
          account_id: l.account_id,
          description: l.description,
          quantity: l.quantity || 1,
          unit_price_fc: l.unit_price_fc || 0,
          discount_pct: 0,
          tax_code_id: l.tax_code_id,
          line_total_fc: l.line_total_fc || 0,
          tax_amount_fc: l.tax_amount_fc || 0,
          dimensions: l.dimensions,
        })),
        subtotal_fc: subtotal,
        tax_total_fc: taxTotal,
        total_fc: total,
        subtotal,
        tax_total: taxTotal,
        total,
      });

      toast.success('Invoice submitted for approval');
      navigate(`/${coSlug}/invoices/${invoice.id}`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create invoice');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Keyboard shortcuts: Ctrl/Cmd+Enter submits, Ctrl/Cmd+S saves a draft
  const shortcutRef = useRef({ submit: handleOpenSubmitConsequence, save: handleSaveDraft, busy: false });
  shortcutRef.current = {
    submit: handleOpenSubmitConsequence,
    save: handleSaveDraft,
    busy: isSubmitting || showConsequence,
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || shortcutRef.current.busy) return;
      if ((e.target as HTMLElement | null)?.closest?.('[role="dialog"]')) return;
      if (e.key === 'Enter') {
        e.preventDefault();
        shortcutRef.current.submit();
      } else if (e.key.toLowerCase() === 's') {
        e.preventDefault();
        void shortcutRef.current.save();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex flex-col gap-5">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(`/${coSlug}/invoices`)}
            className="p-1.5 rounded-sm border border-border hover:bg-surface-neutral text-text-secondary hover:text-text-primary transition shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-semibold text-text-primary">New invoice</h1>
            <div className="flex items-center gap-2 text-xs text-text-muted mt-0.5">
              <span>Draft</span>
              <span>·</span>
              <span>Saved just now</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isSubmitting}
            className="flex items-center gap-1.5 h-8 px-3 rounded-sm border border-border hover:border-border-strong bg-surface text-text-secondary hover:text-text-primary text-xs font-medium transition"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save draft</span>
            <Kbd className="hidden sm:inline-flex">⌘S</Kbd>
          </button>

          <button
            type="button"
            onClick={handleOpenSubmitConsequence}
            disabled={isSubmitting}
            className="flex items-center gap-1.5 h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded-md text-[13px] font-medium transition"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Submit for approval</span>
            <Kbd className="hidden sm:inline-flex bg-white/20 border-white/30 text-white">⌘↵</Kbd>
          </button>
        </div>
      </div>

      {/* Inline Validation Error Banner */}
      {errorMessage && (
        <div className="p-3 bg-danger-soft/20 text-danger border border-danger/30 rounded-md text-xs font-medium flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 text-danger" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              // Quick helper for demo: fill Branch Mogadishu on all lines
              const filled = lines.map((l) => ({
                ...l,
                dimensions: { ...l.dimensions, branch: 'MG' },
                errors: undefined,
              }));
              setLines(filled);
              setErrorMessage('');
            }}
            className="text-[11px] underline font-semibold text-danger hover:opacity-80 ml-4"
          >
            Set all to Mogadishu
          </button>
        </div>
      )}

      {/* Header Fields: Customer, Dates, Reference */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-5 bg-surface border border-border rounded-md">
        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-xs font-medium text-text-secondary flex items-center">
            Customer <span className="text-text-muted ml-0.5">*</span>
            <FieldHelp
              help="Registered client entity to bill. Determines default currency, AR control account and payment terms."
              example="CUST-001 Hormuud Telecom"
            />
          </label>
          <ContactPicker
            kind="customer"
            value={contactId}
            onChange={handleCustomerChange}
            balances={balances}
          />
          {lastInvoice && (
            <button
              type="button"
              onClick={copyLastInvoice}
              className="self-start inline-flex items-center gap-1 text-[11px] font-medium text-accent hover:underline"
            >
              <History className="w-3 h-3" />
              Copy last invoice ({lastInvoice.number ?? lastInvoice.issue_date})
            </button>
          )}
          {selectedContact && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-muted mt-0.5">
              <span>
                Owes <span className="font-mono text-text-primary">{formatMoney(customerSummary.outstanding, 'USD')}</span>
              </span>
              <span className={customerSummary.overdue > 0 ? 'text-danger font-medium' : ''}>
                Overdue <span className="font-mono">{formatMoney(customerSummary.overdue, 'USD')}</span>
              </span>
              <span>Net {selectedContact.payment_terms_days}</span>
              {selectedContact.credit_limit ? (
                <span>
                  Credit limit <span className="font-mono">{formatMoney(selectedContact.credit_limit, 'USD')}</span>
                </span>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary flex items-center">
            Issue date
            <FieldHelp
              help="The invoice date determining the fiscal period and aging calculation."
              example="2026-10-28"
            />
          </label>
          <input
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            className="h-8 px-2.5 bg-surface border border-border rounded-sm text-xs font-mono text-text-primary focus:outline-none focus:border-accent"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary flex items-center">
            Due date
            <FieldHelp
              help="Settlement due date based on customer credit terms (e.g. Net 30)."
              example="2026-11-27"
            />
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => {
              setDueDate(e.target.value);
              setDueDateEdited(true);
            }}
            className="h-8 px-2.5 bg-surface border border-border rounded-sm text-xs font-mono text-text-primary focus:outline-none focus:border-accent"
          />
          {selectedContact && (
            <span className="text-[11px] text-text-muted">
              {dueDateEdited ? 'Custom date' : `Net ${selectedContact.payment_terms_days}`}
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-xs font-medium text-text-secondary flex items-center">
            Customer reference (PO #)
            <FieldHelp
              help="Customer's external purchase order number or contract identifier."
              example="PO-HT-2026-X1"
            />
          </label>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. PO-HT-2026-X1"
            className="h-8 px-2.5 bg-surface border border-border rounded-sm text-xs font-mono text-text-primary focus:outline-none focus:border-accent"
          />
        </div>

        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-xs font-medium text-text-secondary flex items-center">
            Memo
            <FieldHelp
              help="Overall summary narrative printed on invoice header and visible in statements."
              example="Telecom tower equipment spares"
            />
          </label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Contract details or delivery note reference..."
            className="h-8 px-2.5 bg-surface border border-border rounded-sm text-xs text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Editable Line Grid */}
      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-text-primary">Lines</span>

        <LineGrid
          mode="invoice"
          lines={lines}
          onChange={setLines}
          accounts={accounts}
          dimensions={dimensions}
          taxCodes={taxCodes}
          currency="USD"
          showTotals={false}
          items={items}
          lineDefaults={lineDefaults}
        />

        <div className="flex justify-end">
          <dl className="w-64 text-xs flex flex-col gap-1.5">
            <div className="flex justify-between text-text-secondary">
              <dt>Subtotal</dt>
              <dd className="font-mono text-num text-text-primary">{formatMoney(subtotal, 'USD')}</dd>
            </div>
            <div className="flex justify-between text-text-secondary">
              <dt>VAT 5%</dt>
              <dd className="font-mono text-num text-text-primary">{formatMoney(taxTotal, 'USD')}</dd>
            </div>
            <div className="flex justify-between items-baseline border-t border-border pt-2 mt-0.5">
              <dt className="font-semibold text-text-primary text-sm">Total</dt>
              <dd className="font-mono text-num font-semibold text-text-primary text-base">{formatMoney(total, 'USD')}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Controls compliance footer note */}
      <div className="p-3 bg-surface-neutral/60 rounded-md border border-border text-xs text-text-muted flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-accent" />
          <span>
            After you submit, an approver reviews it before it's recorded and sent. Period: Oct 2026.
          </span>
        </div>
        <div className="hidden md:flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1"><Kbd>⌘S</Kbd> Save draft</span>
          <span className="inline-flex items-center gap-1"><Kbd>⌘↵</Kbd> Submit</span>
        </div>
      </div>

      {/* Plain Language Consequence Modal */}
      <ConsequenceDialog
        isOpen={showConsequence}
        onClose={() => setShowConsequence(false)}
        onConfirm={handleConfirmSubmit}
        title="Submit invoice for approval"
        actionType="submit"
        plainLanguageEffect={`This will send to Fatima for approval. When approved it posts 3 lines to Oct 2026 and increases ${selectedContact?.name || 'Hormuud Telecom'}'s balance by ${formatMoney(total, 'USD')}.`}
        accountingLines={accountingPreviewLines}
        confirmLabel="Submit"
        isSubmitting={isSubmitting}
      />
    </div>
  );
};

/** The demo keeps its store-backed screen; live mode reads the API (docs/15). */
export const InvoiceForm: React.FC = selectByMode({ mock: MockInvoiceForm, live: InvoiceFormLive });
