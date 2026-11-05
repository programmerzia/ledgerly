/**
 * Periods and close, live mode (step 3.2). The server owns every verdict: which buttons exist (`can`), which checks
 * fail, whether waivers are accepted, who may approve a reopening. This screen asks, shows, and signs.
 * Mock mode keeps the original page (Periods.tsx), which this does not replace.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { FileCheck2, Lock, Unlock, ShieldCheck, UserCheck, AlertCircle, CheckCircle2, Lock as LockIcon } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { StatusPill } from '@/components/domain/StatusPill';
import { EmptyState } from '@/components/domain/EmptyState';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { PeriodTimeline } from './PeriodTimeline';
import { NewFiscalYear } from './NewFiscalYear';
import { useAccess } from '@/data/menu';
import { CloseChecklistCard } from './CloseChecklistCard';
import { useLedgerStore } from '@/mock/store';
import { formatDate } from '@/lib/format';
import { useFiscalYears, useCloseChecks, useFiscalActions } from '@/data/fiscal';
import { defaultPeriod, defaultYear, type LivePeriod } from '@/api/adapters/fiscal';
import { createIntent } from '@/api/idempotency';
import { describeError } from '@/api/messages';
import { describeProblem } from '@/api/live/writeProblems';
import { SignDialog } from '@/components/domain/SignDialog';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { cn } from '@/lib/utils';

const btnGhost = 'h-8 px-3 rounded-md border border-border hover:bg-surface-neutral text-[13px] font-medium text-text-secondary cursor-pointer';
const headerBtn = 'flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-secondary transition hover:bg-surface-neutral hover:text-text-primary cursor-pointer disabled:cursor-not-allowed disabled:opacity-50';

type Modal = 'close' | 'reopen' | 'reject' | 'year-end' | 'lock' | null;

/** The day after a YYYY-MM-DD date: a new fiscal year normally starts the day after the last one ends. */
const nextDay = (date: string | undefined): string | undefined => {
  if (!date) return undefined;
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

export const LivePeriods: React.FC = () => {
  const navigate = useNavigate();
  const slug = useLedgerStore((s) => s.currentCompany.slug);
  const myId = useLedgerStore((s) => s.currentUser.id);
  const { data: years, isLoading, error, refetch } = useFiscalYears();
  const actions = useFiscalActions();
  const signed = useSignedRun();
  const [signCtx, setSignCtx] = useState<{ title: string; consequence: string; actionTitle?: string } | null>(null);

  const [yearId, setYearId] = useState<string | null>(null);
  const [periodId, setPeriodId] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [addingYear, setAddingYear] = useState(false);
  const access = useAccess();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [waive, setWaive] = useState<Record<string, { on: boolean; reason: string }>>({});
  const intent = useRef(createIntent());

  const year = useMemo(() => years.find((y) => y.id === yearId) ?? defaultYear(years), [years, yearId]);
  const period: LivePeriod | undefined = useMemo(() => year?.periods.find((p) => p.id === periodId) ?? defaultPeriod(year), [year, periodId]);

  const open = (m: Exclude<Modal, null>) => {
    intent.current = createIntent();
    setProblem(null);
    setWaive({});
    setReason('');
    setComment('');
    setModal(m);
  };

  // The checklist is only meaningful (and only allowed) while the month can still be closed.
  const closable = Boolean(period && (period.status === 'open' || period.status === 'soft_closed') && (period.can.close || period.can.soft_close));
  const checks = useCloseChecks(period?.id, closable);
  const failing = checks.data.filter((c) => c.status === 'fail');

  useEffect(() => setProblem(null), [period?.id]);

  /** Runs a write, signing if the server asks. Returns true on success. */
  const act = async (fn: () => Promise<unknown>, ctx?: { title: string; consequence: string; actionTitle?: string }, success?: string): Promise<boolean> => {
    setBusy(true);
    setProblem(null);
    try {
      if (ctx) {
        setSignCtx(ctx);
        await signed.run(fn);
      } else await fn();
      if (success) toast.success(success);
      return true;
    } catch (e) {
      if (!isSigningCancelled(e)) setProblem(describeProblem(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <p className="p-4 text-[13px] text-text-muted" role="status">Loading periods…</p>;
  if (error)
    return (
      <div className="p-4 text-[13px] text-danger" role="alert">
        {describeError(error)}{' '}
        <button type="button" onClick={refetch} className="text-accent hover:underline cursor-pointer">Try again</button>
      </div>
    );
  if (!year || !period) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader title="Periods and close" subtitle="Close each period once everything is checked." actions={access.can('settings.manage') ? <button type="button" onClick={() => setAddingYear(true)} className={headerBtn}>Add fiscal year</button> : undefined} />
        <EmptyState icon={Lock} title="No financial year yet" description="A financial year with its periods is created during company setup. Once one exists you can close its periods here." />
        <NewFiscalYear open={addingYear} onClose={() => setAddingYear(false)} />
      </div>
    );
  }

  const req = period.reopen_request && period.reopen_request.status === 'pending' ? period.reopen_request : null;
  const closedLike = period.status === 'closed' || period.status === 'locked';

  const doSoftClose = () =>
    act(() => actions.softClose(period, createIntent()), undefined, `${period.name} is soft closed.`);

  const doClose = async () => {
    const waivers = Object.fromEntries(Object.entries(waive).filter(([, w]) => w.on).map(([code, w]) => [code, w.reason]));
    const ok = await act(
      () => actions.close(period, waivers, intent.current),
      { title: `Close ${period.name}`, consequence: `Closing ${period.name} stops anyone adding journals, invoices or receipts to it. You can still ask to reopen it later.`, actionTitle: 'Sign and close' },
      `${period.name} closed.`,
    );
    if (ok) setModal(null);
  };

  const doRequestReopen = async () => {
    const ok = await act(() => actions.requestReopen(period, reason.trim(), intent.current), { title: `Reopen request: ${period.name}`, consequence: 'Your request goes to two other approvers.', actionTitle: 'Send request' }, 'Reopen request sent. Two other people have to approve it.');
    if (ok) setModal(null);
  };

  const doApprove = () =>
    act(
      () => actions.approveReopen(req!, createIntent()),
      { title: `Reopen approval: ${period.name}`, consequence: `Your signature counts as one of the two approvals. When the second person signs, ${period.name} reopens so entries can be added again.`, actionTitle: 'Approve reopening' },
      'Your approval is recorded.',
    );

  const doReject = async () => {
    const ok = await act(
      () => actions.rejectReopen(req!, comment.trim(), intent.current),
      { title: `Reject reopening: ${period.name}`, consequence: 'The request is closed and the month stays closed.', actionTitle: 'Sign and reject' },
      'Reopen request rejected.',
    );
    if (ok) setModal(null);
  };

  const doYearEnd = async () => {
    setBusy(true);
    setProblem(null);
    try {
      setSignCtx({
        title: `Year-end close for ${year.name}`,
        consequence: 'The server posts the closing journal, moving income and expenses into retained earnings. Posted entries cannot be edited, only reversed.',
        actionTitle: 'Sign and close the year',
      });
      const res = await signed.run(() => actions.yearEnd(year, intent.current));
      toast.success(res.closingJournalId ? `${year.name} closed. Closing journal ${res.closingJournalId} posted.` : `${year.name} closed.`);
      setModal(null);
    } catch (e) {
      if (!isSigningCancelled(e)) setProblem(describeProblem(e));
    } finally {
      setBusy(false);
    }
  };

  const doLock = async () => {
    const ok = await act(() => actions.lockYear(year, intent.current), { title: `Lock ${year.name}`, consequence: `Locking marks ${year.name} as final.`, actionTitle: 'Sign and lock' }, `${year.name} locked.`);
    if (ok) setModal(null);
  };

  const waiveOk = Object.values(waive).every((w) => !w.on || w.reason.trim() !== '');

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Periods and close"
        subtitle="Close each month once everything is checked. Closed months cannot be changed without two approvals."
        actions={
          <>
            {years.length > 1 && (
              <select aria-label="Financial year" value={year.id} onChange={(e) => { setYearId(e.target.value); setPeriodId(null); }} className="h-9 rounded-md border border-border bg-surface px-2 text-[13px] text-text-primary">
                {years.map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
              </select>
            )}
            {access.can('settings.manage') && (
              <button type="button" onClick={() => setAddingYear(true)} className={headerBtn}>Add fiscal year</button>
            )}
            {year.can.year_end && (
              <button type="button" onClick={() => open('year-end')} className={headerBtn}>
                <Lock className="size-4 text-accent" />
                Year-end close
              </button>
            )}
            {year.can.lock && (
              <button type="button" onClick={() => open('lock')} className={headerBtn}>
                <LockIcon className="size-4 text-accent" />
                Lock year
              </button>
            )}
          </>
        }
      />

      {problem && modal === null && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] font-medium text-danger" role="alert">
          <AlertCircle className="size-4 shrink-0" />
          <span>{problem}</span>
        </div>
      )}

      <PeriodTimeline periods={year.periods} selectedId={period.id} onSelect={setPeriodId} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5">
          {req && (
            <div className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning-soft p-5 text-[13px]">
              <div className="flex items-center gap-2 font-semibold text-warning">
                <ShieldCheck className="size-4" />
                {req.first_approver_id ? 'Reopening is waiting for a second approval' : 'Reopening is waiting for two approvals'}
              </div>
              <p className="text-text-secondary">Reason given: <em>&quot;{req.reason}&quot;</em></p>
              <div className="flex flex-wrap justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-xs">
                <span>
                  First approval:{' '}
                  {req.first_approver_id ? <strong className="text-success">signed{req.first_signed_at ? ` ${formatDate(req.first_signed_at)}` : ''}</strong> : <strong>not yet</strong>}
                </span>
                <span>Second approval: <strong>{req.second_approver_id ? 'signed' : 'not yet'}</strong></span>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                {req.first_approver_id === myId ? (
                  <div className="flex items-center gap-1.5 text-xs font-medium text-danger">
                    <AlertCircle className="size-3.5 shrink-0" />
                    <span>You gave the first approval. A different person must give the second.</span>
                  </div>
                ) : req.requested_by === myId ? (
                  <span className="text-xs text-text-muted">You asked for this. Two other people have to approve it.</span>
                ) : (
                  <span className="text-xs text-text-muted">{req.can.approve ? 'Waiting for your decision.' : 'Waiting for other approvers.'}</span>
                )}
                <div className="flex items-center gap-2">
                  {req.can.reject && (
                    <button type="button" onClick={() => open('reject')} className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition hover:bg-surface-neutral cursor-pointer">
                      Reject
                    </button>
                  )}
                  {req.can.approve && (
                    <button type="button" disabled={busy} onClick={() => void doApprove()} className="flex h-8 items-center gap-1.5 rounded-md bg-success px-4 text-[13px] font-medium text-white transition hover:opacity-90 cursor-pointer disabled:opacity-50">
                      <UserCheck className="size-4" />
                      Approve reopening
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {closable ? (
            checks.isLoading ? (
              <p className="rounded-lg border border-border bg-surface p-5 text-[13px] text-text-muted" role="status">Checking the month…</p>
            ) : checks.error ? (
              <div className="rounded-lg border border-border bg-surface p-5 text-[13px] text-danger" role="alert">
                {describeError(checks.error)}{' '}
                <button type="button" onClick={checks.refetch} className="text-accent hover:underline cursor-pointer">Try again</button>
              </div>
            ) : (
              <CloseChecklistCard
                checks={checks.data}
                onFix={(chk) => {
                  if (chk.check_code === 'BANK_REC') navigate(`/${slug}/banking`);
                  else if (chk.check_code === 'APPROVALS') navigate(`/${slug}/approvals`);
                  else if (chk.check_code === 'FX_REVAL') navigate(`/${slug}/fx-rates`);
                  else if (chk.check_code === 'DEPR_RUN') navigate(`/${slug}/assets?tab=depreciation`);
                  else navigate(`/${slug}/journals`);
                }}
              />
            )
          ) : (
            <section className="rounded-lg border border-border bg-surface p-5 text-[13px] text-text-muted">
              {closedLike ? `${period.name} is ${period.status === 'locked' ? 'locked' : 'closed'}.` : 'The month-end checklist is for people who can close periods.'}
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">{period.name}</h2>
              <StatusPill status={period.status} />
            </div>
            <div className="text-xs text-text-muted">
              {formatDate(period.starts_on)} to {formatDate(period.ends_on)}
              {period.soft_closed_at && period.status === 'soft_closed' && <div className="mt-1">Soft closed on {formatDate(period.soft_closed_at)}</div>}
              {period.closed_at && closedLike && <div className="mt-1">Closed on {formatDate(period.closed_at)}</div>}
            </div>
            <Link to={`/${slug}/periods/close-pack?period=${period.id}`} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition hover:bg-surface-neutral">
              <FileCheck2 className="size-4" />
              Open the close pack
            </Link>
            {period.can.request_reopen && !req && (
              <button type="button" onClick={() => open('reopen')} className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-accent px-4 text-[13px] font-medium text-white transition hover:bg-accent-hover cursor-pointer">
                <Unlock className="size-4" />
                Ask to reopen
              </button>
            )}
            {period.can.soft_close && (
              <button type="button" disabled={busy} onClick={() => void doSoftClose()} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition hover:bg-surface-neutral cursor-pointer disabled:opacity-50">
                <Lock className="size-4" />
                Soft close {period.name}
              </button>
            )}
            {period.can.close && (
              <button type="button" onClick={() => open('close')} className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-text-primary px-3 text-[13px] font-medium text-surface transition-opacity hover:opacity-90 cursor-pointer">
                <Lock className="size-4" />
                Close {period.name}
              </button>
            )}
            {closable && failing.length > 0 && (
              <p className="text-xs text-danger">{failing.length} {failing.length === 1 ? 'check is' : 'checks are'} not ready yet. You can close with a written reason for each.</p>
            )}
          </section>
        </aside>
      </div>

      {/* Close */}
      <Dialog open={modal === 'close'} onOpenChange={(o) => !o && !busy && setModal(null)}>
        <DialogContent className="max-w-[520px] p-6 rounded-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold"><Lock className="w-4 h-4 text-text-primary" /><span>Close {period.name}</span></DialogTitle>
            <DialogDescription className="text-xs">
              Closing <strong className="text-text-primary">{period.name}</strong> stops anyone adding journals, invoices or receipts to it. You can still ask to reopen it later.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2.5 text-xs text-text-secondary">
            {failing.length === 0 ? (
              <div className="p-3 bg-success-soft border border-success/30 rounded text-[11px] text-success font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" /><span>All checks are ready.</span>
              </div>
            ) : (
              <>
                <p className="text-[11px] font-semibold text-text-primary">These checks are not ready. Tick one to close anyway, and say why that is acceptable.</p>
                <ul className="flex flex-col gap-2">
                  {failing.map((c) => {
                    const w = waive[c.check_code] ?? { on: false, reason: '' };
                    return (
                      <li key={c.check_code} className="rounded-md border border-border p-3">
                        <label className="flex items-start gap-2">
                          <input type="checkbox" checked={w.on} onChange={(e) => { setProblem(null); setWaive({ ...waive, [c.check_code]: { ...w, on: e.target.checked } }); }} className="mt-0.5 h-4 w-4 cursor-pointer" aria-label={`Waive ${c.title}`} />
                          <span>
                            <span className="block text-[13px] font-medium text-text-primary">{c.title}</span>
                            <span className="block text-xs text-text-muted">{c.detail}</span>
                          </span>
                        </label>
                        {w.on && (
                          <input
                            value={w.reason}
                            onChange={(e) => { setProblem(null); setWaive({ ...waive, [c.check_code]: { ...w, reason: e.target.value } }); }}
                            placeholder="Why is this acceptable?"
                            aria-label={`Reason to waive ${c.title}`}
                            className="mt-2 h-8 w-full rounded-md border border-border bg-surface px-2 text-xs text-text-primary focus:outline-none focus:border-accent"
                          />
                        )}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {problem && <div className="rounded border border-danger/30 bg-danger-soft p-3 text-[11px] font-medium text-danger" role="alert">{problem}</div>}
          </div>
          <DialogFooter className="gap-2 pt-2 border-t border-border">
            <button type="button" onClick={() => setModal(null)} disabled={busy} className={btnGhost}>Cancel</button>
            <button type="button" disabled={busy || !waiveOk} onClick={() => void doClose()} className="h-8 px-3 rounded-md bg-text-primary hover:opacity-90 text-surface text-[13px] font-medium disabled:opacity-50 cursor-pointer">
              {busy ? 'Closing…' : 'Close month'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ask to reopen */}
      <Dialog open={modal === 'reopen'} onOpenChange={(o) => !o && !busy && setModal(null)}>
        <DialogContent className="max-w-[480px] p-6 rounded-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold"><Unlock className="w-4 h-4 text-accent" /><span>Ask to reopen {period.name}</span></DialogTitle>
            <DialogDescription className="text-xs">{period.name} is closed. Two other people have to approve reopening it.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-1">
            <label htmlFor="reopen-reason" className="text-[11px] font-semibold text-text-primary">Why do you need to reopen it?</label>
            <textarea id="reopen-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. the auditor asked for a correction" className="w-full p-2 text-xs bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
          </div>
          {problem && <div className="rounded border border-danger/30 bg-danger-soft p-3 text-[11px] font-medium text-danger" role="alert">{problem}</div>}
          <DialogFooter className="gap-2 pt-2 border-t border-border">
            <button type="button" onClick={() => setModal(null)} disabled={busy} className={btnGhost}>Cancel</button>
            <button type="button" onClick={() => void doRequestReopen()} disabled={busy || !reason.trim()} className="h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium disabled:opacity-50 cursor-pointer">Send request</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reject a reopen request */}
      <Dialog open={modal === 'reject'} onOpenChange={(o) => !o && !busy && setModal(null)}>
        <DialogContent className="max-w-[480px] p-6 rounded-lg">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Reject the request to reopen {period.name}</DialogTitle>
            <DialogDescription className="text-xs">The month stays closed. The person who asked will see your comment.</DialogDescription>
          </DialogHeader>
          <textarea rows={3} aria-label="Comment" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Say why you are rejecting it" className="w-full p-2 text-xs bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-1 focus:ring-accent" />
          {problem && <div className="rounded border border-danger/30 bg-danger-soft p-3 text-[11px] font-medium text-danger" role="alert">{problem}</div>}
          <DialogFooter className="gap-2 pt-2 border-t border-border">
            <button type="button" onClick={() => setModal(null)} disabled={busy} className={btnGhost}>Cancel</button>
            <button type="button" onClick={() => void doReject()} disabled={busy || !comment.trim()} className="h-8 px-3 rounded-md bg-danger text-white text-[13px] font-medium disabled:opacity-50 cursor-pointer">Reject request</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Year-end close */}
      <Dialog open={modal === 'year-end'} onOpenChange={(o) => !o && !busy && setModal(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold"><Lock className="w-4 h-4 text-accent" /><span>Year-end close for {year.name}</span></DialogTitle>
            <DialogDescription className="text-xs">
              {formatDate(year.starts_on)} to {formatDate(year.ends_on)}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-xs text-text-secondary">
            <p>
              This closes the year&apos;s income and expense accounts into retained earnings with one closing journal. The server works out the amounts when you sign; every month of the year has to be closed first.
            </p>
            <div className="p-2.5 bg-surface-neutral border border-border rounded text-[11px] text-text-muted">The entry is numbered in sequence and recorded in the activity log.</div>
            {problem && <div className="rounded border border-danger/30 bg-danger-soft p-3 text-[11px] font-medium text-danger" role="alert">{problem}</div>}
          </div>
          <DialogFooter className="gap-2 pt-2 border-t border-border">
            <button type="button" onClick={() => setModal(null)} disabled={busy} className={btnGhost}>Cancel</button>
            <button type="button" disabled={busy} onClick={() => void doYearEnd()} className="h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium disabled:opacity-50 cursor-pointer">{busy ? 'Posting…' : 'Post year-end entry'}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Lock the year */}
      <Dialog open={modal === 'lock'} onOpenChange={(o) => !o && !busy && setModal(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Lock {year.name}?</DialogTitle>
            <DialogDescription className="text-xs">Locking marks the year as final. The server refuses it while any month is still open.</DialogDescription>
          </DialogHeader>
          {problem && <div className="rounded border border-danger/30 bg-danger-soft p-3 text-[11px] font-medium text-danger" role="alert">{problem}</div>}
          <DialogFooter className="gap-2 pt-2 border-t border-border">
            <button type="button" onClick={() => setModal(null)} disabled={busy} className={btnGhost}>Cancel</button>
            <button type="button" disabled={busy} onClick={() => void doLock()} className={cn('h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium disabled:opacity-50 cursor-pointer')}>Lock year</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <NewFiscalYear open={addingYear} onClose={() => setAddingYear(false)} suggestedStart={nextDay(years.map((y) => y.ends_on).sort().at(-1))} />

      <SignDialog {...signed.signProps} documentTitle={signCtx?.title ?? ''} actionTitle={signCtx?.actionTitle} consequenceText={signCtx?.consequence} />
    </div>
  );
};
