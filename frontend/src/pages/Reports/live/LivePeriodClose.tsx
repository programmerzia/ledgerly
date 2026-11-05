/** Period close checklist report (3c.20): a period's close checks, as recorded when it closed or as they stand now. */
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, MinusCircle, XCircle } from 'lucide-react';
import { fetchPeriodClose } from '@/api/live/listings';
import { PageHeader } from '@/components/domain/PageHeader';
import { currentPeriod } from '@/api/adapters/reportSelection';
import { localDateISO } from '@/api/adapters/onboarding';
import { useReportPeriods } from '@/data/reports';
import { useRouteCompany } from '@/data/session';
import { formatDate, formatDateTime } from '@/lib/format';
import { ReportCard, SelectBox } from '../ReportParts';
import { ExportMenu } from './ExportMenu';
import { ReportError, ReportLoading } from './parts';

export const LivePeriodClose: React.FC = () => {
  const company = useRouteCompany();
  const { periods } = useReportPeriods();
  const ordered = [...periods].filter((p) => p.kind !== 'adjustment').sort((a, b) => b.starts_on.localeCompare(a.starts_on));
  const [picked, setPicked] = useState('');
  const periodId = picked || currentPeriod(periods, localDateISO())?.id || ordered[0]?.id || '';
  const q = useQuery({
    queryKey: ['reports', company.id, 'period-close', periodId],
    queryFn: ({ signal }) => fetchPeriodClose(company.id, periodId, signal),
    enabled: periodId !== '',
    retry: false,
    refetchOnWindowFocus: false,
  });
  const r = q.data;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Period close checklist"
        subtitle={r ? `${company.name} · ${r.period.name} (${formatDate(r.period.starts_on)} to ${formatDate(r.period.ends_on)}) · ${r.period.status.replace('_', ' ')}` : company.name}
      />
      <div className="flex flex-wrap items-center gap-3 print:hidden" data-testid="report-params">
        <SelectBox aria-label="Period" value={periodId} onChange={(e) => setPicked(e.target.value)}>
          {ordered.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectBox>
        <ExportMenu report="period-close" query={{ period_id: periodId }} disabled={periodId === ''} />
      </div>
      {periodId === '' || q.isPending ? <ReportLoading what="the checklist" /> : q.isError || !r ? <ReportError error={q.error} onRetry={() => void q.refetch()} what="the period close checklist" /> : (
        <ReportCard>
          <div className="min-w-[520px]" data-testid="period-close">
            <p className="px-2 pb-2 text-xs text-text-secondary">
              {r.source === 'live'
                ? 'The checks as they stand now. Closing the period runs them again.'
                : `The checks as recorded when the period closed${r.period.closed_by ? ` (by ${r.period.closed_by}${r.period.closed_at ? `, ${formatDateTime(r.period.closed_at)}` : ''})` : ''}.`}
              {' '}{r.summary.passed} passed, {r.summary.waived} waived, {r.summary.failed} failed.
            </p>
            <div className="divide-y divide-border/60">
              {r.checks.map((c) => (
                <div key={c.code} className="flex items-start gap-3 px-2 py-2 text-xs" data-check={c.code} data-status={c.status}>
                  {c.status === 'passed' ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-label="passed" /> : c.status === 'waived' ? <MinusCircle className="mt-0.5 size-4 shrink-0 text-warning" aria-label="waived" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-danger" aria-label="failed" />}
                  <div>
                    <div className="font-medium text-text-primary">{c.code} <span className="font-normal text-text-secondary">{c.message}</span></div>
                    {c.status === 'waived' && <div className="text-text-muted">Waived{c.waived_by ? ` by ${c.waived_by}` : ''}: {c.waived_reason}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </ReportCard>
      )}
    </div>
  );
};
