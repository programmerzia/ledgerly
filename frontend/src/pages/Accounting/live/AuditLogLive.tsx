/** Audit log (live): the organisation's tamper-evident event chain, filtered to this company, with the verify action. */
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Download } from 'lucide-react';
import { SignDialog } from '@/components/domain/SignDialog';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { saveFile } from '@/api/live/reports';
import { downloadAuditBundle } from '@/api/live/listings';
import { ExportMenu } from '@/pages/Reports/live/ExportMenu';
import { PageHeader } from '@/components/domain/PageHeader';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import { IntentSlot } from '@/api/intentSlot';
import type { ApiAuditReport, AuditFilters } from '@/api/live/admin';
import { actorLabel, cleanFilters, verifyLines, type AuditRow } from '@/api/adapters/admin';
import { formatDateTime } from '@/lib/format';
import { useAuditEvents, useVerifyAudit } from '@/data/admin';
import { useRouteCompany } from '@/data/session';
import { Field, field, primary, secondary } from '@/components/live/form';
import { ErrorLine, LoadingLine } from './parts';

const EMPTY = { action: '', subject_type: '', subject_id: '', actor_id: '', request_id: '', from: '', to: '' };

export const AuditLogLive: React.FC = () => {
  const company = useRouteCompany();
  const [draft, setDraft] = useState(EMPTY);
  const [applied, setApplied] = useState<AuditFilters>({});
  const events = useAuditEvents(company.id, applied);
  const [openId, setOpenId] = useState<number | null>(null);
  const { run, signProps } = useSignedRun();
  const [bundleBusy, setBundleBusy] = useState(false);

  // The report export and the evidence bundle take the same filters as the list, except the request id.
  const exportQuery: Record<string, string> = {};
  for (const k of ['from', 'to', 'action', 'actor_id', 'subject_type', 'subject_id'] as const) if (applied[k]) exportQuery[k] = applied[k] as string;
  const downloadBundle = async () => {
    setBundleBusy(true);
    try {
      const file = await run(() => downloadAuditBundle(company.id, exportQuery));
      saveFile(file);
      toast.success(`Saved ${file.filename}`);
    } catch (e) {
      if (!isSigningCancelled(e)) toast.error(describeError(e));
    } finally {
      setBundleBusy(false);
    }
  };

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement>) => setDraft({ ...draft, [k]: e.target.value });
  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setOpenId(null);
    setApplied(cleanFilters(draft));
  };
  const clear = () => {
    setDraft(EMPTY);
    setApplied({});
  };
  const filtered = Object.keys(applied).length > 0;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <PageHeader title="Audit log" subtitle="Every change to the books is recorded and chained to the one before it, so a record cannot be altered or removed without the check below failing." />

      <VerifyPanel companyId={company.id} />

      <form onSubmit={apply} aria-label="Filter the audit log" className="grid grid-cols-1 gap-3 rounded-lg border border-border bg-surface p-4 md:grid-cols-3 lg:grid-cols-5">
        <Field id="af-action" label="What happened" hint="For example journal.posted">
          <input id="af-action" className={field} value={draft.action} onChange={set('action')} placeholder="journal.posted" />
        </Field>
        <Field id="af-type" label="Kind of record" hint="For example invoice">
          <input id="af-type" className={field} value={draft.subject_type} onChange={set('subject_type')} placeholder="invoice" />
        </Field>
        <Field id="af-subject" label="Record id">
          <input id="af-subject" className={field} value={draft.subject_id} onChange={set('subject_id')} />
        </Field>
        <Field id="af-actor" label="Person id">
          <input id="af-actor" className={field} value={draft.actor_id} onChange={set('actor_id')} />
        </Field>
        <Field id="af-request" label="Request id">
          <input id="af-request" className={field} value={draft.request_id} onChange={set('request_id')} />
        </Field>
        <Field id="af-from" label="From (UTC day)">
          <input id="af-from" type="date" className={field} value={draft.from} max={draft.to || undefined} onChange={set('from')} />
        </Field>
        <Field id="af-to" label="To (UTC day)">
          <input id="af-to" type="date" className={field} value={draft.to} min={draft.from || undefined} onChange={set('to')} />
        </Field>
        <div className="flex items-end gap-2 md:col-span-3 lg:col-span-5">
          <button type="submit" className={`${primary} h-8 px-3 text-[13px]`}>Apply</button>
          {(filtered || Object.values(draft).some(Boolean)) && <button type="button" className={`${secondary} h-8 px-3 text-[13px]`} onClick={clear}>Clear</button>}
        </div>
      </form>
      <div className="flex flex-wrap items-center gap-2 print:hidden" data-testid="audit-export">
        <p className="text-xs text-text-muted">Export the {filtered ? 'filtered ' : ''}events as a report, or as an evidence bundle an auditor can verify without Ledgerly (events, hash chain, seals, instructions and a checker).</p>
        <ExportMenu report="audit-trail" query={exportQuery}>
          <button type="button" disabled={bundleBusy} onClick={() => void downloadBundle()} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition-colors hover:bg-surface-neutral disabled:opacity-60" data-testid="audit-bundle">
            <Download className="size-3.5" />
            <span>{bundleBusy ? 'Preparing…' : 'Evidence bundle'}</span>
          </button>
        </ExportMenu>
      </div>
      <SignDialog {...signProps} documentTitle="Audit evidence bundle" actionTitle="Export audit evidence" consequenceText="The audit events you filtered are exported with their hash chain. This export is recorded in the audit log." />
      {events.isError && events.error instanceof ApiError && events.error.status === 422 && <p role="alert" className="text-[13px] text-danger">{describeError(events.error)} Check the filters: actions use letters, dots and underscores; ids are full ids.</p>}

      {events.isPending ? <LoadingLine what="the audit log" /> : events.isError ? (
        events.error instanceof ApiError && events.error.status === 403
          ? <p role="alert" className="rounded-lg border border-border bg-surface p-4 text-[13px] text-text-secondary">You do not have permission to read the audit log. Ask an owner or an auditor.</p>
          : events.error instanceof ApiError && events.error.status === 422 ? null : <ErrorLine error={events.error} onRetry={() => void events.refetch()} />
      ) : events.rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-4 text-[13px] text-text-muted" data-testid="audit-empty">{filtered ? 'No events match these filters.' : 'No events yet.'}</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left text-[13px]" data-testid="audit-table">
            <thead className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase text-text-muted">
              <tr><th className="px-3 py-2">#</th><th className="px-3 py-2">When</th><th className="px-3 py-2">What</th><th className="px-3 py-2">Record</th><th className="px-3 py-2">By</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {events.rows.map((r) => (
                <React.Fragment key={r.id}>
                  <tr data-event={r.action} onClick={() => setOpenId(openId === r.id ? null : r.id)} className="cursor-pointer hover:bg-surface-neutral">
                    <td className="px-3 py-2 tabular-nums text-text-muted">{r.id}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-text-secondary">{formatDateTime(r.at)}</td>
                    <td className="px-3 py-2 text-text-primary">{r.actionText}<span className="ml-2 font-mono text-[11px] text-text-muted">{r.action}</span></td>
                    <td className="px-3 py-2 text-text-secondary">{r.subject}</td>
                    <td className="px-3 py-2 text-text-secondary">{actorLabel(r)}</td>
                  </tr>
                  {openId === r.id && <tr><td colSpan={5} className="bg-canvas px-4 py-3"><Detail row={r} /></td></tr>}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {events.hasNextPage && (
        <div>
          <button type="button" className={secondary} disabled={events.isFetchingNextPage} onClick={() => void events.fetchNextPage()}>{events.isFetchingNextPage ? 'Loading…' : 'Show older events'}</button>
        </div>
      )}
      {events.isFetchNextPageError && <ErrorLine error={events.error} onRetry={() => void events.fetchNextPage()} />}
    </div>
  );
};

