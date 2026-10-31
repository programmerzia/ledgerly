import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { Bill, BillLine } from '@/types';
import { formatMoney } from '@/lib/format';
import { AccountPicker } from '@/components/domain/AccountPicker';
import { FieldHelp } from '@/components/domain/FieldHelp';
import { ConsequenceDialog, ConsequenceAccountingLine } from '@/components/domain/ConsequenceDialog';
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
import { toast } from 'sonner';
import { PageHeader } from '@/components/domain/PageHeader';

export const BillForm: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, currentUser, contacts, accounts, taxCodes, saveBillDraft, submitBillForApproval } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const suppliers = contacts.filter((c) => c.kind === 'supplier');

  const [contactId, setContactId] = useState(suppliers[0]?.id || 'cnt-3'); // Dahabshiil
  const [reference, setReference] = useState('DAH-INV-2026-884');
  const [issueDate, setIssueDate] = useState('2026-10-28');
  const [dueDate, setDueDate] = useState('2026-11-27');
  const [currency, setCurrency] = useState('USD');
  const [fxRate, setFxRate] = useState(1.0);
  const [memo, setMemo] = useState('Monthly telecom network connectivity & trunk lines');
  const [whtRatePct, setWhtRatePct] = useState<number>(5); // 5% standard withholding tax
  const [errorMsg, setErrorMsg] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConsequence, setShowConsequence] = useState(false);

  // Autosave timer
  const [lastSavedSeconds, setLastSavedSeconds] = useState(3);
  useEffect(() => {
    const timer = setInterval(() => {
      setLastSavedSeconds((prev) => (prev < 60 ? prev + 1 : 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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

  const selectedSupplier = suppliers.find((s) => s.id === contactId);

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

  const accountingPreviewLines: ConsequenceAccountingLine[] = [
    {
      accountCode: '6200',
      accountName: 'Telecom & Trunk Bandwidth',
      debit: 350000,
      credit: 0,
    },
    {
      accountCode: '6300',
      accountName: 'Tech Services & Maintenance',
      debit: 100000,
      credit: 0,
    },
    ...(whtAmountFc > 0
      ? [
          {
            accountCode: '2120',
            accountName: 'Withholding Tax Payable',
            debit: 0,
            credit: whtAmountFc,
          },
        ]
      : []),
    {
      accountCode: '2000',
      accountName: 'Accounts Payable',
      debit: 0,
      credit: netPayableFc,
    },
  ];

  const handleSaveDraft = async () => {
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
        status: 'draft',
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
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      saveBillDraft(newBill, currentUser);
      toast.success('Supplier bill draft saved', {
        action: {
          label: 'Undo',
          onClick: () => toast.info('Draft action restored'),
        },
      });
      navigate(`/${coSlug}/bills`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to save bill');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmSubmit = async () => {
    try {
      setErrorMsg('');
      setIsSubmitting(true);
      setShowConsequence(false);

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
        status: 'pending_approval',
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
        submitted_by: currentUser.id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const saved = saveBillDraft(newBill, currentUser);
      submitBillForApproval(saved.id, currentUser);
      toast.success('Bill submitted for dual approval');
      navigate(`/${coSlug}/bills`);
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to submit bill');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-surface-canvas p-6">
      <div className="w-full flex flex-col gap-6">
        <PageHeader
          breadcrumb={[{ label: 'Bills', to: `/${coSlug}/bills` }, { label: 'New bill' }]}
          title="Record a bill"
          subtitle={<>Enter what a supplier charged you. <span className="text-accent font-medium">Saved {lastSavedSeconds} s ago</span></>}
          icon={<FileText />}
          actions={
            <>
              <button
                type="button"
                onClick={handleSaveDraft}
                disabled={isSubmitting}
                className="h-9 px-3 rounded-lg border border-border bg-surface hover:bg-surface-neutral text-text-primary text-[13px] font-medium transition flex items-center gap-1.5"
              >
                <Save className="size-4 text-text-muted" />
                <span>Save draft</span>
              </button>
              <button
                type="button"
                onClick={() => setShowConsequence(true)}
                disabled={isSubmitting}
                className="h-9 px-4 rounded-lg bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold shadow-xs transition flex items-center gap-1.5"
              >
                <Send className="size-4" />
                <span>Submit for approval</span>
              </button>
            </>
          }
        />

        {errorMsg && (
          <div className="p-3 bg-danger-soft/20 border border-danger/30 rounded-md text-danger text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {/* Header Fields Form */}
        <div className="p-4 bg-surface border border-border rounded-xl shadow-card grid grid-cols-1 md:grid-cols-4 gap-4 text-xs">
          {/* Supplier */}
          <div className="flex flex-col gap-1 md:col-span-2">
            <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center">
              <Building className="w-3 h-3 text-accent mr-1" />
              Supplier Contact *
              <FieldHelp
                help="Registered vendor entity. Defines AP liability account and default payment terms."
                example="SUP-001 Dahabshiil"
              />
            </label>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              className="h-8 px-2.5 rounded-lg border border-border bg-surface font-medium text-text-primary focus:outline-none focus:border-accent"
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
            <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center">
              Supplier Invoice Ref *
              <FieldHelp
                help="Invoice reference printed on supplier's original bill document."
                example="DAH-INV-2026-884"
              />
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. DAH-8849"
              className="h-8 px-2.5 font-mono text-text-primary rounded-lg border border-border bg-surface focus:outline-none focus:border-accent"
            />
          </div>

          {/* Currency */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center">
              Currency & FX
              <FieldHelp
                help="Transaction currency and exchange rate to company functional currency (USD)."
                example="USD @ 1.0000"
              />
            </label>
            <div className="flex items-center gap-1.5">
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="h-8 px-2 rounded-lg border border-border bg-surface font-mono text-text-primary focus:outline-none focus:border-accent"
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
                className="h-8 w-20 px-2 font-mono text-text-primary text-right rounded-lg border border-border bg-surface focus:outline-none focus:border-accent"
              />
            </div>
          </div>

          {/* Issue Date */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center">
              <Calendar className="w-3 h-3 text-accent mr-1" />
              Bill Date *
              <FieldHelp
                help="The commercial date indicated on the vendor invoice for period attribution."
                example="2026-10-28"
              />
            </label>
            <input
              type="date"
              value={issueDate}
              onChange={(e) => setIssueDate(e.target.value)}
              className="h-8 px-2.5 font-mono text-text-primary rounded-lg border border-border bg-surface focus:outline-none focus:border-accent"
            />
          </div>

          {/* Due Date */}
          <div className="flex flex-col gap-1">
            <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center">
              <Calendar className="w-3 h-3 text-accent mr-1" />
              Due Date *
              <FieldHelp
                help="Payable due date based on vendor credit terms."
                example="2026-11-27"
              />
            </label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-8 px-2.5 font-mono text-text-primary rounded-lg border border-border bg-surface focus:outline-none focus:border-accent"
            />
          </div>

          {/* Withholding Tax (WHT) Selector */}
          <div className="flex flex-col gap-1 md:col-span-2">
            <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider flex items-center">
              <Coins className="w-3 h-3 text-accent mr-1" />
              Withholding Tax (WHT) Deduction
              <FieldHelp
                help="Statutory withholding tax percentage withheld from payment and remitted to tax authority."
                example="5% Professional Services"
              />
            </label>
            <select
              value={whtRatePct}
              onChange={(e) => setWhtRatePct(parseInt(e.target.value, 10))}
              className="h-8 px-2.5 rounded-lg border border-border bg-surface text-text-primary font-medium focus:outline-none focus:border-accent"
            >
              <option value={0}>0% — No Withholding Tax</option>
              <option value={3}>3% — Goods & General Commercial Contracts</option>
              <option value={5}>5% — Professional Services & Consulting</option>
              <option value={10}>10% — Rent & Technical Management Fees</option>
            </select>
          </div>
        </div>

        {/* Lines Grid Table */}
        <div className="p-4 bg-surface border border-border rounded-xl shadow-card flex flex-col gap-3 text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-text-primary uppercase tracking-wider text-[11px]">
              Expense / Asset Lines
            </span>
            <button
              type="button"
              onClick={handleAddLine}
              className="flex items-center gap-1 text-xs text-accent font-semibold hover:text-accent-hover transition"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Line</span>
            </button>
          </div>

          <div className="border border-border rounded-lg overflow-hidden">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="h-8 bg-surface-neutral border-b border-border text-[11px] font-semibold text-text-muted uppercase">
                  <th className="px-2 w-8 text-center">#</th>
                  <th className="px-2 w-48">
                    <span className="inline-flex items-center">
                      Expense Account
                      <FieldHelp help="P&L expense or balance sheet asset account." example="6200 Utilities" />
                    </span>
                  </th>
                  <th className="px-2">
                    <span className="inline-flex items-center">
                      Description
                      <FieldHelp help="Narrative detailing items or services billed." />
                    </span>
                  </th>
                  <th className="px-2 w-20">
                    <span className="inline-flex items-center">
                      Branch
                      <FieldHelp help="Operating branch (MG = Mogadishu, HR = Hargeisa)." example="MG" />
                    </span>
                  </th>
                  <th className="px-2 w-24">
                    <span className="inline-flex items-center">
                      Cost Centre
                      <FieldHelp help="Department or operational division." example="OPS" />
                    </span>
                  </th>
                  <th className="px-2 w-16 text-right">Qty</th>
                  <th className="px-2 w-28 text-right">Unit Price</th>
                  <th className="px-2 w-28 text-right">Amount</th>
                  <th className="px-2 w-10 text-center"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((line, idx) => (
                  <tr key={line.id} className="h-9 hover:bg-surface-neutral/50 transition">
                    <td className="px-2 text-center text-text-muted font-mono text-[11px]">
                      {idx + 1}
                    </td>
                    <td className="px-2">
                      <AccountPicker
                        accounts={accounts.filter((a) => a.account_type === 'expense' || a.account_type === 'asset')}
                        value={line.account_id}
                        onChange={(accId) => handleUpdateLine(line.id, { account_id: accId })}
                      />
                    </td>
                    <td className="px-2">
                      <input
                        type="text"
                        value={line.description}
                        onChange={(e) => handleUpdateLine(line.id, { description: e.target.value })}
                        placeholder="Description..."
                        className="w-full h-7 px-2 text-xs rounded border border-transparent hover:border-border focus:border-accent bg-transparent text-text-primary focus:bg-surface focus:outline-none"
                      />
                    </td>
                    <td className="px-2">
                      <select
                        value={line.branch}
                        onChange={(e) => handleUpdateLine(line.id, { branch: e.target.value })}
                        className="h-7 px-1.5 text-xs font-mono rounded border border-border bg-surface text-text-primary focus:outline-none"
                      >
                        <option value="MG">MG</option>
                        <option value="HR">HR</option>
                        <option value="BS">BS</option>
                      </select>
                    </td>
                    <td className="px-2">
                      <select
                        value={line.cost_centre}
                        onChange={(e) => handleUpdateLine(line.id, { cost_centre: e.target.value })}
                        className="h-7 px-1.5 text-xs font-mono rounded border border-border bg-surface text-text-primary focus:outline-none"
                      >
                        <option value="OPS">OPS</option>
                        <option value="ADMIN">ADMIN</option>
                        <option value="SALES">SALES</option>
                      </select>
                    </td>
                    <td className="px-2 text-right">
                      <input
                        type="number"
                        min="1"
                        value={line.quantity}
                        onChange={(e) =>
                          handleUpdateLine(line.id, {
                            quantity: Math.max(1, parseInt(e.target.value, 10) || 1),
                          })
                        }
                        className="w-14 h-7 px-1.5 text-right font-mono text-xs rounded border border-transparent hover:border-border focus:border-accent bg-transparent text-text-primary focus:bg-surface focus:outline-none"
                      />
                    </td>
                    <td className="px-2 text-right">
                      <input
                        type="number"
                        step="0.01"
                        value={(line.unit_price_fc / 100).toFixed(2)}
                        onChange={(e) =>
                          handleUpdateLine(line.id, {
                            unit_price_fc: Math.round((parseFloat(e.target.value) || 0) * 100),
                          })
                        }
                        className="w-24 h-7 px-1.5 text-right font-mono text-xs rounded border border-transparent hover:border-border focus:border-accent bg-transparent text-text-primary focus:bg-surface focus:outline-none"
                      />
                    </td>
                    <td className="px-2 text-right font-mono font-medium text-text-primary text-num">
                      {formatMoney(line.quantity * line.unit_price_fc)}
                    </td>
                    <td className="px-2 text-center">
                      <button
                        type="button"
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

          {/* Totals & WHT Breakdown Card */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pt-4 border-t border-border">
            {/* Plain language consequence preview */}
            <div className="p-3 bg-accent-soft/40 border border-accent/20 rounded-md text-text-primary max-w-md">
              <span className="font-semibold text-[11px] text-accent uppercase tracking-wide block mb-1">
                Plain-Language Accounting Effect
              </span>
              <p className="text-[11px] text-text-secondary leading-relaxed">
                This bill will debit expense accounts for{' '}
                <strong className="text-num font-mono text-text-primary">{formatMoney(totalFc)}</strong>,
                credit Withholding Tax Payable (2120) for{' '}
                <strong className="text-num font-mono text-text-primary">{formatMoney(whtAmountFc)}</strong>,
                and record an Accounts Payable liability of{' '}
                <strong className="text-num font-mono text-text-primary">{formatMoney(netPayableFc)}</strong>{' '}
                to {selectedSupplier?.name || 'Dahabshiil'}.
              </p>
            </div>

            {/* Totals Summary */}
            <div className="flex flex-col gap-1.5 w-72 text-xs">
              <div className="flex justify-between text-text-muted">
                <span>Gross Expense:</span>
                <span className="font-mono text-num font-medium text-text-primary">
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
              <div className="pt-2 border-t border-border flex justify-between font-bold text-sm text-text-primary">
                <span>Net AP Payable:</span>
                <span className="font-mono text-num text-accent">
                  {formatMoney(netPayableFc)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Consequence Modal */}
      <ConsequenceDialog
        isOpen={showConsequence}
        onClose={() => setShowConsequence(false)}
        onConfirm={handleConfirmSubmit}
        title="Submit Supplier Bill for Approval"
        actionType="submit"
        plainLanguageEffect={`This will send to Kenneth for approval. When approved it posts 3 lines to Oct 2026, debits expenses for ${formatMoney(totalFc)}, credits Withholding Tax Payable for ${formatMoney(whtAmountFc)}, and records an Accounts Payable liability of ${formatMoney(netPayableFc)} to ${selectedSupplier?.name || 'Dahabshiil'}.`}
        accountingLines={accountingPreviewLines}
        confirmLabel="Confirm & Submit"
        isSubmitting={isSubmitting}
      />
    </div>
  );
};
