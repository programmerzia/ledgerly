import React, { useState, useMemo } from 'react';
import { useLedgerStore } from '@/mock/store';
import { ReportShell, ReportParameters } from './ReportShell';
import { formatMoney } from '@/lib/format';
import { FileSpreadsheet, ShieldCheck, Printer, Download } from 'lucide-react';

export const TaxReturn: React.FC = () => {
  const { currentCompany, balanceOf, accounts } = useLedgerStore();

  const [parameters, setParameters] = useState<ReportParameters>({
    periodFrom: 'per-2026-10',
    periodTo: 'per-2026-10',
    comparison: 'none',
    pivotDimension: 'none',
    hideZeroRows: false,
    presentationCurrency: 'USD',
    levelOfDetail: 'summary',
  });

  // Calculate Output Tax (2100) and Input Tax (2110) and WHT Payable (2120)
  const outputTax = balanceOf('acc-2100'); // normal credit
  const inputTax = balanceOf('acc-2110'); // normal debit
  const whtPayable = balanceOf('acc-2120');

  // Sales revenue
  const standardSales = balanceOf('acc-4000') + balanceOf('acc-4100');
  const netVatPayable = outputTax - inputTax;

  return (
    <ReportShell
      title="Value Added Tax (VAT) Return Form"
      subtitle={`${currentCompany.legal_name} • Tax Period: October 2026`}
      asOfMode={true}
      parameters={parameters}
      onParametersChange={setParameters}
    >
      <div className="w-full flex flex-col gap-6">
        {/* Tax Return Form Card */}
        <div className="bg-surface-elevated border border-line-border rounded-lg p-6 shadow-2xs flex flex-col gap-6 text-xs">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-line-border">
            <div>
              <h2 className="text-sm font-bold text-ink-900">{currentCompany.legal_name}</h2>
              <div className="text-[11px] text-ink-muted">TIN: {currentCompany.tax_id} • Standard VAT Rate: 15%</div>
            </div>
            <div className="text-right">
              <span className="text-[10px] font-mono uppercase bg-surface-neutral px-2 py-0.5 rounded font-semibold text-ink-muted">
                Form VAT-100 (Monthly)
              </span>
            </div>
          </div>

          {/* Section A: Output Tax (Sales) */}
          <div className="flex flex-col gap-2">
            <span className="font-bold text-ink-900 uppercase tracking-wider text-[11px] border-b border-line-border pb-1">
              Part 1: Output Tax on Supplies (Sales)
            </span>
            <div className="divide-y divide-line-border/60">
              <div className="py-2 flex items-center justify-between">
                <span className="text-ink-900">
                  <strong className="font-mono text-brand-teal mr-2">Box 1</strong>
                  Standard Rated Supplies (Exclusive of Tax)
                </span>
                <span className="font-mono text-num font-medium text-ink-900">
                  {formatMoney(standardSales)}
                </span>
              </div>
              <div className="py-2 flex items-center justify-between">
                <span className="text-ink-900">
                  <strong className="font-mono text-brand-teal mr-2">Box 2</strong>
                  Zero-Rated and Exempt Supplies
                </span>
                <span className="font-mono text-num text-ink-muted">$0.00</span>
              </div>
              <div className="py-2 flex items-center justify-between font-bold bg-surface-neutral px-2 rounded-sm">
                <span className="text-ink-900">
                  <strong className="font-mono text-brand-teal mr-2">Box 4</strong>
                  Total Output Tax Payable (Account 2100)
                </span>
                <span className="font-mono text-num text-danger">{formatMoney(outputTax)}</span>
              </div>
            </div>
          </div>

          {/* Section B: Input Tax (Purchases) */}
          <div className="flex flex-col gap-2">
            <span className="font-bold text-ink-900 uppercase tracking-wider text-[11px] border-b border-line-border pb-1">
              Part 2: Input Tax on Acquisitions (Purchases & Expenses)
            </span>
            <div className="divide-y divide-line-border/60">
              <div className="py-2 flex items-center justify-between">
                <span className="text-ink-900">
                  <strong className="font-mono text-brand-teal mr-2">Box 5</strong>
                  Total Taxable Business Purchases & Imports
                </span>
                <span className="font-mono text-num font-medium text-ink-900">
                  {formatMoney(balanceOf('acc-5000') + balanceOf('acc-6200'))}
                </span>
              </div>
              <div className="py-2 flex items-center justify-between font-bold bg-surface-neutral px-2 rounded-sm">
                <span className="text-ink-900">
                  <strong className="font-mono text-brand-teal mr-2">Box 6</strong>
                  Total Input Tax Recoverable (Account 2110)
                </span>
                <span className="font-mono text-num text-success">{formatMoney(inputTax)}</span>
              </div>
            </div>
          </div>

          {/* Section C: Net Tax Calculation */}
          <div className="p-4 bg-brand-teal/5 border border-brand-teal/20 rounded-md flex items-center justify-between text-xs font-bold">
            <div>
              <span className="font-mono text-brand-teal text-sm mr-2">Box 7</span>
              <span className="text-ink-900 uppercase">
                {netVatPayable >= 0 ? 'Net VAT Payable to Revenue Authority:' : 'Net VAT Refund Due from Revenue Authority:'}
              </span>
            </div>
            <span className="font-mono text-base text-num text-brand-teal">
              {formatMoney(Math.abs(netVatPayable))}
            </span>
          </div>

          {/* Section D: Withholding Tax Summary */}
          <div className="flex flex-col gap-1.5 p-3 bg-surface-neutral rounded border border-line-border">
            <div className="flex justify-between font-medium">
              <span className="text-ink-muted">Withholding Tax (WHT) Deducted on Supplier Payments (Acc 2120):</span>
              <span className="font-mono text-num font-semibold text-danger">{formatMoney(whtPayable)}</span>
            </div>
            <div className="text-[10px] text-ink-muted">
              Remitted separately with monthly Withholding Tax schedule.
            </div>
          </div>
        </div>
      </div>
    </ReportShell>
  );
};
