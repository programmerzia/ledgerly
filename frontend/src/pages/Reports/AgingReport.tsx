import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { amountDue, daysOverdue } from '@/lib/docStatus';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { ReportShell, defaultReportParameters, useSelectedPeriod, type ReportParameters } from './ReportShell';
import { ReportCard, Segmented, moneyFmt } from './ReportParts';

type BucketKey = 'current' | 'd30' | 'd60' | 'd90' | 'd90p';
const BUCKETS: { key: BucketKey; label: string; swatch: string; text: string }[] = [
  { key: 'current', label: 'Current', swatch: 'bg-text-muted/40', text: 'text-text-primary' },
  { key: 'd30', label: '1–30 days', swatch: 'bg-warning/50', text: 'text-text-primary' },
  { key: 'd60', label: '31–60 days', swatch: 'bg-warning', text: 'text-text-primary' },
  { key: 'd90', label: '61–90 days', swatch: 'bg-danger/70', text: 'text-danger' },
  { key: 'd90p', label: '90+ days', swatch: 'bg-danger', text: 'text-danger' },
];
const bucketOf = (days: number): BucketKey =>
  days <= 0 ? 'current' : days <= 30 ? 'd30' : days <= 60 ? 'd60' : days <= 90 ? 'd90' : 'd90p';

interface AgingRow {
  id: string;
  code: string;
  name: string;
  buckets: Record<BucketKey, number>;
  total: number;
}

const GRID = 'grid grid-cols-[minmax(10rem,1fr)_repeat(5,6.5rem)_7.5rem] gap-3';

export const AgingReport: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, contacts, invoices, bills } = useLedgerStore();
  const money = moneyFmt(currentCompany.base_currency);
  const [mode, setMode] = useState<'ar' | 'ap'>('ar');
  const [parameters, setParameters] = useState<ReportParameters>({ ...defaultReportParameters(), hideZeroRows: true });
  const period = useSelectedPeriod(parameters.periodTo);
  const asOf = period?.ends_on ?? '2026-10-31';

  const build = (kind: 'ar' | 'ap'): AgingRow[] => {
    const docs = kind === 'ar' ? invoices : bills;
    return contacts
      .filter((c) => c.kind === (kind === 'ar' ? 'customer' : 'supplier'))
      .map((c) => {
        const buckets: Record<BucketKey, number> = { current: 0, d30: 0, d60: 0, d90: 0, d90p: 0 };
        for (const d of docs) {
          if (d.contact_id !== c.id || d.status !== 'posted' || d.issue_date > asOf) continue;
          const due = amountDue(d);
          if (due > 0) buckets[bucketOf(daysOverdue(d, asOf))] += due;
        }
        return { id: c.id, code: c.code, name: c.name, buckets, total: Object.values(buckets).reduce((s, v) => s + v, 0) };
      })
      .sort((a, b) => b.total - a.total);
  };

  const ar = useMemo(() => build('ar'), [contacts, invoices, asOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const ap = useMemo(() => build('ap'), [contacts, bills, asOf]); // eslint-disable-line react-hooks/exhaustive-deps
  const all = mode === 'ar' ? ar : ap;
  const rows = all.filter((r) => !parameters.hideZeroRows || r.total !== 0);
  const totals = BUCKETS.reduce((o, b) => ({ ...o, [b.key]: all.reduce((s, r) => s + r.buckets[b.key], 0) }), {} as Record<BucketKey, number>);
  const grand = Object.values(totals).reduce((s, v) => s + v, 0);
  const route = mode === 'ar' ? 'customers' : 'suppliers';

  return (
    <ReportShell
      title={mode === 'ar' ? 'Receivables aging' : 'Payables aging'}
      asOfMode
      parameters={parameters}
      onParametersChange={setParameters}
      toolbar={
        <Segmented
          label="Report type"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'ar', label: 'Receivables' },
            { value: 'ap', label: 'Payables' },
          ]}
        />
      }
    >
      <div className="bg-surface border border-border rounded-lg p-4 sm:p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="text-xs text-text-muted">{mode === 'ar' ? 'Customers owe you' : 'You owe suppliers'}</div>
            <div className="text-[22px] leading-7 font-medium tabular-nums text-text-primary">{money(grand)}</div>
          </div>
          <div className="text-xs text-text-muted">{all.filter((r) => r.total > 0).length} with a balance</div>
        </div>
        <div className="mt-3 flex h-1.5 w-full overflow-hidden rounded-[1px] gap-px bg-surface-neutral" role="img" aria-label="Balance by age">
          {grand > 0 &&
            BUCKETS.map((b) =>
              totals[b.key] > 0 ? (
                <span key={b.key} className={b.swatch} style={{ width: `${(totals[b.key] / grand) * 100}%` }} title={`${b.label}: ${money(totals[b.key])}`} />
              ) : null
            )}
        </div>
        <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3">
          {BUCKETS.map((b) => (
            <div key={b.key}>
              <div className="flex items-center gap-1.5 text-xs text-text-muted">
                <span className={cn('size-2 rounded-[1px]', b.swatch)} />
                {b.label}
              </div>
              <div className={cn('text-[13px] font-medium tabular-nums', b.text)}>{money(totals[b.key])}</div>
            </div>
          ))}
        </div>
      </div>

      <ReportCard className="p-0 sm:p-0">
        <div className="min-w-[760px]">
          <div className={`${GRID} px-4 py-2.5 border-b border-border text-[11px] font-semibold text-text-muted sticky top-0 bg-surface`}>
            <span>{mode === 'ar' ? 'Customer' : 'Supplier'}</span>
            {BUCKETS.map((b) => (
              <span key={b.key} className="text-right">{b.label}</span>
            ))}
            <span className="text-right">Total</span>
          </div>
          {rows.length === 0 && <div className="p-8 text-center text-xs text-text-muted">Nothing outstanding as of this date.</div>}
          <div className="divide-y divide-border/60">
            {rows.map((r) => (
              <div
                key={r.id}
                role="link"
                tabIndex={0}
                onClick={() => navigate(`/${currentCompany.slug}/${route}/${r.id}`)}
                onKeyDown={(e) => e.key === 'Enter' && navigate(`/${currentCompany.slug}/${route}/${r.id}`)}
                className={`${GRID} items-center px-4 py-2 text-xs cursor-pointer hover:bg-canvas focus-visible:outline-2 outline-accent`}
              >
                <span className="flex items-center gap-2.5 min-w-0">
                  <Avatar name={r.name} size="sm" square />
                  <span className="min-w-0">
                    <span className="block truncate font-medium text-text-primary">{r.name}</span>
                    <span className="block text-[11px] font-code text-text-muted">{r.code}</span>
                  </span>
                </span>
                {BUCKETS.map((b) => (
                  <span key={b.key} className={cn('text-right tabular-nums', r.buckets[b.key] === 0 ? 'text-text-muted' : b.text)}>
                    {r.buckets[b.key] === 0 ? '—' : money(r.buckets[b.key])}
                  </span>
                ))}
                <span className="text-right tabular-nums font-semibold text-text-primary">{money(r.total)}</span>
              </div>
            ))}
          </div>
          <div className={`${GRID} items-baseline px-4 py-3 border-t border-text-primary border-b-[3px] border-double text-[13px] font-semibold`}>
            <span className="text-text-primary">Total</span>
            {BUCKETS.map((b) => (
              <span key={b.key} className="text-right tabular-nums">{money(totals[b.key])}</span>
            ))}
            <span className="text-right tabular-nums">{money(grand)}</span>
          </div>
        </div>
      </ReportCard>
    </ReportShell>
  );
};
