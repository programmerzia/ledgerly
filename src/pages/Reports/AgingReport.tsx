import React, { useState, useMemo } from 'react';
import { useLedgerStore } from '@/mock/store';
import { ReportShell, ReportParameters } from './ReportShell';
import { formatMoney } from '@/lib/format';
import { Building, Users, Calendar, ArrowRight } from 'lucide-react';

export const AgingReport: React.FC = () => {
  const { currentCompany, contacts, invoices, bills, contactBalance } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [mode, setMode] = useState<'ar' | 'ap'>('ar');
  const [parameters, setParameters] = useState<ReportParameters>({
    periodFrom: 'per-2026-01',
    periodTo: 'per-2026-10',
    comparison: 'none',
    pivotDimension: 'none',
    hideZeroRows: false,
    presentationCurrency: 'USD',
    levelOfDetail: 'summary',
  });

  const relevantContacts = useMemo(() => {
    return contacts.filter((c) => (mode === 'ar' ? c.kind === 'customer' : c.kind === 'supplier'));
  }, [contacts, mode]);

  // Compute aging buckets per contact
  const agingRows = useMemo(() => {
    const today = new Date('2026-10-31');

    return relevantContacts.map((c) => {
      const openDocs = mode === 'ar'
        ? invoices.filter((i) => i.contact_id === c.id && i.status === 'posted' && i.total > i.settled)
        : bills.filter((b) => b.contact_id === c.id && b.status === 'posted' && b.total > b.settled);

      let current = 0;
      let bucket1_30 = 0;
      let bucket31_60 = 0;
      let bucket61_90 = 0;
      let bucket90Plus = 0;

      for (const doc of openDocs) {
        const openAmt = doc.total - doc.settled;
        const due = new Date(doc.due_date);
        const diffDays = Math.floor((today.getTime() - due.getTime()) / (1000 * 3600 * 24));

        if (diffDays <= 0) current += openAmt;
        else if (diffDays <= 30) bucket1_30 += openAmt;
        else if (diffDays <= 60) bucket31_60 += openAmt;
        else if (diffDays <= 90) bucket61_90 += openAmt;
        else bucket90Plus += openAmt;
      }

      const total = current + bucket1_30 + bucket31_60 + bucket61_90 + bucket90Plus;

      return {
        contact: c,
        total,
        current,
        bucket1_30,
        bucket31_60,
        bucket61_90,
        bucket90Plus,
      };
    }).filter((r) => !parameters.hideZeroRows || r.total !== 0);
  }, [relevantContacts, mode, invoices, bills, parameters.hideZeroRows]);

  const totals = useMemo(() => {
    let tot = 0, cur = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0;
    for (const r of agingRows) {
      tot += r.total;
      cur += r.current;
      b1 += r.bucket1_30;
      b2 += r.bucket31_60;
      b3 += r.bucket61_90;
      b4 += r.bucket90Plus;
    }
    return { tot, cur, b1, b2, b3, b4 };
  }, [agingRows]);

  return (
    <ReportShell
      title={mode === 'ar' ? 'Accounts Receivable (AR) Aging Summary' : 'Accounts Payable (AP) Aging Summary'}
      subtitle={`${currentCompany.legal_name} • As of October 31, 2026`}
      asOfMode={true}
      parameters={parameters}
      onParametersChange={setParameters}
    >
      <div className="w-full flex flex-col gap-5">
        {/* AR vs AP Toggle */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMode('ar')}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition ${
              mode === 'ar'
                ? 'bg-brand-teal text-white shadow-2xs'
                : 'bg-surface-elevated text-ink-muted border border-line-border hover:text-ink-900'
            }`}
          >
            Accounts Receivable (Customers)
          </button>
          <button
            type="button"
            onClick={() => setMode('ap')}
            className={`px-3 py-1.5 rounded text-xs font-semibold transition ${
              mode === 'ap'
                ? 'bg-brand-teal text-white shadow-2xs'
                : 'bg-surface-elevated text-ink-muted border border-line-border hover:text-ink-900'
            }`}
          >
            Accounts Payable (Suppliers)
          </button>
        </div>

        {/* Aging Table */}
        <div className="border border-line-border rounded-md overflow-hidden bg-surface-elevated shadow-2xs text-xs">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="h-9 bg-surface-neutral border-b border-line-border text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                <th className="px-3">Code</th>
                <th className="px-3">Contact Name</th>
                <th className="px-3 text-right">Current</th>
                <th className="px-3 text-right">1–30 Days</th>
                <th className="px-3 text-right">31–60 Days</th>
                <th className="px-3 text-right">61–90 Days</th>
                <th className="px-3 text-right">90+ Days</th>
                <th className="px-3 text-right font-bold text-ink-900">Total Outstanding</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-border">
              {agingRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-8 text-center text-ink-muted">
                    No outstanding aged balances.
                  </td>
                </tr>
              ) : (
                agingRows.map((r) => (
                  <tr key={r.contact.id} className="h-9 hover:bg-surface-neutral transition">
                    <td className="px-3 font-mono font-medium text-brand-teal">{r.contact.code}</td>
                    <td className="px-3 font-medium text-ink-900">{r.contact.name}</td>
                    <td className="px-3 text-right font-mono text-num text-ink-muted">
                      {formatMoney(r.current)}
                    </td>
                    <td className="px-3 text-right font-mono text-num text-ink-muted">
                      {formatMoney(r.bucket1_30)}
                    </td>
                    <td className="px-3 text-right font-mono text-num text-ink-muted">
                      {formatMoney(r.bucket31_60)}
                    </td>
                    <td className="px-3 text-right font-mono text-num text-warning">
                      {formatMoney(r.bucket61_90)}
                    </td>
                    <td className="px-3 text-right font-mono text-num text-danger font-medium">
                      {formatMoney(r.bucket90Plus)}
                    </td>
                    <td className="px-3 text-right font-mono text-num font-bold text-ink-900">
                      {formatMoney(r.total)}
                    </td>
                  </tr>
                ))
              )}

              {/* Totals Row */}
              <tr className="h-10 bg-surface-neutral font-bold text-xs border-t border-line-border">
                <td colSpan={2} className="px-3 uppercase">Total Aged Balances:</td>
                <td className="px-3 text-right font-mono text-num">{formatMoney(totals.cur)}</td>
                <td className="px-3 text-right font-mono text-num">{formatMoney(totals.b1)}</td>
                <td className="px-3 text-right font-mono text-num">{formatMoney(totals.b2)}</td>
                <td className="px-3 text-right font-mono text-num text-warning">{formatMoney(totals.b3)}</td>
                <td className="px-3 text-right font-mono text-num text-danger">{formatMoney(totals.b4)}</td>
                <td className="px-3 text-right font-mono text-num text-brand-teal text-sm">
                  {formatMoney(totals.tot)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </ReportShell>
  );
};