const Detail: React.FC<{ row: AuditRow }> = ({ row }) => (
  <dl className="grid grid-cols-1 gap-3 text-xs md:grid-cols-2" data-testid="audit-detail">
    {(['before', 'after', 'context'] as const).map((k) => row[k] && (
      <div key={k}>
        <dt className="font-medium text-text-secondary">{k === 'before' ? 'Before' : k === 'after' ? 'After' : 'Context'}</dt>
        <dd><pre className="mt-1 max-h-48 overflow-auto rounded border border-border bg-surface p-2 font-mono text-[11px] text-text-primary">{JSON.stringify(row[k], null, 2)}</pre></dd>
      </div>
    ))}
    <div className="md:col-span-2 grid grid-cols-1 gap-1 font-mono text-[11px] text-text-muted">
      <div>Record id: {row.subject || 'none'}{row.requestId ? ` · request ${row.requestId}` : ''}{row.ip ? ` · from ${row.ip}` : ''}</div>
      <div className="break-all">Hash {row.hash}</div>
      <div className="break-all">Previous {row.prevHash ?? 'none (first event)'}</div>
    </div>
  </dl>
);

/** Runs the chain check and shows the server's report as it is: intact, or exactly where and why it broke. */
const VerifyPanel: React.FC<{ companyId: string }> = ({ companyId }) => {
  const verify = useVerifyAudit(companyId);
  const slot = useRef(new IntentSlot()).current;
  const [full, setFull] = useState(false);
  const [report, setReport] = useState<ApiAuditReport | null>(null);

  const run = () => {
    setReport(null);
    verify.mutate({ full, intent: slot.for(`${full}:${Date.now()}`) }, { onSuccess: (r) => { slot.clear(); setReport(r); } });
  };

  return (
    <section aria-label="Check the chain" className="rounded-lg border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={`${primary} h-8 px-3 text-[13px]`} disabled={verify.isPending} onClick={run}>{verify.isPending ? 'Checking…' : 'Check the chain'}</button>
        <label className="flex items-center gap-2 text-[13px] text-text-secondary">
          <input type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} /> From the first event
        </label>
        <span className="text-xs text-text-muted">The chain covers every company in the organisation, not only this one.</span>
      </div>
      {verify.isError && <p role="alert" className="mt-3 text-[13px] text-danger" data-testid="verify-error">{describeError(verify.error)}</p>}
      {report && (report.intact ? (
        <p role="status" data-testid="verify-result" data-intact="true" className="mt-3 text-[13px] text-success">
          Intact. {report.events_checked.toLocaleString('en-US')} event{report.events_checked === 1 ? '' : 's'} checked{report.started_after_id !== null ? `, after event ${report.started_after_id}` : ' from the first event'}.
        </p>
      ) : (
        <div role="alert" data-testid="verify-result" data-intact="false" className="mt-3 rounded-md border border-danger/40 bg-danger-soft p-3 text-[13px] text-danger">
          <p className="font-semibold">The chain is not intact.</p>
          <p>Broken at event {report.broken_at_id ?? 'unknown'} after checking {report.events_checked.toLocaleString('en-US')}.</p>
          {verifyLines(report).map((l, i) => <p key={i}>{l}</p>)}
        </div>
      ))}
    </section>
  );
};
