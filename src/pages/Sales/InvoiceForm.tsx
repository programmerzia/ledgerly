import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerlyStore } from '@/mock/store';
import { LineGrid, GridLineItem } from '@/components/domain/LineGrid';
import { formatMoney } from '@/lib/format';
import { ArrowLeft, Save, Send, AlertTriangle, ShieldCheck } from 'lucide-react';

export const InvoiceForm: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, contacts, accounts, dimensions, taxCodes } = useLedgerlyStore();
  const coSlug = currentCompany.slug;

  const [contactId, setContactId] = useState('cnt-1'); // Hormuud Telecom
  const [issueDate, setIssueDate] = useState('2026-10-28');
  const [dueDate, setDueDate] = useState('2026-11-27');
  const [reference, setReference] = useState('PO-HT-2026-X1');
  const [memo, setMemo] = useState('Telecom tower equipment and maintenance spares');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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

  // Validation function enforcing controls
  const validateForm = (): boolean => {
    setErrorMessage('');
    // Check required Branch dimension on all lines
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].dimensions?.branch) {
        setErrorMessage(
          'Controls Validation Failed: Branch dimension is strictly required on all lines (Branch = Mogadishu required for Hormuud Telecom).'
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

  const handleSubmit = async (submitForApproval: boolean) => {
    if (submitForApproval) {
      const isValid = validateForm();
      if (!isValid) return;
    }

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
        status: submitForApproval ? 'pending_approval' : 'draft',
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

      navigate(`/${coSlug}/invoices/${invoice.id}`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create invoice');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Top Header */}
      <div className="flex items-center justify-between pb-4 border-b border-ink-200">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(`/${coSlug}/invoices`)}
            className="p-1.5 rounded-sm border border-ink-200 hover:bg-ink-100 text-ink-500 hover:text-ink-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-h1 font-bold text-ink-900">New Sales Invoice</h1>
            <p className="text-xs text-ink-500 mt-0.5">
              Draft document • Autosaved locally • Dual-control approval required
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => handleSubmit(false)}
            disabled={isSubmitting}
            className="flex items-center gap-1.5 h-8 px-3 rounded-sm border border-ink-200 hover:border-ink-300 bg-surface text-ink-700 text-xs font-medium transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Draft</span>
          </button>

          <button
            type="button"
            onClick={() => handleSubmit(true)}
            disabled={isSubmitting}
            className="flex items-center gap-1.5 h-8 px-4 bg-brand-600 hover:bg-brand-700 text-white rounded-sm text-xs font-semibold shadow-sm transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Submit for Approval</span>
          </button>
        </div>
      </div>

      {/* Inline Validation Error Banner (Demo Step 2 requirement) */}
      {errorMessage && (
        <div className="p-3 bg-danger-bg text-danger border border-danger/30 rounded-md text-xs font-medium flex items-center justify-between animate-in fade-in">
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
            Quick-fill Mogadishu Branch
          </button>
        </div>
      )}

      {/* Header Fields: Customer, Dates, Reference */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-5 bg-surface border border-ink-200 rounded-md shadow-sm">
        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-xs font-medium text-ink-700 flex items-center">
            Customer <span className="text-danger ml-0.5">*</span>
          </label>
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            className="h-8 px-2.5 bg-surface border border-ink-200 rounded-sm text-xs text-ink-900 focus:outline-none focus:border-brand-500 font-medium"
          >
            {contacts
              .filter((c) => c.kind === 'customer' || c.kind === 'both')
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-700">Issue Date</label>
          <input
            type="date"
            value={issueDate}
            onChange={(e) => setIssueDate(e.target.value)}
            className="h-8 px-2.5 bg-surface border border-ink-200 rounded-sm text-xs font-mono text-ink-900 focus:outline-none focus:border-brand-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-700">Due Date</label>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className="h-8 px-2.5 bg-surface border border-ink-200 rounded-sm text-xs font-mono text-ink-900 focus:outline-none focus:border-brand-500"
          />
        </div>

        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-xs font-medium text-ink-700">Customer Reference (PO #)</label>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. PO-HT-2026-X1"
            className="h-8 px-2.5 bg-surface border border-ink-200 rounded-sm text-xs font-mono text-ink-900 focus:outline-none focus:border-brand-500"
          />
        </div>

        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-xs font-medium text-ink-700">Memo / Internal Notes</label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Contract details or delivery note reference..."
            className="h-8 px-2.5 bg-surface border border-ink-200 rounded-sm text-xs text-ink-900 focus:outline-none focus:border-brand-500"
          />
        </div>
      </div>

      {/* Editable Line Grid */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-ink-900 uppercase tracking-wider">
            Invoice Lines (VAT 5%, Branch Required)
          </span>
          <span className="text-[11px] text-ink-500">
            Total amount:{' '}
            <strong className="text-ink-900 font-mono">{formatMoney(total, 'USD')}</strong>
          </span>
        </div>

        <LineGrid
          mode="invoice"
          lines={lines}
          onChange={setLines}
          accounts={accounts}
          dimensions={dimensions}
          taxCodes={taxCodes}
          currency="USD"
        />
      </div>

      {/* Controls compliance footer note */}
      <div className="p-3 bg-ink-100/60 rounded-md border border-ink-200 text-xs text-ink-500 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-brand-600" />
          <span>
            Upon submission, this invoice will enter the <strong>pending_approval</strong> state and
            must be authorized by an independent Finance Manager before posting to the general ledger.
          </span>
        </div>
        <span className="font-mono text-[11px] font-semibold text-ink-700">Period: Oct 2026</span>
      </div>
    </div>
  );
};
