import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { Bill, BillLine } from '@/types';
import { buildJournalFromBill } from '@/mock/PostingRules';
import { formatMoney } from '@/lib/format';
import { paymentStatus, amountDue } from '@/lib/docStatus';
import { AccountPicker } from '@/components/domain/AccountPicker';
import { ContactPicker } from '@/components/domain/ContactPicker';
import { FieldHelp } from '@/components/domain/FieldHelp';
import { ConsequenceDialog, ConsequenceAccountingLine } from '@/components/domain/ConsequenceDialog';
import { PageHeader } from '@/components/domain/PageHeader';
import { Kbd } from '@/components/ui/kbd';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Send, AlertTriangle, ShieldCheck, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { BillDropZone, BillExtractedPanel, extractBill, type BillExtraction, type CaptureField } from './BillCapture';
import { BillTotals, BillRecorded, type RecordedRow } from './bill-form/BillTotals';

const labelCls = 'text-xs font-medium text-text-secondary flex items-center';
const inputCls =
  'h-8 px-2.5 bg-surface border border-border rounded-md text-xs text-text-primary focus:outline-none focus:border-accent';
const cellInput =
  'h-7 px-1.5 text-xs rounded border border-transparent hover:border-border focus:border-accent bg-transparent text-text-primary focus:bg-surface focus:outline-none';
const WHT_OPTIONS = [
  { v: 0, l: 'No withholding tax' },
  { v: 3, l: '3% · Goods and general contracts' },
  { v: 5, l: '5% · Professional services and consulting' },
  { v: 10, l: '10% · Rent and technical fees' },
];
const BRANCHES = ['MG', 'HR', 'BS'];
const COST_CENTRES = ['OPS', 'ADMIN', 'SALES'];

interface FormLine {
  id: string;
  line_no: number;
  account_id: string;
  description: string;
  quantity: number;
  unit_price_fc: number;
  tax_code_id: string;
  branch: string;
  cost_centre: string;
}

