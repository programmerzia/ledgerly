import React, { useMemo, useState } from 'react';
import { useLedgerStore } from '@/mock/store';
import { BUSINESS_TODAY } from '@/lib/docStatus';
import { formatMoney } from '@/lib/format';
import { ReportShell, defaultReportParameters, useSelectedPeriod, type ReportParameters } from './ReportShell';
import { KpiCard, ReportCard, moneyFmt } from './ReportParts';
import type { Invoice } from '@/types';

const GRID = 'grid grid-cols-[minmax(10rem,1fr)_5rem_repeat(4,7.5rem)] gap-3';

interface CodeRow {
  id: string;
  name: string;
  rate: number;
  salesNet: number;
  outputVat: number;
  purchasesNet: number;
  inputVat: number;
}

export const TaxReturn: React.FC = () => {
  const { currentCompany, accounts, balanceOf, taxCodes, invoices, bills, periods, journals } = useLedgerStore();
  const cur = currentCompany.base_currency;
  const money = moneyFmt(cur);
  const [parameters, setParameters] = useState<ReportParameters>(defaultReportParameters());
  const period = useSelectedPeriod(parameters.periodTo);

  const idOf = (code: string) => accounts.find((a) => a.code === code)?.id ?? '';
  const prev = period ? periods.find((p) => p.kind !== 'adjustment' && p.number === period.number - 1) : undefined;
  const startDate = prev?.ends_on ?? '0000-00-00';
  const inPeriod = (d: Invoice) =>
    d.status === 'posted' && !!period && d.issue_date > startDate && d.issue_date <= period.ends_on;

  const whtOwed = balanceOf(idOf('2120'));

  // The return is driven by the ledger: VAT charged = credits to VAT output, VAT paid = debits to
  // VAT input, in the period. Payments to / refunds from the tax authority sit on the opposite
  // sides of those accounts, so they are excluded without special-casing.
  const sideTotal = (code: string, side: 'debit' | 'credit') => {
    if (!period) return 0;
    const id = idOf(code);
    return journals
      .filter((j) => (j.status === 'posted' || j.status === 'reversed') && j.journal_date > startDate && j.journal_date <= period.ends_on)
      .flatMap((j) => j.lines)
      .filter((l) => l.account_id === id)
      .reduce((t, l) => t + (side === 'credit' ? l.credit : l.debit), 0);
  };
  const ledgerOutput = sideTotal('2100', 'credit');
  const ledgerInput = sideTotal('2110', 'debit');

  const rows = useMemo<CodeRow[]>(() => {
    const map = new Map<string, CodeRow>();
    const row = (id: string): CodeRow => {
      let r = map.get(id);
      if (!r) {
        const tc = taxCodes.find((t) => t.id === id);
        r = { id, name: tc?.name ?? 'No tax code', rate: tc?.rate ?? 0, salesNet: 0, outputVat: 0, purchasesNet: 0, inputVat: 0 };
        map.set(id, r);
      }
      return r;
    };
    const add = (docs: Invoice[], side: 'sales' | 'purchases') => {
      for (const d of docs.filter(inPeriod)) {
        const sign = d.kind === 'credit_note' || d.kind === 'debit_note' ? -1 : 1;
        for (const l of d.lines) {
          const r = row(l.tax_code_id ?? 'none');
          const net = Math.round(l.line_total_fc * d.fx_rate) * sign;
          const vat = Math.round(l.tax_amount_fc * d.fx_rate) * sign;
          if (side === 'sales') {
            r.salesNet += net;
            r.outputVat += vat;
          } else {
            r.purchasesNet += net;
            r.inputVat += vat;
          }
        }
      }
    };
    add(invoices, 'sales');
    add(bills, 'purchases');
    return [...map.values()].filter((r) => taxCodes.find((t) => t.id === r.id)?.kind !== 'wht').sort((a, b) => b.rate - a.rate);
  }, [invoices, bills, taxCodes, period?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sum = (k: keyof CodeRow) => rows.reduce((s, r) => s + (r[k] as number), 0);
  const outputVat = ledgerOutput;
  const inputVat = ledgerInput;
  // VAT recorded in journals without a sales/purchase document (e.g. cash and card sales summaries).
  const otherOutput = ledgerOutput - sum('outputVat');
  const otherInput = ledgerInput - sum('inputVat');
  const netPayable = outputVat - inputVat;
  const refund = netPayable < 0;

  return (
    <ReportShell
      title="VAT return"
      parameters={parameters}
      onParametersChange={setParameters}
      showHideEmpty={false}
      subtitle={`${period?.name ?? ''} · Standard rate ${(taxCodes.find((t) => t.id === 'tax-vat5')?.rate ?? 0) * 100}%`}
    >
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard label="VAT you charged customers" value={money(outputVat)} hint="Output VAT, owed to the tax authority" />
        <KpiCard label="VAT you paid suppliers" value={money(inputVat)} hint="Input VAT, you can reclaim this" />
        <KpiCard
          label={refund ? 'VAT refund due to you' : 'VAT to pay'}
          value={money(Math.abs(netPayable))}
          hint={refund ? 'You paid more VAT than you charged' : 'Charged minus paid'}
        />
      </div>

      <ReportCard className="p-0 sm:p-0">
        <div className="min-w-[760px]">
          <div className="px-4 pt-4 pb-2 text-sm font-semibold text-text-primary">Breakdown by tax code</div>
          <div className={`${GRID} px-4 py-2.5 border-y border-border text-[11px] font-semibold text-text-muted`}>
            <span>Tax code</span>
            <span className="text-right">Rate</span>
            <span className="text-right">Sales (before VAT)</span>
            <span className="text-right">VAT charged</span>
            <span className="text-right">Purchases (before VAT)</span>
            <span className="text-right">VAT paid</span>
          </div>
          {rows.length === 0 && <div className="p-8 text-center text-xs text-text-muted">No taxable sales or purchases in this period.</div>}
          <div className="divide-y divide-border/60">
            {rows.map((r) => (
              <div key={r.id} className={`${GRID} items-baseline px-4 py-2 text-xs`}>
                <span className="text-text-primary">{r.name}</span>
                <span className="text-right tabular-nums text-text-secondary">{(r.rate * 100).toFixed(0)}%</span>
                <span className="text-right tabular-nums">{money(r.salesNet)}</span>
                <span className="text-right tabular-nums">{money(r.outputVat)}</span>
                <span className="text-right tabular-nums">{money(r.purchasesNet)}</span>
                <span className="text-right tabular-nums">{money(r.inputVat)}</span>
              </div>
            ))}
          </div>
          {(otherOutput !== 0 || otherInput !== 0) && (
            <div className={`${GRID} items-baseline px-4 py-2 text-xs border-t border-border/60`}>
              <span className="text-text-primary">Recorded without an invoice or bill</span>
              <span />
              <span />
              <span className="text-right tabular-nums">{money(otherOutput)}</span>
              <span />
              <span className="text-right tabular-nums">{money(otherInput)}</span>
            </div>
          )}
          <div className={`${GRID} items-baseline px-4 py-3 border-t border-text-primary border-b-[3px] border-double text-[13px] font-semibold`}>
            <span className="text-text-primary">Total</span>
            <span />
            <span className="text-right tabular-nums">{money(sum('salesNet'))}</span>
            <span className="text-right tabular-nums">{money(outputVat)}</span>
            <span className="text-right tabular-nums">{money(sum('purchasesNet'))}</span>
            <span className="text-right tabular-nums">{money(inputVat)}</span>
          </div>
        </div>
      </ReportCard>

      <div className="text-xs text-text-muted px-1">
        Withholding tax held from supplier payments, still to be paid over: <span className="tabular-nums font-medium text-text-primary">{money(whtOwed)}</span>. It is filed separately.
      </div>
    </ReportShell>
  );
};
