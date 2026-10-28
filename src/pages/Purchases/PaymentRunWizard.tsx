import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { Bill } from '@/types';
import { formatMoney } from '@/lib/format';
import { SignDialog } from '@/components/domain/SignDialog';
import {
  Coins,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Building,
  Calendar,
  CreditCard,
  Download,
  AlertCircle,
  ShieldCheck,
  FileSpreadsheet,
} from 'lucide-react';

export const PaymentRunWizard: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, currentUser, companySettings, bankAccounts, bills, contacts, recordPayment } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [selectedBankId, setSelectedBankId] = useState('bnk-1'); // Premier Bank USD
  const [paymentDate, setPaymentDate] = useState('2026-10-28');
  const [selectedBillIds, setSelectedBillIds] = useState<Set<string>>(new Set(['bil-1']));
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [csvDownloaded, setCsvDownloaded] = useState(false);

  const suppliersMap = useMemo(() => {
    return new Map(contacts.map((c) => [c.id, c]));
  }, [contacts]);

  // Open payable bills
  const payableBills = useMemo(() => {
    return bills.filter((b) => b.status === 'posted' && b.total > b.settled);
  }, [bills]);

  // Selected bills breakdown
  const selectedBills = useMemo(() => {
    return payableBills.filter((b) => selectedBillIds.has(b.id));
  }, [payableBills, selectedBillIds]);

  // Calculation summaries
  const totals = useMemo(() => {
    let gross = 0;
    let wht = 0;
    for (const b of selectedBills) {
      const open = b.total - b.settled;
      const bWht = b.wht_amount_fc || Math.round(open * 0.05);
      gross += open;
      wht += bWht;
    }
    const net = gross - wht;
    return { gross, wht, net };
  }, [selectedBills]);

  const handleToggleSelectAll = () => {
    if (selectedBillIds.size === payableBills.length) {
      setSelectedBillIds(new Set());
    } else {
      setSelectedBillIds(new Set(payableBills.map((b) => b.id)));
    }
  };

  const handleToggleBill = (id: string) => {
    const next = new Set(selectedBillIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedBillIds(next);
  };

  const handleExecutePaymentRun = async (pin: string) => {
    // Post settlements for each selected bill
    for (const bill of selectedBills) {
      const supplier = suppliersMap.get(bill.contact_id);
      const openAmount = bill.total - bill.settled;
      const wht = bill.wht_amount_fc || Math.round(openAmount * 0.05);
      const net = openAmount - wht;

      recordPayment(
        {
          id: `stl-pay-${bill.id}-${Date.now()}`,
          tenant_id: currentCompany.tenant_id,
          company_id: currentCompany.id,
          kind: 'payment',
          number: `PAY-2026-${Math.floor(1000 + Math.random() * 9000)}`,
          status: 'posted',
          contact_id: bill.contact_id,
          bank_account_id: selectedBankId,
          settlement_date: paymentDate,
          currency: bill.currency,
          fx_rate: bill.fx_rate,
          amount_fc: net,
          amount: Math.round(net * bill.fx_rate),
          unallocated_fc: 0,
          allocations: [
            {
              id: `alloc-pay-${bill.id}`,
              invoice_id: bill.id,
              invoice_number: bill.number || '',
              invoice_total_fc: bill.total,
              invoice_open_fc: openAmount,
              allocated_amount_fc: net,
              allocated_amount_base: Math.round(net * bill.fx_rate),
              fx_gain_loss: 0,
            },
          ],
          reference: `WIRE-${bill.number || 'BILL'}`,
          memo: `Supplier payment run disbursement to ${supplier?.name || 'vendor'} (WHT deducted)`,
          created_by: currentUser.id,
          approved_by: currentUser.id,
          signed_by: currentUser.name,
          posted_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        currentUser,
        companySettings
      );
    }

    setSignDialogOpen(false);
    setIsCompleted(true);
    setCurrentStep(3);
  };

  const handleDownloadCsv = () => {
    const headers = 'Supplier,Account,Currency,GrossAmount,WHT,NetDisbursement,Reference,Date\n';
    const rows = selectedBills
      .map((b) => {
        const supplier = suppliersMap.get(b.contact_id);
        const open = b.total - b.settled;
        const wht = b.wht_amount_fc || Math.round(open * 0.05);
        const net = open - wht;
        return `"${supplier?.name || b.contact_id}","${supplier?.tax_id || 'ACC-998'}","${b.currency}",${(open / 100).toFixed(2)},${(wht / 100).toFixed(2)},${(net / 100).toFixed(2)},"PAY-${b.number}","${paymentDate}"`;
      })
      .join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Bank_Payment_Run_${paymentDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setCsvDownloaded(true);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-y-auto bg-canvas">
      <div className="w-full flex flex-col gap-6">
        {/* Wizard Header & Stepper */}
        <div className="flex flex-col gap-4 pb-4 border-b border-border">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate(`/${coSlug}/bills`)}
                className="p-1.5 rounded-sm text-text-muted hover:text-text-primary hover:bg-surface-neutral transition"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
              <div>
                <h1 className="text-xl font-semibold text-text-primary">
                  Supplier Payment Run Wizard
                </h1>
                <p className="text-xs text-text-muted">
                  Batch disburse supplier payables with automated withholding tax (WHT)
                </p>
              </div>
            </div>

            {/* Step Indicators */}
            <div className="flex items-center gap-2 text-xs">
              <span
                className={`px-2.5 py-1 rounded font-semibold transition ${
                  currentStep === 1
                    ? 'bg-brand-teal text-white'
                    : 'bg-surface-neutral text-ink-muted'
                }`}
              >
                1. Select Bills
              </span>
              <span className="text-line-border">→</span>
              <span
                className={`px-2.5 py-1 rounded font-semibold transition ${
                  currentStep === 2
                    ? 'bg-brand-teal text-white'
                    : 'bg-surface-neutral text-ink-muted'
                }`}
              >
                2. WHT & Review
              </span>
              <span className="text-line-border">→</span>
              <span
                className={`px-2.5 py-1 rounded font-semibold transition ${
                  currentStep === 3
                    ? 'bg-brand-teal text-white'
                    : 'bg-surface-neutral text-ink-muted'
                }`}
              >
                3. Complete
              </span>
            </div>
          </div>
        </div>

        {/* STEP 1: Select Bills & Account */}
        {currentStep === 1 && (
          <div className="flex flex-col gap-5 animate-in fade-in duration-150">
            {/* Bank and Date selection */}
            <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider flex items-center gap-1">
                  <CreditCard className="w-3.5 h-3.5 text-brand-teal" />
                  Disbursing Bank Account *
                </label>
                <select
                  value={selectedBankId}
                  onChange={(e) => setSelectedBankId(e.target.value)}
                  className="h-8 px-2.5 rounded-sm border border-line-border bg-surface-subtle font-medium text-ink-900 focus:outline-none focus:border-brand-teal"
                >
                  {bankAccounts.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.bank_name} - {b.name} ({b.currency})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider flex items-center gap-1">
                  <Calendar className="w-3.5 h-3.5 text-brand-teal" />
                  Payment Execution Date *
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className="h-8 px-2.5 font-mono text-ink-900 rounded-sm border border-line-border bg-surface-subtle focus:outline-none focus:border-brand-teal"
                >
                </input>
              </div>
            </div>

            {/* Due Bills Table */}
            <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col gap-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="font-bold text-ink-900 uppercase tracking-wider text-[11px]">
                  Open Due Bills ({payableBills.length})
                </span>
                <button
                  type="button"
                  onClick={handleToggleSelectAll}
                  className="text-xs text-brand-teal hover:underline font-semibold"
                >
                  {selectedBillIds.size === payableBills.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              <div className="border border-line-border rounded-sm overflow-hidden">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="h-8 bg-surface-neutral border-b border-line-border text-[11px] font-semibold text-ink-muted uppercase">
                      <th className="px-3 w-8 text-center">
                        <input
                          type="checkbox"
                          checked={
                            payableBills.length > 0 && selectedBillIds.size === payableBills.length
                          }
                          onChange={handleToggleSelectAll}
                          className="rounded border-line-border"
                        />
                      </th>
                      <th className="px-3">Bill Number</th>
                      <th className="px-3">Supplier</th>
                      <th className="px-3">Due Date</th>
                      <th className="px-3 text-right">Total Amount</th>
                      <th className="px-3 text-right">Open Payable</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-border">
                    {payableBills.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-ink-muted">
                          No open due bills available for payment.
                        </td>
                      </tr>
                    ) : (
                      payableBills.map((b) => {
                        const isChecked = selectedBillIds.has(b.id);
                        const supplier = suppliersMap.get(b.contact_id);
                        const open = b.total - b.settled;

                        return (
                          <tr
                            key={b.id}
                            onClick={() => handleToggleBill(b.id)}
                            className={`h-9 cursor-pointer transition select-none ${
                              isChecked ? 'bg-brand-teal/10 font-medium' : 'hover:bg-surface-neutral'
                            }`}
                          >
                            <td className="px-3 text-center">
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => handleToggleBill(b.id)}
                                onClick={(e) => e.stopPropagation()}
                                className="rounded border-line-border"
                              />
                            </td>
                            <td className="px-3 font-mono text-ink-900">{b.number || 'DRAFT'}</td>
                            <td className="px-3 text-ink-900">{supplier?.name || b.contact_id}</td>
                            <td className="px-3 font-mono text-[11px] text-ink-muted">{b.due_date}</td>
                            <td className="px-3 text-right font-mono text-num text-ink-muted">
                              {formatMoney(b.total)}
                            </td>
                            <td className="px-3 text-right font-mono text-num font-semibold text-danger">
                              {formatMoney(open)}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Bottom Nav */}
              <div className="flex items-center justify-between pt-3 border-t border-line-border">
                <span className="text-[11px] text-ink-muted">
                  {selectedBillIds.size} bills selected ({formatMoney(totals.gross)})
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentStep(2)}
                  disabled={selectedBillIds.size === 0}
                  className="h-8 px-4 bg-brand-teal hover:bg-brand-teal-hover text-white rounded-sm font-semibold text-xs shadow-2xs transition flex items-center gap-1.5 disabled:opacity-50"
                >
                  <span>Continue to WHT Review</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: WHT Review & Sign */}
        {currentStep === 2 && (
          <div className="flex flex-col gap-5 animate-in fade-in duration-150">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
              <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col justify-between">
                <span className="text-ink-muted uppercase font-semibold text-[11px]">
                  Gross Bills Selected
                </span>
                <span className="text-xl font-bold font-mono text-num text-ink-900">
                  {formatMoney(totals.gross)}
                </span>
                <span className="text-[11px] text-ink-muted">{selectedBills.length} invoices to clear</span>
              </div>

              <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col justify-between">
                <span className="text-danger uppercase font-semibold text-[11px] flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  WHT Tax Withheld (Payable)
                </span>
                <span className="text-xl font-bold font-mono text-num text-danger">
                  -{formatMoney(totals.wht)}
                </span>
                <span className="text-[11px] text-ink-muted">WHT Certs will be generated</span>
              </div>

              <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col justify-between bg-brand-teal/5 border-brand-teal/30">
                <span className="text-brand-teal uppercase font-bold text-[11px]">
                  Net Bank Disbursement
                </span>
                <span className="text-xl font-bold font-mono text-num text-brand-teal">
                  {formatMoney(totals.net)}
                </span>
                <span className="text-[11px] text-ink-muted">Wire via Premier Bank USD</span>
              </div>
            </div>

            {/* Detailed Disbursement Breakdown */}
            <div className="p-4 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col gap-3 text-xs">
              <span className="font-bold text-ink-900 uppercase tracking-wider text-[11px]">
                Disbursement & Withholding Breakdown per Vendor
              </span>

              <div className="border border-line-border rounded-sm overflow-hidden">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="h-8 bg-surface-neutral border-b border-line-border text-[11px] font-semibold text-ink-muted uppercase">
                      <th className="px-3">Supplier Name</th>
                      <th className="px-3">Bill Ref</th>
                      <th className="px-3 text-right">Gross Amount</th>
                      <th className="px-3 text-right">WHT (5%)</th>
                      <th className="px-3 text-right">Net Wire Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line-border">
                    {selectedBills.map((b) => {
                      const supplier = suppliersMap.get(b.contact_id);
                      const open = b.total - b.settled;
                      const wht = b.wht_amount_fc || Math.round(open * 0.05);
                      const net = open - wht;

                      return (
                        <tr key={b.id} className="h-9 hover:bg-surface-neutral transition">
                          <td className="px-3 font-medium text-ink-900">
                            {supplier?.name || b.contact_id}
                          </td>
                          <td className="px-3 font-mono text-[11px] text-ink-muted">
                            {b.number}
                          </td>
                          <td className="px-3 text-right font-mono text-num text-ink-900">
                            {formatMoney(open)}
                          </td>
                          <td className="px-3 text-right font-mono text-num text-danger font-medium">
                            -{formatMoney(wht)}
                          </td>
                          <td className="px-3 text-right font-mono text-num font-semibold text-brand-teal">
                            {formatMoney(net)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Navigation & Sign Dialog trigger */}
              <div className="flex items-center justify-between pt-3 border-t border-line-border">
                <button
                  type="button"
                  onClick={() => setCurrentStep(1)}
                  className="h-8 px-3 rounded-sm border border-line-border bg-surface-elevated hover:bg-surface-neutral text-ink-900 text-xs font-medium transition flex items-center gap-1.5"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back to Selection</span>
                </button>

                <button
                  type="button"
                  onClick={() => setSignDialogOpen(true)}
                  className="h-8 px-5 bg-brand-teal hover:bg-brand-teal-hover text-white rounded-sm font-semibold text-xs shadow-2xs transition flex items-center gap-1.5"
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>Sign with PIN & Post Payment Run</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Completed */}
        {currentStep === 3 && (
          <div className="p-8 bg-surface-elevated border border-line-border rounded-md shadow-2xs flex flex-col items-center text-center gap-4 animate-in zoom-in-95 duration-150">
            <div className="w-12 h-12 rounded-full bg-success/10 text-success flex items-center justify-center">
              <CheckCircle2 className="w-7 h-7" />
            </div>

            <div className="flex flex-col gap-1">
              <h2 className="text-base font-bold text-ink-900">Payment Run Executed Successfully</h2>
              <p className="text-xs text-ink-muted max-w-md">
                All selected supplier bills have been marked as paid. AP Control (2000) was credited and Withholding Tax certificates were generated.
              </p>
            </div>

            <div className="p-4 bg-surface-neutral border border-line-border rounded-md w-full max-w-md flex flex-col gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-ink-muted">Settlements Posted:</span>
                <span className="font-semibold text-ink-900 font-mono">{selectedBills.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">Total Disbursed:</span>
                <span className="font-bold text-brand-teal font-mono">{formatMoney(totals.net)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-muted">WHT Tax Certificates Issued:</span>
                <span className="font-semibold text-ink-900 font-mono">{selectedBills.length} Certificates</span>
              </div>
            </div>

            <div className="flex items-center gap-3 mt-2">
              <button
                type="button"
                onClick={handleDownloadCsv}
                className="h-9 px-4 rounded-sm bg-brand-teal hover:bg-brand-teal-hover text-white text-xs font-semibold shadow-2xs transition flex items-center gap-2"
              >
                <Download className="w-4 h-4" />
                <span>{csvDownloaded ? 'Download Again (Bank CSV)' : 'Download Bank Wire CSV'}</span>
              </button>

              <button
                type="button"
                onClick={() => navigate(`/${coSlug}/wht-certificates`)}
                className="h-9 px-4 rounded-sm border border-line-border bg-surface-subtle hover:bg-surface-neutral text-ink-900 text-xs font-medium transition flex items-center gap-2"
              >
                <ShieldCheck className="w-4 h-4 text-brand-teal" />
                <span>View WHT Certificates</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 6-Digit PIN SignDialog */}
      <SignDialog
        isOpen={signDialogOpen}
        onClose={() => setSignDialogOpen(false)}
        onConfirm={handleExecutePaymentRun}
        documentTitle="Supplier Payment Run"
        documentNumber="PR-2026-OCT-01"
        periodName={currentCompany.base_currency}
        amount={totals.net}
        consequenceText={`This will disburse ${formatMoney(totals.net)} from ${
          bankAccounts.find((b) => b.id === selectedBankId)?.bank_name || 'Bank'
        }, settle ${selectedBills.length} supplier bills, and record ${formatMoney(totals.wht)} in Withholding Tax payable.`}
      />
    </div>
  );
};
