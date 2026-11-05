import React, { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { reportQuery, useReport } from '@/data/reports';
import { useRouteCompany } from '@/data/session';
import { AGING_BUCKETS, type AgingBucket } from '@/api/adapters/report';
import { cn } from '@/lib/utils';
import { ReportCard, Segmented, longDate, tone } from '../ReportParts';
import { LiveReportShell } from './LiveReportShell';
import { ReportError, ReportLoading, dash, fmt } from './parts';
import { useReportSelection } from './useSelection';
import { DocumentsDrill, type DocumentsTarget } from './DocumentsDrill';

const BUCKET_LABEL: Record<AgingBucket, string> = {
  current: 'Not yet due', days_1_30: '1–30 days', days_31_60: '31–60 days', days_61_90: '61–90 days', days_over_90: 'Over 90 days',
};
const GRID = 'grid grid-cols-[minmax(10rem,1fr)_repeat(5,6.5rem)_7rem_7rem_7.5rem] gap-3';
const KIND_LABEL: Record<string, string> = { credit_note: 'Credit note', debit_note: 'Debit note', receipt: 'Receipt', payment: 'Payment', refund: 'Refund', supplier_refund: 'Supplier refund' };

export const LiveAging: React.FC = () => {
  const company = useRouteCompany();
  const [sp, setSp] = useSearchParams();
  const side = sp.get('side') === 'ap' ? 'ap' : 'ar';
  const { selection, set, periods, ready } = useReportSelection('asof');
  const name = side === 'ar' ? 'ar-aging' : 'ap-aging';
  const q = useReport(name, selection, ready);
  const ag = q.data;
  const money = fmt(ag?.currency ?? company.base_currency);
  const statement = side === 'ar' ? 'customer-statement' : 'supplier-statement';
  const [docs, setDocs] = useState<DocumentsTarget | null>(null);

  // A cell opens the documents it is made of (3c.21); they add up to the figure shown.
  const cell = (amount: number, bucket: string, contact?: { id: string; name: string }) => {
    if (amount === 0) return dash;
    const label = bucket === 'open' ? 'Open' : bucket === 'credits' ? 'Credits' : BUCKET_LABEL[bucket as AgingBucket];
    return (
      <button
        type="button"
        className="cursor-pointer tabular-nums hover:text-accent hover:underline"
        title="Show the documents"
        onClick={() => setDocs({
          title: `${contact?.name ?? (side === 'ar' ? 'All customers' : 'All suppliers')} · ${label}`,
          subtitle: ag ? `As of ${longDate(ag.asOf)}` : undefined,
          path: `${name}/documents`,
          query: { ...reportQuery(name, selection), bucket, ...(contact ? { contact_id: contact.id } : {}) },
          expected: { amount },
        })}
      >
        {money(amount)}
      </button>
    );
  };

  return (
    <LiveReportShell
      title={side === 'ar' ? 'Receivables aging' : 'Payables aging'}
      report={name}
      kind="asof"
      selection={selection}
      onChange={set}
      periods={periods}
      descriptor={ag ? `As of ${longDate(ag.asOf)} · by due date` : undefined}
      generatedAt={ag?.generatedAt}
      toolbar={
        <Segmented
          label="Report type"
          value={side}
          onChange={(v) => {
            const next = new URLSearchParams(sp);
            if (v === 'ap') next.set('side', 'ap');
            else next.delete('side');
            setSp(next, { replace: true });
          }}
          options={[{ value: 'ar', label: 'Receivables' }, { value: 'ap', label: 'Payables' }]}
        />
      }
    >
      {!ready || q.isPending ? <ReportLoading what="the aging" /> : q.isError ? <ReportError error={q.error} onRetry={() => void q.refetch()} what="the aging report" /> : ag && (
        <>
          <ReportCard className="p-0 sm:p-0">
            <div className="min-w-[900px]">
              <div className={`${GRID} px-4 py-2.5 border-b border-border text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted`}>
                <span>{side === 'ar' ? 'Customer' : 'Supplier'}</span>
                {AGING_BUCKETS.map((b) => <span key={b} className="text-right">{BUCKET_LABEL[b]}</span>)}
                <span className="text-right">Open</span>
                <span className="text-right">Credits</span>
                <span className="text-right">Net</span>
              </div>
              {ag.rows.length === 0 && <p className="p-8 text-center text-xs text-text-muted">Nothing outstanding as of this date.</p>}
              <div className="divide-y divide-border/60">
                {ag.rows.map((r) => (
                  <div key={r.contact.id} className={`${GRID} items-baseline px-4 py-2 text-xs`}>
                    <span className="min-w-0">
                      <Link to={`/${company.slug}/reports/${statement}?contact=${r.contact.id}`} className="block truncate font-medium text-text-primary hover:text-accent hover:underline" title="Open the statement">
                        {r.contact.name}
                      </Link>
                      <span className="block text-[11px] font-code text-text-muted">{r.contact.code}</span>
                    </span>
                    {AGING_BUCKETS.map((b) => (
                      <span key={b} className="text-right tabular-nums">{cell(r.buckets[b], b, r.contact)}</span>
                    ))}
                    <span className="text-right tabular-nums">{cell(r.open, 'open', r.contact)}</span>
                    <span className="text-right tabular-nums">{cell(r.credits, 'credits', r.contact)}</span>
                    <span className={cn('text-right tabular-nums font-semibold', tone(r.net))}>{money(r.net)}</span>
                  </div>
                ))}
              </div>
              <div className={`${GRID} items-baseline px-4 py-3 border-t border-text-primary border-b-[3px] border-double text-[13px] font-semibold`} data-testid="aging-totals">
                <span className="text-text-primary">Total</span>
                {AGING_BUCKETS.map((b) => <span key={b} className="text-right tabular-nums">{cell(ag.totals.buckets[b], b)}</span>)}
                <span className="text-right tabular-nums">{cell(ag.totals.open, 'open')}</span>
                <span className="text-right tabular-nums">{cell(ag.totals.credits, 'credits')}</span>
                <span className={cn('text-right tabular-nums', tone(ag.totals.net))}>{money(ag.totals.net)}</span>
              </div>
            </div>
          </ReportCard>
          <p className="text-xs text-text-muted">
            Credits are listed apart and are not taken off the age columns. Net is open less credits, which is what the {side === 'ar' ? 'receivables' : 'payables'} control account holds.
          </p>
          {ag.credits.length > 0 && (
            <ReportCard className="p-0 sm:p-0">
              <div className="min-w-[600px]" data-testid="aging-credits">
                <div className="px-4 py-2.5 border-b border-border text-[13px] font-semibold text-text-primary">Credits not yet used</div>
                <div className="grid grid-cols-[minmax(10rem,1fr)_8rem_8rem_7rem_8rem] gap-3 px-4 py-2 border-b border-border text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  <span>{side === 'ar' ? 'Customer' : 'Supplier'}</span><span>Type</span><span>Number</span><span>Date</span><span className="text-right">Amount</span>
                </div>
                <div className="divide-y divide-border/60">
                  {ag.credits.map((c) => (
                    <div key={c.id} className="grid grid-cols-[minmax(10rem,1fr)_8rem_8rem_7rem_8rem] gap-3 items-baseline px-4 py-1.5 text-xs">
                      <span className="text-text-primary">{c.contact.name}</span>
                      <span className="text-text-secondary">{KIND_LABEL[c.kind] ?? c.kind}</span>
                      <span className="font-code text-text-muted">{c.number ?? '—'}</span>
                      <span className="tabular-nums text-text-muted">{c.date}</span>
                      <span className="text-right tabular-nums">{money(c.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </ReportCard>
          )}
        </>
      )}
      <DocumentsDrill target={docs} onClose={() => setDocs(null)} />
    </LiveReportShell>
  );
};