export const BillForm: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, currentUser, contacts, accounts, bills, saveBillDraft, submitBillForApproval, companySettings } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const suppliers = contacts.filter((c) => c.kind === 'supplier' || c.kind === 'both');

  const [contactId, setContactId] = useState(suppliers[0]?.id || '');
  const [reference, setReference] = useState('DAH-INV-2026-884');
  const [issueDate, setIssueDate] = useState('2026-10-28');
  const [dueDate, setDueDate] = useState('2026-11-27');
  const [dueDateEdited, setDueDateEdited] = useState(false);
  const [currency, setCurrency] = useState('USD');
  const [fxRate, setFxRate] = useState(1.0);
  const [memo, setMemo] = useState('Monthly telecom network connectivity & trunk lines');
  const [whtRatePct, setWhtRatePct] = useState<number>(5);
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConsequence, setShowConsequence] = useState(false);
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const touch = (f: string) => setTouched((t) => new Set(t).add(f));
  const showErr = (f: string) => submitAttempted || touched.has(f);
  const [extraction, setExtraction] = useState<BillExtraction | null>(null);
  const [filled, setFilled] = useState<Set<CaptureField>>(new Set());
  const hl = (f: CaptureField) => (filled.has(f) ? 'ring-2 ring-accent/40 bg-accent-soft/40' : '');
  const gridRef = useRef<HTMLTableElement>(null);
  const [focusNew, setFocusNew] = useState(false);

  const [lines, setLines] = useState<FormLine[]>([
    {
      id: 'line-1',
      line_no: 1,
      account_id: 'acc-6200',
      description: 'Dedicated Fiber Trunk Bandwidth (Oct 2026)',
      quantity: 1,
      unit_price_fc: 350000,
      tax_code_id: 'tax-exempt',
      branch: 'MG',
      cost_centre: 'OPS',
    },
    {
      id: 'line-2',
      line_no: 2,
      account_id: 'acc-6300',
      description: 'Network redundancy maintenance support',
      quantity: 1,
      unit_price_fc: 100000,
      tax_code_id: 'tax-exempt',
      branch: 'MG',
      cost_centre: 'OPS',
    },
  ]);

  const subtotalFc = lines.reduce((sum, l) => sum + l.quantity * l.unit_price_fc, 0);
  const taxTotalFc = 0; // Exempt or zero-rated
  const totalFc = subtotalFc + taxTotalFc;
  const whtAmountFc = Math.round((totalFc * whtRatePct) / 100);
  const netPayableFc = totalFc - whtAmountFc;

  const selectedSupplier = suppliers.find((s) => s.id === contactId);

  // Due date follows bill date + supplier terms until edited by hand
  useEffect(() => {
    if (dueDateEdited || !selectedSupplier) return;
    const d = new Date(`${issueDate}T00:00:00Z`);
    if (isNaN(d.getTime())) return;
    d.setUTCDate(d.getUTCDate() + selectedSupplier.payment_terms_days);
    setDueDate(d.toISOString().slice(0, 10));
  }, [issueDate, selectedSupplier, dueDateEdited]);

  const balances = useMemo(() => {
    const out: Record<string, number> = {};
    for (const b of bills) {
      if (b.status !== 'posted') continue;
      const st = paymentStatus(b);
      if (st === 'awaiting_payment' || st === 'partially_paid' || st === 'overdue') {
        out[b.contact_id] = (out[b.contact_id] || 0) + amountDue(b);
      }
    }
    return out;
  }, [bills]);

  const supplierSummary = useMemo(() => {
    let overdue = 0;
    for (const b of bills) {
      if (b.contact_id !== contactId || b.status !== 'posted') continue;
      if (paymentStatus(b) === 'overdue') overdue += amountDue(b);
    }
    return { owe: balances[contactId] || 0, overdue };
  }, [bills, contactId, balances]);

  const handleAddLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: `line-${Date.now()}`,
        line_no: prev.length + 1,
        account_id: selectedSupplier?.default_account_id ?? 'acc-6200',
        description: '',
        quantity: 1,
        unit_price_fc: 0,
        tax_code_id: selectedSupplier?.default_tax_code_id ?? 'tax-exempt',
        branch: selectedSupplier?.default_branch ?? 'MG',
        cost_centre: 'ADMIN',
      },
    ]);
    setFocusNew(true);
  };

  useEffect(() => {
    if (!focusNew) return;
    setFocusNew(false);
    const rows = gridRef.current?.querySelectorAll<HTMLInputElement>('input[data-col="description"]');
    rows?.[rows.length - 1]?.focus();
  }, [focusNew, lines.length]);

  const handleRemoveLine = (id: string) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const handleUpdateLine = (id: string, updates: Partial<FormLine>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)));
  };

  /** Supplier defaults only pre-fill new or still-empty lines (nothing the user typed is overwritten). */
  const applySupplierDefaults = (supplierId: string) => {
    const sup = suppliers.find((s) => s.id === supplierId);
    if (!sup) return;
    setLines((prev) =>
      prev.map((l) =>
        l.description.trim() === '' && l.unit_price_fc === 0
          ? {
              ...l,
              account_id: sup.default_account_id ?? l.account_id,
              tax_code_id: sup.default_tax_code_id ?? l.tax_code_id,
              branch: sup.default_branch ?? l.branch,
            }
          : l
      )
    );
  };

  const handleSupplierChange = (id: string) => {
    setContactId(id);
    applySupplierDefaults(id);
  };

  const handleCapture = (file: File) => {
    const x = extractBill(file, suppliers);
    const sup = suppliers.find((s) => s.id === x.supplierId);
    setExtraction(x);
    setFilled(new Set<CaptureField>(['amount', 'date', 'due', 'reference', ...(sup ? (['supplier'] as CaptureField[]) : [])]));
    setContactId(sup?.id ?? '');
    setReference(x.reference);
    setIssueDate(x.date);
    setDueDate(x.due);
    setDueDateEdited(true);
    setMemo(`Captured from ${x.fileName}`);
    setLines([
      {
        id: `line-${Date.now()}`,
        line_no: 1,
        account_id: sup?.default_account_id ?? 'acc-6200',
        description: `Per attached bill (${x.fileName})`,
        quantity: 1,
        unit_price_fc: x.amount,
        tax_code_id: sup?.default_tax_code_id ?? 'tax-exempt',
        branch: sup?.default_branch ?? 'MG',
        cost_centre: 'ADMIN',
      },
    ]);
    toast.success('Bill read — please check the details before saving');
  };

  const handlePickCapturedSupplier = (id: string) => {
    const sup = suppliers.find((s) => s.id === id);
    if (!sup || !extraction) return;
    setContactId(id);
    const due = new Date(new Date(`${issueDate}T00:00:00Z`).getTime() + sup.payment_terms_days * 86_400_000).toISOString().slice(0, 10);
    setDueDate(due);
    setLines((prev) => prev.map((l) => ({ ...l, account_id: sup.default_account_id ?? l.account_id, tax_code_id: sup.default_tax_code_id ?? l.tax_code_id, branch: sup.default_branch ?? l.branch })));
    setFilled((f) => new Set(f).add('supplier'));
  };



  const supplierName = selectedSupplier?.name || 'the supplier';
  const sentence = `Your expenses go up by ${formatMoney(totalFc, currency)}${
    whtAmountFc > 0 ? `, ${formatMoney(whtAmountFc, currency)} is held back as withholding tax,` : ''
  } and you owe ${supplierName} ${formatMoney(netPayableFc, currency)}.`;

  const buildBill = (status: Bill['status']): Bill => {
    const billLines: BillLine[] = lines.map((l) => ({
      id: l.id,
      line_no: l.line_no,
      account_id: l.account_id,
      description: l.description,
      quantity: l.quantity,
      unit_price_fc: l.unit_price_fc,
      discount_pct: 0,
      tax_code_id: l.tax_code_id,
      line_total_fc: l.quantity * l.unit_price_fc,
      tax_amount_fc: 0,
      dimensions: { branch: l.branch, cost_centre: l.cost_centre },
    }));
    return {
      id: `bill-${Date.now()}`,
      tenant_id: currentCompany.tenant_id,
      company_id: currentCompany.id,
      kind: 'purchase_bill',
      number: null,
      status,
      contact_id: contactId,
      issue_date: issueDate,
      due_date: dueDate,
      currency,
      fx_rate: fxRate,
      reference,
      memo,
      lines: billLines,
      subtotal_fc: subtotalFc,
      tax_total_fc: taxTotalFc,
      total_fc: totalFc,
      subtotal: Math.round(subtotalFc * fxRate),
      tax_total: Math.round(taxTotalFc * fxRate),
      total: Math.round(totalFc * fxRate),
      settled_fc: 0,
      settled: 0,
      wht_code_id: whtRatePct > 0 ? 'wht-5' : undefined,
      wht_amount_fc: whtAmountFc,
      created_by: currentUser.id,
      ...(status === 'pending_approval' ? { submitted_by: currentUser.id } : {}),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  };

  // "How it's recorded" comes from the same posting rules the approver's post will use, so the
  // preview can never disagree with the ledger (VAT input, withholding tax, AP net of WHT).
  let recordedRows: RecordedRow[] = [];
  try {
    const preview = buildJournalFromBill(buildBill('draft'), companySettings, '', currentUser);
    const byAcc = new Map<string, { debit: number; credit: number }>();
    for (const l of preview.lines) {
      const cur = byAcc.get(l.account_id) ?? { debit: 0, credit: 0 };
      byAcc.set(l.account_id, { debit: cur.debit + l.debit, credit: cur.credit + l.credit });
    }
    recordedRows = [...byAcc.entries()]
      .map(([id, v]) => {
        const acc = accounts.find((x) => x.id === id);
        return { key: id, code: acc?.code ?? '', name: acc?.name ?? 'Account', debit: v.debit, credit: v.credit };
      })
      .sort((x, y) => (y.debit > 0 ? 1 : 0) - (x.debit > 0 ? 1 : 0));
  } catch {
    recordedRows = [];
  }
  const accountingPreviewLines: ConsequenceAccountingLine[] = recordedRows.map((r) => ({
    accountCode: r.code,
    accountName: r.name,
    debit: r.debit,
    credit: r.credit,
  }));

  const validate = (): boolean => {
    setSubmitAttempted(true);
    if (!contactId) {
      setShowConsequence(false);
      setErrorMsg('Choose the supplier before saving this bill.');
      return false;
    }
    setErrorMsg('');
    return true;
  };

  const handleSaveDraft = async () => {
    if (!validate()) return;
    try {
      setIsSubmitting(true);
      saveBillDraft(buildBill('draft'), currentUser);
      toast.success('Supplier bill draft saved', {
        action: { label: 'Undo', onClick: () => toast.info('Draft action restored') },
      });
      navigate(`/${coSlug}/bills`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save bill');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenSubmit = () => {
    if (!validate()) return;
    setShowConsequence(true);
  };

  const handleConfirmSubmit = async () => {
    if (!validate()) return;
    try {
      setIsSubmitting(true);
      setShowConsequence(false);
      const saved = saveBillDraft(buildBill('pending_approval'), currentUser);
      submitBillForApproval(saved.id, currentUser);
      toast.success('Bill submitted for approval');
      navigate(`/${coSlug}/bills`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to submit bill');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Keyboard shortcuts: Ctrl/Cmd+Enter submits, Ctrl/Cmd+S saves a draft
  const shortcutRef = useRef({ submit: handleOpenSubmit, save: handleSaveDraft, busy: false });
  shortcutRef.current = { submit: handleOpenSubmit, save: handleSaveDraft, busy: isSubmitting || showConsequence };
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

  const supplierErr = showErr('supplier') && !contactId;
  const issueErr = showErr('issue') && !issueDate;
  const dueErr = showErr('due') && !dueDate;
  const expenseAccounts = accounts.filter((a) => a.account_type === 'expense' || a.account_type === 'asset');
  const errText = (m: string) => <span className="text-[11px] text-danger">{m}</span>;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumb={[{ label: 'Bills', to: `/${coSlug}/bills` }, { label: 'New bill' }]}
        title="New bill"
        subtitle="Enter what a supplier charged you."
        actions={
          <>
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={isSubmitting}
              className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border hover:border-border-strong bg-surface text-text-secondary hover:text-text-primary text-xs font-medium transition"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save draft</span>
              <Kbd className="hidden sm:inline-flex">⌘S</Kbd>
            </button>
            <button
              type="button"
              onClick={handleOpenSubmit}
              disabled={isSubmitting}
              className="flex items-center gap-1.5 h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded-md text-[13px] font-medium transition"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Submit for approval</span>
              <Kbd className="hidden sm:inline-flex bg-white/20 border-white/30 text-white">⌘↵</Kbd>
            </button>
          </>
        }
      />

      {errorMsg && (
        <div className="p-3 bg-danger-soft/20 text-danger border border-danger/30 rounded-md text-xs font-medium flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMsg}</span>
        </div>
      )}

      <BillDropZone onFile={handleCapture} />
      {extraction && (
        <BillExtractedPanel
          extraction={extraction}
          supplierName={selectedSupplier?.name}
          suppliers={suppliers}
          needsSupplier={!contactId}
          onPickSupplier={handlePickCapturedSupplier}
          onDismiss={() => {
            setExtraction(null);
            setFilled(new Set());
          }}
        />
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-5 bg-surface border border-border rounded-lg">
        <div className="flex flex-col gap-1 md:col-span-2">
          <label className={labelCls}>
            Supplier <span className="text-text-muted ml-0.5">*</span>
            <FieldHelp help="Who the bill is from. Sets the payment terms and default accounts." example="Dahabshiil" />
          </label>
          <div className={`rounded-md ${hl('supplier')}`} onBlur={() => touch('supplier')}>
            <ContactPicker
              kind="supplier"
              value={contactId}
              onChange={(id) => handleSupplierChange(id)}
              balances={balances}
              balanceLabel="you owe"
              currency={currency}
              className={supplierErr ? 'border-danger' : undefined}
            />
          </div>
          {supplierErr && errText('Choose a supplier.')}
          {selectedSupplier && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-text-muted mt-0.5">
              <span>
                You owe <span className="font-mono text-text-primary">{formatMoney(supplierSummary.owe, 'USD')}</span>
              </span>
              <span className={supplierSummary.overdue > 0 ? 'text-danger font-medium' : ''}>
                Overdue <span className="font-mono">{formatMoney(supplierSummary.overdue, 'USD')}</span>
              </span>
              <span>Net {selectedSupplier.payment_terms_days}</span>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1">
          <label className={labelCls}>
            Bill date
            <FieldHelp help="The date printed on the supplier's bill. Decides which period it lands in." example="2026-10-28" />
          </label>
          <input
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            onBlur={() => touch('issue')}
            className={`${inputCls} font-mono ${hl('date')} ${issueErr ? 'border-danger' : ''}`}
          />
          {issueErr && errText('Enter the bill date.')}
        </div>

        <div className="flex flex-col gap-1">
          <label className={labelCls}>
            Due date
            <FieldHelp help="When the supplier expects payment, based on their terms." example="2026-11-27" />
          </label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => {
              setDueDate(e.target.value);
              setDueDateEdited(true);
            }}
            onBlur={() => touch('due')}
            className={`${inputCls} font-mono ${hl('due')} ${dueErr ? 'border-danger' : ''}`}
          />
          {dueErr ? (
            errText('Enter the due date.')
          ) : (
            selectedSupplier && (
              <span className="text-[11px] text-text-muted">
                {dueDateEdited ? 'Custom date' : `Net ${selectedSupplier.payment_terms_days}`}
              </span>
            )
          )}
        </div>

        <div className="flex flex-col gap-1 md:col-span-2">
          <label className={labelCls}>
            Supplier invoice number
            <FieldHelp help="The reference printed on the supplier's original bill." example="DAH-INV-2026-884" />
          </label>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. DAH-8849"
            className={`${inputCls} font-mono ${hl('reference')}`}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={labelCls}>
            Currency
            <FieldHelp help="The currency on the bill and its rate to USD, your company currency." example="USD @ 1.0000" />
          </label>
          <div className="flex items-center gap-1.5">
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="w-24" aria-label="Currency">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {['USD', 'KES', 'SOS'].map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input
              type="number"
              step="0.0001"
              aria-label="Exchange rate"
              value={fxRate}
              onChange={(e) => setFxRate(parseFloat(e.target.value) || 1)}
              className={`${inputCls} w-20 font-mono text-right`}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className={labelCls}>
            Withholding tax
            <FieldHelp help="Tax you hold back from the payment and pay to the tax authority." example="5% professional services" />
          </label>
          <Select value={String(whtRatePct)} onValueChange={(v) => setWhtRatePct(parseInt(v, 10))}>
            <SelectTrigger aria-label="Withholding tax">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WHT_OPTIONS.map((o) => (
                <SelectItem key={o.v} value={String(o.v)}>{o.l}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex flex-col gap-1 md:col-span-4">
          <label className={labelCls}>Memo</label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="What this bill is for"
            className={inputCls}
          />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-text-primary">Lines</span>
          <button
            type="button"
            onClick={handleAddLine}
            className="flex items-center gap-1 text-xs text-accent font-semibold hover:text-accent-hover transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add line</span>
          </button>
        </div>

        <div className="border border-border rounded-lg overflow-hidden bg-surface">
          <table ref={gridRef} className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="h-8 bg-surface-neutral border-b border-border text-[11px] font-semibold text-text-muted">
                <th className="px-2 w-8 text-center">#</th>
                <th className="px-2 w-56">Expense account</th>
                <th className="px-2">Description</th>
                <th className="px-2 w-24">Branch</th>
                <th className="px-2 w-28">Cost centre</th>
                <th className="px-2 w-16 text-right">Qty</th>
                <th className="px-2 w-28 text-right">Unit price</th>
                <th className="px-2 w-28 text-right">Amount</th>
                <th className="px-2 w-10" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((line, idx) => (
                <tr key={line.id} className="h-10 hover:bg-surface-neutral/50 transition">
                  <td className="px-2 text-center text-text-muted font-mono text-[11px]">{idx + 1}</td>
                  <td className="px-2">
                    <AccountPicker
                      accounts={expenseAccounts}
                      value={line.account_id}
                      onChange={(accId) => handleUpdateLine(line.id, { account_id: accId })}
                    />
                  </td>
                  <td className="px-2">
                    <input
                      type="text"
                      data-col="description"
                      value={line.description}
                      onChange={(e) => handleUpdateLine(line.id, { description: e.target.value })}
                      placeholder="What was bought"
                      className={`${cellInput} w-full`}
                    />
                  </td>
                  <td className="px-2">
                    <Select value={line.branch} onValueChange={(v) => handleUpdateLine(line.id, { branch: v })}>
                      <SelectTrigger className="h-7 text-xs px-1.5" aria-label="Branch">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {BRANCHES.map((b) => (
                          <SelectItem key={b} value={b}>{b}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2">
                    <Select value={line.cost_centre} onValueChange={(v) => handleUpdateLine(line.id, { cost_centre: v })}>
                      <SelectTrigger className="h-7 text-xs px-1.5" aria-label="Cost centre">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {COST_CENTRES.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="px-2 text-right">
                    <input
                      type="number"
                      min="1"
                      aria-label="Quantity"
                      value={line.quantity}
                      onChange={(e) => handleUpdateLine(line.id, { quantity: Math.max(1, parseInt(e.target.value, 10) || 1) })}
                      className={`${cellInput} w-14 text-right font-mono`}
                    />
                  </td>
                  <td className="px-2 text-right">
                    <input
                      type="number"
                      step="0.01"
                      aria-label="Unit price"
                      value={(line.unit_price_fc / 100).toFixed(2)}
                      onChange={(e) => handleUpdateLine(line.id, { unit_price_fc: Math.round((parseFloat(e.target.value) || 0) * 100) })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && idx === lines.length - 1) {
                          e.preventDefault();
                          handleAddLine();
                        }
                      }}
                      className={`${cellInput} w-24 text-right font-mono ${filled.has('amount') ? 'ring-2 ring-accent/40 bg-accent-soft/40' : ''}`}
                    />
                  </td>
                  <td className="px-2 text-right font-mono font-medium text-text-primary text-num">
                    {formatMoney(line.quantity * line.unit_price_fc, currency)}
                  </td>
                  <td className="px-2 text-center">
                    <button
                      type="button"
                      aria-label="Remove line"
                      onClick={() => handleRemoveLine(line.id)}
                      className="p-1 rounded text-text-muted hover:text-danger hover:bg-surface-neutral transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <BillTotals
          subtotal={subtotalFc}
          tax={taxTotalFc}
          total={totalFc}
          whtPct={whtRatePct}
          whtAmount={whtAmountFc}
          netPayable={netPayableFc}
          currency={currency}
        />
      </div>

      <BillRecorded rows={recordedRows} sentence={sentence} currency={currency} />

      <div className="p-3 bg-surface-neutral/60 rounded-md border border-border text-xs text-text-muted flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-accent" />
          <span>After you submit, an approver reviews it before it's recorded. Period: Oct 2026.</span>
        </div>
        <div className="hidden md:flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1"><Kbd>⌘S</Kbd> Save draft</span>
          <span className="inline-flex items-center gap-1"><Kbd>⌘↵</Kbd> Submit</span>
          <span className="inline-flex items-center gap-1"><Kbd>↵</Kbd> Add line (on the last price)</span>
        </div>
      </div>

      <ConsequenceDialog
        isOpen={showConsequence}
        onClose={() => setShowConsequence(false)}
        onConfirm={handleConfirmSubmit}
        title="Submit bill for approval"
        actionType="submit"
        plainLanguageEffect={`This will send to Kenneth for approval. When approved, ${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`}
        accountingLines={accountingPreviewLines}
        confirmLabel="Submit"
        isSubmitting={isSubmitting}
      />
    </div>
  );
};
