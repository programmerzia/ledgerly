import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Eye, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useLedgerStore } from '@/mock/store';
import { PageHeader } from '@/components/domain/PageHeader';
import { LineGrid, type GridLineItem } from '@/components/domain/LineGrid';
import { FieldHelp } from '@/components/domain/FieldHelp';
import { SignDialog } from '@/components/domain/SignDialog';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatMoney } from '@/lib/format';
import { useAccounts } from '@/data/accounts';
import { useFetchJournal, useJournal, useJournalActions, useJournalRefs, type LiveJournal } from '@/data/journals';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import { describeViolation } from '@/api/violations';
import { IntentSlot } from '@/api/intentSlot';
import { toApiDate } from '@/api/adapters/dates';
import {
  splitFieldErrors,
  splitViolations,
  toJournalRequest,
  toPostingPreview,
  type JournalDraftInput,
  type LiveJournalLine,
  type PostingPreview,
} from '@/api/adapters/journal';
import type { Violation } from '@/api/errors';
import { ErrorLine, LoadingLine, inputClass } from './parts';

const blankLine = (n: number): GridLineItem => ({ id: `jl-${Date.now()}-${n}`, line_no: n, account_id: '', description: '', debit: 0, credit: 0, dimensions: {} });

const toGrid = (lines: LiveJournalLine[]): GridLineItem[] =>
  lines.map((l, i) => ({
    id: l.id,
    line_no: i + 1,
    account_id: l.account_id,
    description: l.description,
    debit: l.debit,
    credit: l.credit,
    dimensions: l.dimensions,
    extraDimensions: l.extraDimensions,
  }));

