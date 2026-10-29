import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { Bill, BillLine } from '@/types';
import { formatMoney } from '@/lib/format';
import { SignDialog } from '@/components/domain/SignDialog';
import { AccountPicker } from '@/components/domain/AccountPicker';
import {
  FileText,
  Save,
  Send,
  ArrowLeft,
  Building,
  Calendar,
  Layers,
  Coins,
  AlertCircle,
  Plus,
  Trash2,
  CheckCircle2,
} from 'lucide-react';

export const BillForm: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, currentUser, contacts, accounts, taxCodes, saveBillDraft, submitBillForApproval } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const suppliers = contacts.filter((c) => c.kind === 'supplier');

  const [contactId, setContactId] = useState(suppliers[0]?.id || 'cnt-3'); // Dahabshiil or first supplier
  const [reference, setReference] = useState('DAH-INV-2026-884');
  const [issueDate, setIssueDate] = useState('2026-10-28');
  const [dueDate, setDueDate] = useState('2026-11-27');
  const [currency, setCurrency] = useState('USD');
  const [fxRate, setFxRate] = useState(1.0);
  const [memo, setMemo] = useState('Monthly telecom network connectivity & trunk lines');
  const [whtRatePct, setWhtRatePct] = useState<number>(5); // 5% standard withholding tax
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [signDialogOpen, setSignDialogOpen] = useState(false);

  // Line items
  const [lines, setLines] = useState<
    Array<{
      id: string;
      line_no: number;
      account_id: string;
      description: string;
      quantity: number;
      unit_price_fc: number;
      tax_code_id: string;
      branch: string;
      cost_centre: string;
    }>
  >([
    {
      id: 'line-1',
      line_no: 1,
      account_id: 'acc-6200', // Utilities / Telecom
      description: 'Dedicated Fiber Trunk Bandwidth (Oct 2026)',
      quantity: 1,
      unit_price_fc: 350000, // $3,500.00
      tax_code_id: 'tax-exempt',
      branch: 'MG',
      cost_centre: 'OPS',
    },
    {
      id: 'line-2',
      line_no: 2,
      account_id: 'acc-6300', // Consulting / Tech Services
      description: 'Network redundancy maintenance support',
      quantity: 1,
      unit_price_fc: 100000, // $1,000.00
      tax_code_id: 'tax-exempt',
      branch: 'MG',
      cost_centre: 'OPS',
    },
  ]);

  // Calculations
  const subtotalFc = lines.reduce((sum, l) => sum + l.quantity * l.unit_price_fc, 0);
  const taxTotalFc = 0; // Exempt or zero-rated
  const totalFc = subtotalFc + taxTotalFc;
  const whtAmountFc = Math.round((totalFc * whtRatePct) / 100);
  const netPayableFc = totalFc - whtAmountFc;

  const handleAddLine = () => {
    setLines((prev) => [
      ...prev,
      {
        id: `line-${Date.now()}`,
        line_no: prev.length + 1,
        account_id: 'acc-6200',
        description: '',
        quantity: 1,
        unit_price_fc: 0,
        tax_code_id: 'tax-exempt',
        branch: 'MG',
        cost_centre: 'ADMIN',
      },
    ]);
  };

  const handleRemoveLine = (id: string) => {
    if (lines.length <= 1) return;
    setLines((prev) => prev.filter((l) => l.id !== id));
  };

  const handleUpdateLine = (id: string, updates: Partial<(typeof lines)[0]>) => {
    setLines((prev) => prev.map((l) => (l.id === id ? { ...l, ...updates } : l)));
  };

  const handleSubmit = async (targetStatus: 'draft' | 'pending_approval') => {
    try {
      setErrorMsg('');
      setIsSubmitting(true);

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
        dimensions: {
          branch: l.branch,
          cost_centre: l.cost_centre,
        },
      }));

      const newBill: Bill = {
        id: `bill-${Date.now()}`,
        tenant_id: currentCompany.tenant_id,
        company_id: currentCompany.id,
        kind: 'purchase_bill',
        number: null,
        status: targetStatus,
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
        submitted_by: targetStatus === 'pending_approval' ? currentUser.id : undefined,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      if (targetStatus === 'draft') {
        saveBillDraft(newBill, currentUser);
      } else {
        const saved = saveBillDraft(newBill, currentUser);
        submitBillForApproval(saved.id, currentUser);
      }
      navigate(`/${coSlug}/bills`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save bill');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-canvas">
      <div className="w-full flex flex-col gap-6">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => navigate(`/${coSlug}/bills`)}
              className="p-1.5 rounded-sm text-text-muted hover:text-text-primary hover:bg-surface-neutral transition shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div>
              <h1 className="text-xl font-semibold text-text-primary">Record a Bill from a Supplier</h1>
              <p className="text-xs text-text-muted">
                Supplier invoice • AP control & withholding tax entry
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => handleSubmit('draft')}
              disabled={isSubmitting}
              className="h-8 px-3 rounded-sm border border-line-border bg-surface-elevated hover:bg-surface-neutral text-ink-900 text-xs font-medium transition flex items-center gap-1.5"
            >
              <Save className="w-3.5 h-3.5 text-ink-muted" />
              <span>Save as Draft</span>
            </button>
            <button
              type="button"
              onClick={() => handleSubmit('pending_approval')}
              disabled={isSubmitting}
              className="h-8 px-4 rounded-sm bg-brand-teal hover:bg-brand-teal-hover text-white text-xs font-semibold shadow-2xs transition flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Submit for Approval</span>
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="p-3 bg-danger-bg border border-danger/30 rounded-md text-danger text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Header Fields Form */}
        <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
          {/* Supplier */}
          <div className="flex flex-col gap-1 md:col-span-2">
            <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider flex items-center gap-1">
              <Building className="w-3 h-3 text-brand-teal" />
              Supplier Contact *
            </label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="h-8 px-2.5 rounded-sm border border-line-border bg-surface-subtle font-medium text-ink-900 focus:outline-none focus:border-brand-teal"
            >
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </div>

          {/* Supplier Reference / Bill # */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
              Supplier Invoice Ref *
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. DAH-8849"
              className="h-8 px-2.5 font-mono text-ink-900 rounded-sm border border-line-border bg-surface-subtle focus:bg-surface-elevated focus:outline-none focus:border-brand-teal"
            />
          </div>

          {/* Currency */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
              Currency & FX
            </label>
            <div className="flex items-center gap-1.5">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="h-8 px-2 rounded-sm border border-line-border bg-surface-subtle font-mono text-ink-900 focus:outline-none focus:border-brand-teal"
              >
                <option value="USD">USD</option>
                <option value="KES">KES</option>
                <option value="SOS">SOS</option>
              </select>
              <input
                type="number"
                step="0.0001"
                value={fxRate}
                onChange={(e) => setFxRate(parseFloat(e.target.value) || 1)}
                className="h-8 w-20 px-2 font-mono text-ink-900 text-right rounded-sm border border-line-border bg-surface-subtle focus:bg-surface-elevated focus:outline-none focus:border-brand-teal"
              />
            </div>
          </div>

          {/* Issue Date */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider flex items-center gap-1">
              <Calendar className="w-3 h-3 text-brand-teal" />
              Bill Date *
            </label>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="h-8 px-2.5 font-mono text-ink-900 rounded-sm border border-line-border bg-surface-subtle focus:outline-none focus:border-brand-teal"
            />
          </div>

          {/* Due Date */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider flex items-center gap-1">
              <Calendar className="w-3 h-3 text-brand-teal" />
              Due Date *
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-8 px-2.5 font-mono text-ink-900 rounded-sm border border-line-border bg-surface-subtle focus:outline-none focus:border-brand-teal"
            />
          </div>

          {/* Withholding Tax (WHT) Selector */}
          <div className="flex flex-col gap-1 md:col-span-2">
            <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider flex items-center gap-1">
              <Coins className="w-3 h-3 text-brand-teal" />
              Withholding Tax (WHT) Deduction
            </label>
            <select
              value={whtRatePct}
              onChange={(e) => setWhtRatePct(parseInt(e.target.value, 10))}
              className="h-8 px-2.5 rounded-sm border border-line-border bg-surface-subtle text-ink-900 font-medium focus:outline-none focus:border-brand-teal"
            >
              <option value={0}>0% — No Withholding Tax</option>
              <option value={3}>3% — Goods & General Commercial Contracts</option>
              <option value={5}>5% — Professional Services & Consulting</option>
              <option value={10}>10% — Rent & Technical Management Fees</option>
            </select>
          </div>
        </div>

        {/* Lines Grid Table */}
        <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col gap-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-ink-900 uppercase tracking-wider text-[11px]">
              Expense / Asset Lines
            </span>
            <button
              type="button"
              onClick={handleAddLine}
              className="flex items-center gap-1 text-xs text-brand-teal font-semibold hover:text-brand-teal-hover transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Line</span>
            </button>
          </div>

          <div className="border border-line-border rounded-sm overflow-hidden">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="h-8 bg-surface-neutral border-b border-line-border text-[11px] font-semibold text-ink-muted uppercase">
                  <th className="px-2 w-8 text-center">#</th>
                  <th className="px-2 w-48">Expense Account</th>
                  <th className="px-2">Description</th>
                  <th className="px-2 w-20">Branch</th>
                  <th className="px-2 w-20">Cost Ctr</th>
                  <th className="px-2 w-16 text-right">Qty</th>
                  <th className="px-2 w-28 text-right">Unit Price</th>
                  <th className="px-2 w-28 text-right">Total</th>
                  <th className="px-2 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-border">
                {lines.map((line, idx) => (
                  <tr key={line.id} className="h-10 hover:bg-surface-neutral transition">
                    <td className="px-2 text-center font-mono text-ink-muted text-[11px]">
                      {idx + 1}
                    </td>
                    <td className="px-2">
                      <select
                        value={line.account_id}
                        onChange={(e) => handleUpdateLine(line.id, { account_id: e.target.value })}
                        className="w-full h-7 px-1.5 rounded-sm border border-line-border bg-surface-subtle font-mono text-xs focus:outline-none focus:border-brand-teal"
                      >
                        {accounts
                          .filter((a) => a.account_type === 'expense' || a.account_type === 'asset')
                          .map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              {acc.code} - {acc.name}
                            </option>
                          ))}
                      </select>
                    </td>
                    <td className="px-2">
                      <input
                        type="text"
                        value={line.description}
                        onChange={(e) => handleUpdateLine(line.id, { description: e.target.value })}
                        placeholder="Item or service description"
                        className="w-full h-7 px-2 rounded-sm border border-line-border bg-surface-subtle focus:bg-surface-elevated focus:outline-none focus:border-brand-teal"
                      />
                    </td>
                    <td className="px-2">
                      <select
                        value={line.branch}
                        onChange={(e) => handleUpdateLine(line.id, { branch: e.target.value })}
                        className="w-full h-7 px-1.5 rounded-sm border border-line-border bg-surface-subtle font-mono text-[11px]"
                      >
                        <option value="MG">MG (Mogadishu)</option>
                        <option value="HR">HR (Hargeisa)</option>
                        <option value="HQ">HQ</option>
                      </select>
                    </td>
                    <td className="px-2">
                      <select
                        value={line.cost_centre}
                        onChange={(e) => handleUpdateLine(line.id, { cost_centre: e.target.value })}
                        className="w-full h-7 px-1.5 rounded-sm border border-line-border bg-surface-subtle font-mono text-[11px]"
                      >
                        <option value="OPS">OPS</option>
                        <option value="IT">IT</option>
                        <option value="ADMIN">ADMIN</option>
                        <option value="SALES">SALES</option>
                      </select>
                    </td>
                    <td className="px-2">
                      <input
                        type="number"
                        min="1"
                        value={line.quantity}
                        onChange={(e) =>
                          handleUpdateLine(line.id, { quantity: parseInt(e.target.value, 10) || 1 })
                        }
                        className="w-full h-7 px-1 text-right font-mono rounded-sm border border-line-border bg-surface-subtle focus:bg-surface-elevated focus:outline-none"
                      />
                    </td>
                    <td className="px-2">
                      <input
                        type="number"
                        step="0.01"
                        value={(line.unit_price_fc / 100).toFixed(2)}
                        onChange={(e) =>
                          handleUpdateLine(line.id, {
                            unit_price_fc: Math.round((parseFloat(e.target.value) || 0) * 100),
                          })
                        }
                        className="w-full h-7 px-1 text-right font-mono rounded-sm border border-line-border bg-surface-subtle focus:bg-surface-elevated focus:outline-none"
                      />
                    </td>
                    <td className="px-2 text-right font-mono text-num font-semibold text-ink-900">
                      {formatMoney(line.quantity * line.unit_price_fc)}
                    </td>
                    <td className="px-2 text-center">
                      <button
                        type="button"
                        onClick={() => handleRemoveLine(line.id)}
                        className="p-1 rounded text-ink-muted hover:text-danger hover:bg-surface-neutral transition"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Totals & WHT Breakdown Card */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pt-4 border-t border-line-border">
            {/* Plain language consequence preview */}
            <div className="p-3 bg-brand-teal/5 border border-brand-teal/20 rounded-md text-ink-900 max-w-md">
              <span className="font-semibold text-[11px] text-brand-teal uppercase tracking-wide block mb-1">
                Plain-Language Accounting Effect
              </span>
              <p className="text-[11px] text-ink-muted leading-relaxed">
                This bill will debit expense accounts for{' '}
                <strong className="text-num font-mono text-ink-900">{formatMoney(totalFc)}</strong>,
                credit Withholding Tax Payable (2120) for{' '}
                <strong className="text-num font-mono text-ink-900">{formatMoney(whtAmountFc)}</strong>,
                and record an Accounts Payable liability of{' '}
                <strong className="text-num font-mono text-ink-900">{formatMoney(netPayableFc)}</strong>{' '}
                to Dahabshiil.
              </p>
            </div>

            {/* Totals Summary */}
            <div className="flex flex-col gap-1.5 w-72 text-xs">
              <div className="flex justify-between text-ink-muted">
                <span>Gross Expense:</span>
                <span className="font-mono text-num font-medium text-ink-900">
                  {formatMoney(subtotalFc)}
                </span>
              </div>
              {whtRatePct > 0 && (
                <div className="flex justify-between text-danger">
                  <span>Less Withholding Tax ({whtRatePct}%):</span>
                  <span className="font-mono text-num font-semibold">
                    -{formatMoney(whtAmountFc)}
                  </span>
                </div>
              )}
              <div className="pt-2 border-t border-line-border flex justify-between font-bold text-sm text-ink-900">
                <span>Net AP Payable:</span>
                <span className="font-mono text-num text-brand-teal">
                  {formatMoney(netPayableFc)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