/** The new-journal form against the API: a server draft, a server preview, a server verdict on submit. */
const JournalFormInner: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const draftParam = params.get('draft') ?? undefined;
  const company = useLedgerStore((s) => s.currentCompany);
  const coSlug = company.slug;
  const accounts = useAccounts();
  const refs = useJournalRefs();
  const existing = useJournal(draftParam);
  const fetchJournal = useFetchJournal();
  const actions = useJournalActions();
  const { run, signProps } = useSignedRun();

  const [journalDate, setJournalDate] = useState(() => toApiDate(new Date()));
  const [periodId, setPeriodId] = useState('');
  const [reference, setReference] = useState('');
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<GridLineItem[]>([blankLine(1), blankLine(2)]);
  const [draft, setDraft] = useState<{ id: string; version: number } | null>(null);
  const [savedSig, setSavedSig] = useState<string | null>(null);

  const [busy, setBusy] = useState<null | 'save' | 'preview' | 'submit'>(null);
  const [preview, setPreview] = useState<PostingPreview | null>(null);
  const [headerErrors, setHeaderErrors] = useState<string[]>([]);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [savedLines, setSavedLines] = useState<LiveJournalLine[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [justLoaded, setJustLoaded] = useState(false);

  const saveSlot = useRef(new IntentSlot()).current;
  const submitSlot = useRef(new IntentSlot()).current;
  const previewSlot = useRef(new IntentSlot()).current;

  // Load an existing draft once (?draft=ID): "Edit draft", "Duplicate" and a journal that was sent back all land here.
  const loaded = useRef(false);
  useEffect(() => {
    const j = existing.data;
    if (!j || loaded.current) return;
    if (j.status !== 'draft') return;
    loaded.current = true;
    hydrate(j);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  function hydrate(j: LiveJournal) {
    setJournalDate(j.journal_date);
    setPeriodId('');
    setReference(j.reference);
    setMemo(j.memo);
    setLines(toGrid(j.lines as LiveJournalLine[]));
    setDraft({ id: j.id, version: j.version ?? 0 });
    setSavedLines(j.lines as LiveJournalLine[]);
    setPreview(null);
    setHeaderErrors([]);
    setSavedSig(null);
    setJustLoaded(true);
  }

  const selectedPeriod = refs.periods.find((p) => p.id === periodId);
  const buildInput = (versionOverride?: number): JournalDraftInput => ({
    journal_date: journalDate,
    fiscal_period_id: periodId || undefined,
    journal_type: selectedPeriod?.kind === 'adjustment' ? 'adjustment' : 'manual',
    reference,
    memo,
    version: draft ? (versionOverride ?? draft.version) : undefined,
    lines: lines.map((l) => ({
      account_id: l.account_id,
      description: l.description,
      debit: l.debit,
      credit: l.credit,
      dimensions: l.dimensions,
      extraDimensions: l.extraDimensions,
    })),
  });
  const contentSig = useMemo(
    () => JSON.stringify(toJournalRequest({ ...buildInput(0), version: undefined }, refs.apiDimensions)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [journalDate, periodId, reference, memo, lines, refs.apiDimensions],
  );
  const dirty = draft === null || savedSig !== contentSig;

  // After a draft is loaded, what is on screen is what the server has.
  useEffect(() => {
    if (!justLoaded) return;
    setSavedSig(contentSig);
    setJustLoaded(false);
  }, [justLoaded, contentSig]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (lines.some((l) => l.account_id || l.debit || l.credit)) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, lines]);

  /* ----------------------------------------------------------- showing verdicts */

  const clearLineErrors = () => setLines((prev) => prev.map((l) => ({ ...l, errors: undefined })));

  const showViolations = (violations: Violation[]) => {
    const { header, byLine } = splitViolations(violations);
    setLines((prev) =>
      prev.map((l, i) => {
        const vs = byLine.get(i + 1);
        return vs ? { ...l, errors: Object.fromEntries(vs.map((v) => [v.code, describeViolation(v)])) } : { ...l, errors: undefined };
      }),
    );
    setHeaderErrors(header.map(describeViolation));
    if (violations.length > 0 && header.length === 0) setHeaderErrors([`This journal cannot be posted yet. See the highlighted lines.`]);
  };

  const showFieldErrors = (e: ApiError) => {
    const { header, byIndex } = splitFieldErrors(e.errors);
    setLines((prev) => prev.map((l, i) => ({ ...l, errors: byIndex.get(i) })));
    setHeaderErrors(header.map((h) => h.message));
  };

  /** Anything a call can throw -> a place on screen. Returns true if it was a 409 (the conflict dialog took over). */
  const showError = (e: unknown) => {
    if (isSigningCancelled(e)) return;
    if (e instanceof ApiError && e.isVersionConflict) {
      openConflict(e);
      return;
    }
    if (e instanceof ApiError && e.violations?.length) showViolations(e.violations);
    else if (e instanceof ApiError && e.isValidation) showFieldErrors(e);
    else setHeaderErrors([describeError(e)]);
  };

  /* ------------------------------------------------------------------- actions */

  /** Saves the form as the server's draft. Returns the saved journal, or null if the server refused it. */
  async function save(versionOverride?: number): Promise<LiveJournal | null> {
    setBusy('save');
    setHeaderErrors([]);
    clearLineErrors();
    const body = toJournalRequest(buildInput(versionOverride), refs.apiDimensions);
    const intent = saveSlot.for(JSON.stringify([draft?.id ?? null, body]));
    try {
      const api = draft ? await actions.update(draft.id, body, intent) : await actions.create(body, intent);
      saveSlot.clear();
      const j = refs.adapt(api);
      setDraft({ id: j.id, version: j.version ?? 0 });
      setSavedSig(contentSig);
      setSavedLines(j.lines as LiveJournalLine[]);
      setPreview(null);
      return j;
    } catch (e) {
      showError(e);
      return null;
    } finally {
      setBusy(null);
    }
  }

  const onSaveClick = async () => {
    setAttempted(true);
    const j = await save();
    if (j) toast.success('Draft saved');
  };

  /** Saves if needed, then asks the server what posting would do. */
  async function previewNow(): Promise<{ journal: { id: string; version: number }; preview: PostingPreview } | null> {
    let current = draft;
    if (dirty || !current) {
      const j = await save();
      if (!j) return null;
      current = { id: j.id, version: j.version ?? 0 };
    }
    setBusy('preview');
    try {
      const p = toPostingPreview(await actions.preview(current.id, previewSlot.for(`${current.id}:${current.version}`)));
      previewSlot.clear();
      setPreview(p);
      if (p.valid) {
        setHeaderErrors([]);
        clearLineErrors();
      } else showViolations(p.violations);
      return { journal: current, preview: p };
    } catch (e) {
      showError(e);
      return null;
    } finally {
      setBusy(null);
    }
  }

  const onPreviewClick = async () => {
    setAttempted(true);
    await previewNow();
  };

  const onSubmitClick = async () => {
    setAttempted(true);
    const res = await previewNow();
    if (res?.preview.valid) setReviewOpen(true);
  };

  const confirmSubmit = async () => {
    if (!draft) return;
    setReviewOpen(false);
    setBusy('submit');
    const { id, version } = draft;
    const intent = submitSlot.for(`${id}:${version}`);
    try {
      const j = refs.adapt(await run(() => actions.submit(id, version, intent)));
      submitSlot.clear();
      toast.success(j.status === 'posted' ? `Posted as ${j.number ?? 'a numbered journal'}` : 'Sent for approval. It posts when an approver signs it.');
      navigate(`/${coSlug}/journals/${j.id}`);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  };

  /* ------------------------------------------------------------------ conflicts */

  function openConflict(e: ApiError) {
    const serverVersion = e.serverVersion;
    const local = draft?.version;
    const goReload = async () => {
      setConflict(null);
      if (!draft) return;
      try {
        hydrate(await fetchJournal(draft.id));
        toast.success('Loaded the saved version');
      } catch (err) {
        showError(err);
      }
    };
    setConflict({
      noun: 'journal',
      serverVersion,
      localVersion: local,
      onClose: () => setConflict(null),
      onReload: () => void goReload(),
      onOverwrite:
        draft && typeof serverVersion === 'number'
          ? () => {
              setConflict(null);
              void save(serverVersion).then((j) => j && toast.success('Saved over the other change'));
            }
          : undefined,
      onKeepBoth: async () => {
        setConflict(null);
        const body = toJournalRequest({ ...buildInput(0), version: undefined }, refs.apiDimensions);
        try {
          const api = await actions.create(body, new IntentSlot().for('copy'));
          toast.success('Your version was saved as a new draft');
          navigate(`/${coSlug}/journals/new?draft=${api.id}`);
        } catch (err) {
          showError(err);
        }
      },
    });
  }

  /* --------------------------------------------------------------------- render */

  if (draftParam && existing.isLoading) return <LoadingLine what="draft" />;
  if (draftParam && existing.error) return <ErrorLine error={existing.error} onRetry={existing.refetch} />;
  if (draftParam && existing.data && existing.data.status !== 'draft') {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
        This journal is {existing.data.status.replace('_', ' ')}, so it can no longer be edited.{' '}
        <button type="button" className="text-accent hover:underline" onClick={() => navigate(`/${coSlug}/journals/${existing.data?.id}`)}>
          Open it
        </button>
      </div>
    );
  }

  // Display-only hint: integer minor units, summed as typed. The server re-validates on preview and submit.
  const hintDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const hintCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
  const accountOf = (id: string) => accounts.data.find((a) => a.id === id);
  const periodWarning = preview?.period && preview.period.status && preview.period.status !== 'open' ? preview.period : null;
  const working = busy !== null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumb={[{ label: 'Journals', to: `/${coSlug}/journals` }, { label: draft ? 'Edit draft' : 'New journal' }]}
        title={draft ? 'Edit draft journal' : 'New manual journal'}
        subtitle={draft ? (dirty ? 'Draft · unsaved changes' : 'Draft · saved') : 'Not saved yet'}
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void onSaveClick()}
              disabled={working || !dirty}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition hover:bg-surface-neutral disabled:opacity-50"
            >
              <Save className="size-4 text-text-muted" />
              {busy === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            <button
              type="button"
              onClick={() => void onPreviewClick()}
              disabled={working}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition hover:bg-surface-neutral disabled:opacity-50"
            >
              <Eye className="size-4 text-text-muted" />
              {busy === 'preview' ? 'Checking…' : 'Preview posting'}
            </button>
            <button
              type="button"
              onClick={() => void onSubmitClick()}
              disabled={working}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send className="size-4" />
              {busy === 'submit' ? 'Submitting…' : 'Submit journal'}
            </button>
          </div>
        }
      />

      {attempted && headerErrors.length > 0 && (
        <div role="alert" data-testid="journal-errors" className="flex flex-col gap-1.5 rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs font-medium text-danger">
          {headerErrors.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              <span>{m}</span>
            </div>
          ))}
        </div>
      )}

      {periodWarning && (
        <div className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-xs text-danger">
          <span className="font-semibold">{periodWarning.name}</span> is {String(periodWarning.status).replace('_', ' ')}. The server will not post to it unless the period is reopened.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 md:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="jf-date" className="flex items-center text-xs font-medium text-text-secondary">
            Journal date
            <FieldHelp help="The posting date. The server finds the accounting period from it." example="2026-10-28" />
          </label>
          <input id="jf-date" type="date" value={journalDate} onChange={(e) => setJournalDate(e.target.value)} className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="jf-period" className="flex items-center text-xs font-medium text-text-secondary">
            Accounting period
            <FieldHelp help="Leave on Auto to use the period that covers the date. Choose an adjustment period explicitly." example="Auto" />
          </label>
          <select id="jf-period" value={periodId} onChange={(e) => setPeriodId(e.target.value)} className={inputClass}>
            <option value="">Auto (from the date)</option>
            {refs.periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.status.replace('_', ' ')})
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="jf-ref" className="flex items-center text-xs font-medium text-text-secondary">
            Reference
            <FieldHelp help="An internal voucher or document reference." example="ADJ-OCT-REALLOC" />
          </label>
          <input id="jf-ref" type="text" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. ADJ-OCT-REALLOC" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-text-secondary">Currency</span>
          <div className="flex h-8 items-center whitespace-nowrap rounded-md border border-border bg-surface-neutral px-2.5 text-xs text-text-secondary">
            {company.base_currency} · base currency
          </div>
        </div>
        <div className="flex flex-col gap-1 md:col-span-4">
          <label htmlFor="jf-memo" className="flex items-center text-xs font-medium text-text-secondary">
            Memo
            <FieldHelp help="Why this entry is needed. It is kept with the journal." example="Monthly departmental expense reallocation" />
          </label>
          <input id="jf-memo" type="text" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="Explain why this entry is needed" className={inputClass} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-text-primary">Lines</span>
          <span className="text-[11px] text-text-muted">Tab to move between fields · ⌘ Enter adds a line</span>
        </div>
        {accounts.isLoading ? (
          <LoadingLine what="accounts" />
        ) : accounts.error ? (
          <ErrorLine error={accounts.error} onRetry={accounts.refetch} />
        ) : (
          <LineGrid mode="journal" lines={lines} onChange={setLines} accounts={accounts.data} dimensions={refs.dimensions} currency={company.base_currency} showTotals={false} />
        )}
        <div className="flex items-center justify-end gap-2 pt-1 text-xs text-text-secondary">
          <span>
            Entered debits <span className="tabular-nums text-text-primary">{formatMoney(hintDebit, company.base_currency)}</span>
          </span>
          <span className="text-text-muted">·</span>
          <span>
            credits <span className="tabular-nums text-text-primary">{formatMoney(hintCredit, company.base_currency)}</span>
          </span>
          <span className="text-text-muted">·</span>
          <span className="text-text-muted">The server checks that they balance when you preview or submit.</span>
        </div>
      </div>

      {preview && (
        <section aria-label="Posting preview" data-testid="posting-preview" className="rounded-lg border border-border bg-surface p-4 text-[13px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-primary">Posting preview</h3>
            {preview.valid ? (
              <span className="flex items-center gap-1 text-xs font-medium text-success">
                <CheckCircle2 className="size-3.5" /> The server would accept this
              </span>
            ) : (
              <span className="text-xs font-medium text-danger">The server would refuse this</span>
            )}
          </div>
          <dl className="mt-3 grid gap-x-8 gap-y-2 sm:grid-cols-3">
            <div>
              <dt className="text-[11px] font-semibold text-text-muted">Period</dt>
              <dd className="text-text-primary">{preview.period?.name ? `${preview.period.name} (${String(preview.period.status ?? '').replace('_', ' ')})` : 'None found for this date'}</dd>
            </div>
            {/* The server reports totals only for a plan it can build, so a refused journal shows none rather than zero. */}
            <div>
              <dt className="text-[11px] font-semibold text-text-muted">Total debits</dt>
              <dd className="tabular-nums text-text-primary">{preview.valid ? formatMoney(preview.totalDebit, company.base_currency) : '—'}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-semibold text-text-muted">Total credits</dt>
              <dd className="tabular-nums text-text-primary">{preview.valid ? formatMoney(preview.totalCredit, company.base_currency) : '—'}</dd>
            </div>
          </dl>
          {preview.violations.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 text-xs text-danger">
              {preview.violations.map((v, i) => (
                <li key={i}>
                  {typeof v.line_no === 'number' ? `Line ${v.line_no}: ` : ''}
                  {describeViolation(v)}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader className="gap-1.5 border-b border-border pb-2">
            <DialogTitle className="text-base font-semibold text-text-primary">Submit this journal</DialogTitle>
            <DialogDescription className="text-xs text-text-muted">
              If your company has an approval rule for journals it goes to an approver. Otherwise it posts now and asks for your PIN. Posted journals cannot be edited, only reversed.
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <div className="flex flex-col gap-2 text-xs text-text-secondary" data-testid="submit-review">
              <div className="flex justify-between">
                <span>Period</span>
                <span className="text-text-primary">{preview.period?.name ?? '—'}</span>
              </div>
              <div className="flex justify-between">
                <span>Debits</span>
                <span className="tabular-nums text-text-primary">{formatMoney(preview.totalDebit, company.base_currency)}</span>
              </div>
              <div className="flex justify-between">
                <span>Credits</span>
                <span className="tabular-nums text-text-primary">{formatMoney(preview.totalCredit, company.base_currency)}</span>
              </div>
              <div className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border">
                <table className="w-full text-left text-[11px]">
                  <thead>
                    <tr className="border-b border-border bg-surface-neutral text-[10px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                      <th className="px-2 py-1">Account</th>
                      <th className="w-24 px-2 py-1 text-right">Debit</th>
                      <th className="w-24 px-2 py-1 text-right">Credit</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {savedLines.map((l) => (
                      <tr key={l.line_no}>
                        <td className="px-2 py-1.5">
                          {accountOf(l.account_id)?.code} {accountOf(l.account_id)?.name}
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{l.debit > 0 ? formatMoney(l.debit, company.base_currency) : ''}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{l.credit > 0 ? formatMoney(l.credit, company.base_currency) : ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <DialogFooter className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setReviewOpen(false)} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral">
              Cancel
            </button>
            <button type="button" onClick={() => void confirmSubmit()} className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover">
              Submit journal
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SignDialog
        {...signProps}
        documentTitle={`Journal: ${memo || reference || 'manual entry'}`}
        amount={preview?.totalDebit}
        currency={company.base_currency}
        periodName={preview?.period?.name ?? undefined}
        actionTitle="Sign and post"
        consequenceText="Nobody else needs to approve this journal under your company rules, so it posts now with the next journal number. Mistakes are fixed later with a reversal."
      />
      <ConflictDialog conflict={conflict} />
    </div>
  );
};

/** Keyed by the draft id so moving to another draft (duplicate, keep both) starts the form fresh. */
export const JournalFormLive: React.FC = () => {
  const [params] = useSearchParams();
  return <JournalFormInner key={params.get('draft') ?? 'new'} />;
};
