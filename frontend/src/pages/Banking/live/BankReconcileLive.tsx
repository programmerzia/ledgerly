import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Ban, Check, CheckCircle2, Clock, Link2, Settings2, Undo2, Upload } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { SignDialog } from '@/components/domain/SignDialog';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatDate, formatMoney } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { recalledReconciliation, rememberReconciliation, useBankAccounts, useBankingActions, useLineSuggestions, useReconciliation, useReconciliations, useAccountLines, useStatements, useChartAccounts } from '@/data/banking';
import { IntentSlot } from '@/api/intentSlot';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import { bankingErrorText, describeExplanation, describeImportWarning, lineTitle, transactionOutcome, type LiveBankLine, type LiveReconciliation } from '@/api/adapters/banking';
import { ErrorLine, LoadingLine, verdictText } from '@/pages/Accounting/live/parts';
import { CodeLineForm } from './CodeLineForm';
import { CreateDocFromLine } from './CreateDocFromLine';
import { usePaymentRunList } from '@/data/paymentRuns';

type Filter = 'to_match' | 'waiting' | 'matched' | 'excluded';

const paneCard = 'flex flex-col overflow-hidden rounded-lg border border-border bg-surface';
const rowBase = 'relative w-full px-4 py-3 text-left outline-none transition-colors duration-150 focus-visible:bg-accent-soft/50';
const btnSecondary = 'flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-neutral hover:text-text-primary disabled:opacity-50';
const btnPrimary = 'flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50';

/** Sum of integer minor units for the "your selection" labels. The server checks the match; this never gates it. */
const sumOf = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

export const BankReconcileLive: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [params, setParams] = useSearchParams();
  const company = useRouteCompany();
  const banks = useBankAccounts();
  const accounts = useChartAccounts();
  const actions = useBankingActions();
  const { run, signProps } = useSignedRun();

  const bank = banks.data.find((b) => b.id === id);
  const statements = useStatements(id);
  const recs = useReconciliations(id);

  const latest = useMemo(() => [...statements.data].sort((a, b) => (b.period_to ?? '').localeCompare(a.period_to ?? ''))[0], [statements.data]);
  const statementId = params.get('statement') ?? latest?.id;
  const statement = statements.data.find((s) => s.id === statementId);
  const recalled = recalledReconciliation(company.id, statementId);
  const recId = recs.data.find((r) => r.statement_id === statementId)?.id ?? (recs.error ? recalled : undefined);
  const recQuery = useReconciliation(recId);
  const rec: LiveReconciliation | null = recQuery.data ?? null;
  const linesQ = useAccountLines(id);
  // Same scope as the server's report: every statement up to and including the chosen one.
  const scope = useMemo(
    () => new Set(statements.data.filter((s) => statement && (s.period_to ?? '') <= (statement.period_to ?? '')).map((s) => s.id)),
    [statements.data, statement],
  );
  const lines = useMemo(() => linesQ.data.filter((l) => scope.has(l.statement_id)), [linesQ.data, scope]);

  const [filter, setFilter] = useState<Filter>('to_match');
  const [tab, setTab] = useState<'match' | 'create' | 'document'>('match');
  const [activePick, setActiveId] = useState<string | null>(null);
  const [pickedLines, setPickedLines] = useState<Set<string>>(new Set());
  const [pickedBook, setPickedBook] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishError, setFinishError] = useState('');
  const [reopenOpen, setReopenOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reopenError, setReopenError] = useState('');
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [justFinished, setJustFinished] = useState(false);
  const matchSlot = useRef(new IntentSlot()).current;
  const unmatchSlot = useRef(new IntentSlot()).current;
  const startSlot = useRef(new IntentSlot()).current;
  const finishSlot = useRef(new IntentSlot()).current;
  const reopenSlot = useRef(new IntentSlot()).current;
  const ruleSlot = useRef(new IntentSlot()).current;
  const excludeSlot = useRef(new IntentSlot()).current;
  const restoreSlot = useRef(new IntentSlot()).current;
  const [excludeTarget, setExcludeTarget] = useState<LiveBankLine | null>(null);
  const [excludeReason, setExcludeReason] = useState('');
  const [excludeError, setExcludeError] = useState('');

  const toMatch = lines.filter((l) => l.status === 'unmatched' && !l.pending_journal_id);
  const waiting = lines.filter((l) => l.status === 'unmatched' && l.pending_journal_id);
  const matched = lines.filter((l) => l.status === 'matched');
  const excluded = lines.filter((l) => l.status === 'excluded');
  const shown = filter === 'to_match' ? toMatch : filter === 'waiting' ? waiting : filter === 'excluded' ? excluded : matched;
  // The focused line: the one picked if it is still in this list, else the first line that needs work.
  const activeId = lines.some((l) => l.id === activePick && (filter !== 'to_match' || toMatch.some((m) => m.id === l.id))) ? activePick : filter === 'to_match' ? (toMatch[0]?.id ?? null) : null;
  const active = lines.find((l) => l.id === activeId) ?? null;
  const finished = rec?.status === 'finished';
  const openLine = active !== null && active.status === 'unmatched' && !active.pending_journal_id;
  // Posted payment runs paid from this bank account: a line for money out may be the whole run (plan 3c.35).
  const runs = usePaymentRunList({ status: 'posted' });
  const runsHere = runs.rows.filter((r) => r.bank_account_id === id);
  const runSlot = useRef(new IntentSlot()).current;
  const suggestions = useLineSuggestions(active && active.status === 'unmatched' && !active.pending_journal_id ? active.id : undefined);
  const currency = bank?.currency ?? company.base_currency;

  const bookItems = rec?.report?.unmatched_book_items ?? [];
  const suggested = suggestions.data?.matches ?? [];
  const suggestedIds = new Set(suggested.map((m) => m.journal_line_id));
  const settlementOf = new Map(suggested.filter((m) => m.settlement_id).map((m) => [m.journal_line_id, m.settlement_id as string]));
  const otherItems = bookItems.filter((b) => !suggestedIds.has(b.journal_line_id));
  const amountOfBook = new Map<string, number>([...bookItems.map((b) => [b.journal_line_id, b.amount] as const), ...suggested.map((m) => [m.journal_line_id, m.amount] as const)]);

  const chosenLines = pickedLines.size ? toMatch.filter((l) => pickedLines.has(l.id)) : active && toMatch.some((l) => l.id === active.id) ? [active] : [];
  const chosenBook = [...pickedBook].filter((x) => amountOfBook.has(x));
  const linesTotal = sumOf(chosenLines.map((l) => l.amount));
  const bookTotal = sumOf(chosenBook.map((x) => amountOfBook.get(x) ?? 0));

  const accountLabel = (accId: string) => {
    const a = accounts.data.find((x) => x.id === accId);
    return a ? `${a.code} ${a.name}` : 'the chosen account';
  };

  const toggle = (set: Set<string>, key: string): Set<string> => {
    const n = new Set(set);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    return n;
  };

  const fail = (e: unknown) => {
    if (!isSigningCancelled(e)) toast.error(bankingErrorText(e, verdictText));
  };

  const start = async () => {
    if (!statementId) return;
    setBusy(true);
    try {
      const started = await actions.startReconciliation(statementId, startSlot.for(statementId));
      rememberReconciliation(company.id, statementId, started.id);
      startSlot.clear();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const doMatch = async () => {
    if (chosenLines.length === 0 || chosenBook.length === 0) return;
    const settlementIds = chosenBook.map((x) => settlementOf.get(x)).filter((x): x is string => Boolean(x));
    const journalLineIds = chosenBook.filter((x) => !settlementOf.has(x));
    const body = {
      statement_line_ids: chosenLines.map((l) => l.id),
      ...(journalLineIds.length ? { journal_line_ids: journalLineIds } : {}),
      ...(settlementIds.length ? { settlement_ids: settlementIds } : {}),
    };
    setBusy(true);
    try {
      await actions.match(body, matchSlot.for(JSON.stringify(body)));
      matchSlot.clear();
      toast.success('Matched.');
      setPickedLines(new Set());
      setPickedBook(new Set());
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  /** One statement line against every payment of a run. The server adds the payments up and refuses anything but an exact match. */
  const matchRun = async (runId: string) => {
    if (!active) return;
    const body = { statement_line_ids: [active.id], payment_run_id: runId };
    setBusy(true);
    try {
      await actions.match(body, runSlot.for(JSON.stringify(body)));
      runSlot.clear();
      toast.success('Matched to the whole payment run.');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const unmatch = async (l: LiveBankLine) => {
    if (!l.match_id) return;
    setBusy(true);
    try {
      await actions.unmatch(l.match_id, unmatchSlot.for(l.match_id));
      unmatchSlot.clear();
      toast.success('Match removed. The line is open again.');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const openExclude = (l: LiveBankLine) => {
    setExcludeTarget(l);
    setExcludeReason('');
    setExcludeError('');
  };

  const exclude = async () => {
    if (!excludeTarget) return;
    const reason = excludeReason.trim();
    if (!reason) return setExcludeError('Give a reason for leaving this line out of the books.');
    setBusy(true);
    setExcludeError('');
    try {
      await actions.excludeLine(excludeTarget.id, reason, excludeTarget.version, excludeSlot.for(`${excludeTarget.id}:${excludeTarget.version}:${reason}`));
      excludeSlot.clear();
      setExcludeTarget(null);
      toast.success('Line excluded. It stays on the statement but is not in your books.');
    } catch (e) {
      setExcludeError(isSigningCancelled(e) ? '' : bankingErrorText(e, verdictText));
    } finally {
      setBusy(false);
    }
  };

  const putBack = async (l: LiveBankLine) => {
    setBusy(true);
    try {
      await actions.restoreLine(l.id, l.version, restoreSlot.for(`${l.id}:${l.version}`));
      restoreSlot.clear();
      toast.success('Line put back. It is open to match again.');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const acceptRule = async () => {
    const r = suggestions.data?.rule;
    if (!active || !r) return;
    setBusy(true);
    try {
      const t = await run(() => actions.applyRule(active.id, r.id, ruleSlot.for(`${active.id}:${r.id}`)));
      ruleSlot.clear();
      toast.success(transactionOutcome(t) === 'waiting' ? 'Sent for approval. The line leaves your to-do list until it is approved.' : `Recorded as ${t.journal_number ?? 'a journal entry'} using the rule "${r.name}".`);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const conflictFrom = (e: ApiError, again: (version: number) => void) =>
    setConflict({
      noun: 'reconciliation',
      serverVersion: e.serverVersion,
      localVersion: rec?.version,
      onReload: () => {
        setConflict(null);
        recQuery.refetch();
      },
      onOverwrite: typeof e.serverVersion === 'number' ? () => { setConflict(null); again(e.serverVersion as number); } : undefined,
      onClose: () => { setConflict(null); recQuery.refetch(); },
    });

  const finish = async (versionOverride?: number) => {
    if (!rec) return;
    setBusy(true);
    setFinishError('');
    const version = versionOverride ?? rec.version;
    try {
      await actions.finishReconciliation(rec.id, version, finishSlot.for(`${rec.id}:${version}`));
      finishSlot.clear();
      setFinishOpen(false);
      setJustFinished(true);
    } catch (e) {
      if (e instanceof ApiError && e.isVersionConflict) {
        setFinishOpen(false);
        conflictFrom(e, (v) => void finish(v));
      } else setFinishError(bankingErrorText(e, verdictText));
    } finally {
      setBusy(false);
    }
  };

  const reopen = async (versionOverride?: number) => {
    if (!rec) return;
    if (!reason.trim()) return setReopenError('Give a reason for reopening.');
    setBusy(true);
    setReopenError('');
    const version = versionOverride ?? rec.version;
    try {
      await actions.reopenReconciliation(rec.id, reason.trim(), version, reopenSlot.for(`${rec.id}:${version}:${reason.trim()}`));
      reopenSlot.clear();
      setReopenOpen(false);
      setReason('');
      setJustFinished(false);
      toast.success('Reconciliation reopened. Matches can change again.');
    } catch (e) {
      if (e instanceof ApiError && e.isVersionConflict) {
        setReopenOpen(false);
        conflictFrom(e, (v) => void reopen(v));
      } else setReopenError(bankingErrorText(e, describeError));
    } finally {
      setBusy(false);
    }
  };

  // J/K move through the lines to match, C and M switch the tab.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role="dialog"]')) return;
      const idx = toMatch.findIndex((l) => l.id === activeId);
      if (e.key === 'j' || e.key === 'ArrowDown') {
        const n = toMatch[Math.min(idx + 1, toMatch.length - 1)];
        if (n) { e.preventDefault(); setActiveId(n.id); }
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        const n = toMatch[Math.max(idx - 1, 0)];
        if (n) { e.preventDefault(); setActiveId(n.id); }
      } else if (e.key === 'c') setTab('create');
      else if (e.key === 'b') setTab('document');
      else if (e.key === 'm') setTab('match');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (banks.isLoading || statements.isLoading || recs.isLoading) return <LoadingLine what="the reconciliation" />;
  if (banks.error) return <ErrorLine error={banks.error} onRetry={banks.refetch} />;
  if (!bank) return <p className="p-4 text-[13px] text-text-muted">That bank account was not found in this company. <Link to={`/${company.slug}/banking`} className="text-accent hover:underline">Back to bank accounts</Link></p>;
  if (statements.error) return <ErrorLine error={statements.error} onRetry={statements.refetch} />;

  const diff = rec?.difference ?? null;
  const rep = rec?.report ?? null;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumb={[{ label: 'Bank & cash', to: `/${company.slug}/banking` }, { label: bank.name }]}
        title="Reconcile bank account"
        subtitle="Pair each bank statement line with the matching entry in your books, until nothing is left over."
        actions={
          <>
            <Link to={`/${company.slug}/banking/rules`} className={btnSecondary}>
              <Settings2 className="size-4 text-text-muted" /> Rules
            </Link>
            <Link to={`/${company.slug}/banking/import?account=${bank.id}`} className={btnSecondary}>
              <Upload className="size-4 text-text-muted" /> Import statement
            </Link>
            {rec && !finished && (
              <button type="button" disabled={!rec.can.finish || busy || (rep?.unmatched_statement.count ?? 0) > 0} onClick={() => { setFinishError(''); setFinishOpen(true); }} className="flex h-8 items-center gap-1.5 rounded-md bg-success px-3 text-[13px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50">
                <CheckCircle2 className="size-4" /> Finish reconciliation
              </button>
            )}
            {rec && finished && rec.can.reopen && (
              <button type="button" disabled={busy} onClick={() => { setReopenError(''); setReopenOpen(true); }} className={btnSecondary}>
                <Undo2 className="size-4 text-text-muted" /> Reopen
              </button>
            )}
          </>
        }
      />

      {!statement ? (
        <div className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
          No statement has been imported for {bank.name} yet. <Link to={`/${company.slug}/banking/import?account=${bank.id}`} className="text-accent hover:underline">Import one</Link> to start reconciling.
        </div>
      ) : (
        <>
          {statements.data.length > 1 && (
            <label className="flex items-center gap-2 text-xs text-text-secondary">
              Statement
              <select
                aria-label="Statement"
                value={statement.id}
                onChange={(e) => { setParams({ statement: e.target.value }); setActiveId(null); setPickedLines(new Set()); setPickedBook(new Set()); }}
                className="h-8 rounded-md border border-border bg-surface px-2 text-xs text-text-primary"
              >
                {statements.data.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatDate(s.period_from)} to {formatDate(s.period_to)} · {s.line_count} lines
                  </option>
                ))}
              </select>
            </label>
          )}

          {statement.warnings.map((w) => (
            <p key={w} className="rounded-md bg-warning-soft px-3 py-2 text-xs text-warning">
              {describeImportWarning(w)}
            </p>
          ))}
          {justFinished && finished && (
            <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-[13px] text-success" data-testid="finished-note">
              Reconciliation finished. Its matches are now locked.{' '}
              <Link to={`/${company.slug}/periods`} className="font-medium underline">Check the period close list</Link>
            </p>
          )}
          {finished && !justFinished && (
            <p className="rounded-md bg-surface-neutral px-3 py-2 text-[13px] text-text-secondary">
              Finished {formatDate(rec?.finished_at)}. Matches are locked until it is reopened.
              {rec && rec.reopen_count > 0 ? ` Reopened ${rec.reopen_count} ${rec.reopen_count === 1 ? 'time' : 'times'}; last reason: ${rec.reopen_reason}.` : ''}
            </p>
          )}

          <div className="rounded-lg border border-border bg-surface px-5 py-4" data-testid="recon-progress">
            {!rec ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-[13px] text-text-secondary">
                    Start the reconciliation to see the difference between this statement and your books, and every entry in your books that is not matched yet.
                  </p>
                  {Boolean(recs.error) && !recalled && (
                    <div data-testid="recs-error">
                      <ErrorLine error={recs.error} onRetry={recs.refetch} />
                      <p className="px-4 text-xs text-text-muted">Existing reconciliations could not be listed, so if this statement already has one, starting will say so.</p>
                    </div>
                  )}
                </div>
                <button type="button" disabled={busy || !bank.can.reconcile} onClick={() => void start()} className={btnPrimary}>
                  Start reconciliation
                </button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                <div>
                  <div className="text-xs text-text-muted">Difference</div>
                  <div className={cn('mt-0.5 flex items-center gap-2 text-[22px] leading-7 font-medium tabular-nums', diff === 0 ? 'text-success' : diff === null ? 'text-text-muted' : 'text-warning')} data-testid="recon-difference">
                    {diff === null ? '—' : formatMoney(diff, currency)}
                    {diff === 0 && <span className="text-xs font-normal text-success">Statement and books agree</span>}
                    {diff !== null && diff !== 0 && <span className="text-xs font-normal text-text-muted">must be zero to finish</span>}
                    {diff === null && <span className="text-xs font-normal text-text-muted">the statement has no closing balance</span>}
                  </div>
                </div>
                <Figure label="Statement closing balance" value={rep?.statement.closing_balance ?? null} currency={currency} />
                <Figure label="Books, adjusted" value={rep ? rep.adjusted_book_balance : null} currency={currency} />
                <Figure label="Money in on the statement" value={rep ? rep.statement.receipts : null} currency={currency} />
                <Figure label="Money out on the statement" value={rep ? rep.statement.payments : null} currency={currency} />
                <div className="text-xs text-text-muted">
                  <div>{rep?.unmatched_statement.count ?? 0} statement lines unmatched</div>
                  <div>{rep?.book.unmatched_count ?? 0} book entries unmatched</div>
                </div>
                {(rep?.excluded_statement.count ?? 0) > 0 && (
                  <div className="text-xs text-text-muted" data-testid="excluded-figure">
                    <div>{rep?.excluded_statement.count} statement {rep?.excluded_statement.count === 1 ? 'line' : 'lines'} excluded</div>
                    <div className="tabular-nums">{formatMoney(rep?.excluded_statement.total ?? 0, currency)} left out of the books</div>
                  </div>
                )}
                {(rep?.unmatched_statement.count ?? 0) > 0 && !finished && (
                  <p className="basis-full text-xs text-text-muted" data-testid="unmatched-note">
                    {diff === 0 ? 'The difference is zero, but ' : ''}{rep?.unmatched_statement.count} statement {rep?.unmatched_statement.count === 1 ? 'line is' : 'lines are'} not matched yet, so Finish is off. Match each one, record it, or exclude it with a reason.
                  </p>
                )}
              </div>
            )}
          </div>

          {linesQ.error ? (
            <ErrorLine error={linesQ.error} onRetry={linesQ.refetch} />
          ) : (
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <section className={paneCard} aria-label="Bank statement lines">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-text-primary">From your bank</h2>
                  <div className="inline-flex rounded-lg bg-surface-neutral p-0.5" role="tablist">
                    {(
                      [
                        ['to_match', `To match ${toMatch.length}`],
                        ['waiting', `Waiting ${waiting.length}`],
                        ['matched', `Matched ${matched.length}`],
                        ['excluded', `Excluded ${rep?.excluded_statement.count ?? excluded.length}`],
                      ] as Array<[Filter, string]>
                    ).map(([k, label]) => (
                      <button key={k} type="button" role="tab" aria-selected={filter === k} onClick={() => setFilter(k)} className={cn('h-7 rounded-md px-2.5 text-xs font-medium', filter === k ? 'bg-surface-elevated text-text-primary' : 'text-text-muted hover:text-text-primary')}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="max-h-[460px] divide-y divide-border overflow-y-auto" data-testid="statement-lines">
                  {linesQ.isLoading && <LoadingLine what="statement lines" />}
                  {filter === 'excluded' && (
                    <p className="bg-surface-neutral/40 px-4 py-2 text-xs text-text-muted">
                      Excluded lines stay on the statement but are not in your books.
                      {rep && rep.excluded_statement.count > 0 ? ` ${rep.excluded_statement.count} ${rep.excluded_statement.count === 1 ? 'line' : 'lines'}, ${formatMoney(rep.excluded_statement.total, currency)} in all.` : ''}
                    </p>
                  )}
                  {!linesQ.isLoading && shown.length === 0 && (
                    <div className="px-4 py-12 text-center text-xs text-text-muted">
                      {filter === 'to_match' ? (toMatch.length === 0 && lines.length > 0 ? 'Every statement line is matched or recorded.' : 'No lines to match.') : filter === 'waiting' ? 'Nothing is waiting for approval.' : filter === 'excluded' ? 'No lines are excluded.' : 'Nothing matched yet.'}
                    </div>
                  )}
                  {shown.map((l) => {
                    const isActive = activeId === l.id;
                    return (
                      <div key={l.id} className={cn('flex items-stretch', isActive ? 'bg-surface-neutral' : 'hover:bg-canvas')} data-line={l.description}>
                        {filter === 'to_match' && (
                          <label className="flex cursor-pointer items-center pl-4">
                            <Checkbox checked={pickedLines.has(l.id)} onCheckedChange={() => setPickedLines((p) => toggle(p, l.id))} aria-label={`Select ${lineTitle(l)}`} />
                          </label>
                        )}
                        <button type="button" onClick={() => setActiveId(l.id)} aria-pressed={isActive} className={rowBase}>
                          {isActive && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
                          <div className="flex items-center justify-between gap-3">
                            <span className="truncate text-[13px] font-medium text-text-primary">{lineTitle(l)}</span>
                            <span className={cn('text-[13px] font-semibold tabular-nums', l.amount > 0 ? 'text-success' : 'text-text-primary')}>{formatMoney(l.amount, l.currency)}</span>
                          </div>
                          <div className="mt-0.5 flex items-center justify-between gap-3 text-xs text-text-muted">
                            <span className="truncate">{l.counterparty ? l.description : l.reference}</span>
                            <span className="shrink-0 tabular-nums">{formatDate(l.date)}</span>
                          </div>
                          {l.status === 'excluded' && l.excluded_reason && <span className="mt-1 block truncate text-xs text-text-secondary">Reason: {l.excluded_reason}</span>}
                          {l.pending_journal_id && (
                            <span className="mt-1.5 inline-flex items-center gap-1 rounded-[3px] bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">
                              <Clock className="size-3" /> Waiting for approval
                            </span>
                          )}
                        </button>
                        {l.pending_journal_id && (
                          <Link to={`/${company.slug}/journals/${l.pending_journal_id}`} className="flex items-center px-3 text-xs text-accent hover:underline">
                            View
                          </Link>
                        )}
                        {l.status === 'unmatched' && !l.pending_journal_id && l.can.exclude && (
                          <button type="button" disabled={busy || finished} title={finished ? 'Reopen the reconciliation to change lines' : undefined} onClick={() => openExclude(l)} className="flex shrink-0 items-center gap-1 whitespace-nowrap px-3 text-xs text-accent hover:underline disabled:cursor-not-allowed disabled:text-text-muted disabled:no-underline">
                            <Ban className="size-3" /> Exclude
                          </button>
                        )}
                        {l.status === 'excluded' && l.can.exclude && (
                          <button type="button" disabled={busy || finished} title={finished ? 'Reopen the reconciliation to change lines' : undefined} onClick={() => void putBack(l)} className="flex shrink-0 items-center gap-1 whitespace-nowrap px-3 text-xs text-accent hover:underline disabled:cursor-not-allowed disabled:text-text-muted disabled:no-underline">
                            <Undo2 className="size-3" /> Put back
                          </button>
                        )}
                        {l.status === 'matched' && l.match_id && (
                          <button type="button" disabled={busy || finished || !l.can.match} title={finished ? 'Reopen the reconciliation to change matches' : undefined} onClick={() => void unmatch(l)} className="flex shrink-0 items-center gap-1 whitespace-nowrap px-3 text-xs text-accent hover:underline disabled:cursor-not-allowed disabled:text-text-muted disabled:no-underline">
                            <Undo2 className="size-3" /> Unmatch
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className={paneCard} aria-label="Entries in your books">
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <h2 className="text-sm font-semibold text-text-primary">From your books</h2>
                  <span className="text-xs text-text-muted">not yet on a statement</span>
                </div>
                {suggestions.data?.rule && active && (
                  <div className="flex items-center gap-2 border-b border-border bg-surface-neutral/50 px-4 py-2 text-xs" data-testid="rule-suggestion">
                    <span className="min-w-0 truncate text-text-secondary">
                      Rule "{suggestions.data.rule.name}" would code this as <span className="font-medium text-text-primary">{accountLabel(suggestions.data.rule.action.account_id)}</span>
                    </span>
                    <button type="button" disabled={busy || !active.can.code} onClick={() => void acceptRule()} className="ml-auto flex h-6 shrink-0 items-center gap-1 rounded-md bg-accent px-2 text-[11px] font-medium text-white transition hover:bg-accent-hover disabled:opacity-50">
                      <Check className="size-3" /> Accept
                    </button>
                  </div>
                )}
                <Tabs value={tab} onValueChange={(v) => setTab(v as 'match' | 'create' | 'document')} className="flex flex-1 flex-col">
                  <div className="flex items-center justify-between border-b border-border px-4 py-2">
                    <TabsList>
                      <TabsTrigger value="match">Match</TabsTrigger>
                      <TabsTrigger value="create">Record</TabsTrigger>
                      {openLine && active && <TabsTrigger value="document">{active.amount < 0 ? 'New bill' : 'New invoice'}</TabsTrigger>}
                    </TabsList>
                  </div>
                  <TabsContent value="match" className="mt-0 flex flex-1 flex-col">
                    <div className="max-h-[400px] divide-y divide-border overflow-y-auto" data-testid="book-items">
                      {!rec && suggested.length === 0 && <div className="px-4 py-10 text-center text-xs text-text-muted">Start the reconciliation to list every entry in your books that is not matched yet.</div>}
                      {suggestions.isLoading && active && <LoadingLine what="suggestions" />}
                      {suggested.length > 0 && <div className="bg-surface-neutral/40 px-4 py-1.5 text-[11px] font-medium text-text-muted">Likely matches for the selected line</div>}
                      {suggested.map((m) => (
                        <BookRow key={m.journal_line_id} checked={pickedBook.has(m.journal_line_id)} onToggle={() => setPickedBook((p) => toggle(p, m.journal_line_id))} number={m.number} journalId={m.journal_id} slug={company.slug} description={m.description} date={m.date} amount={m.amount} currency={currency} hint={m.explanation.map(describeExplanation).join(', ')} />
                      ))}
                      {rec && otherItems.length > 0 && <div className="bg-surface-neutral/40 px-4 py-1.5 text-[11px] font-medium text-text-muted">Everything else not matched yet</div>}
                      {rec && bookItems.length === 0 && suggested.length === 0 && <div className="px-4 py-10 text-center text-xs text-text-muted">No book entries are waiting for a match.</div>}
                      {otherItems.map((b) => (
                        <BookRow key={b.journal_line_id} checked={pickedBook.has(b.journal_line_id)} onToggle={() => setPickedBook((p) => toggle(p, b.journal_line_id))} number={b.number} journalId={b.journal_id} slug={company.slug} description={b.description} date={b.date} amount={b.amount} currency={currency} />
                      ))}
                    </div>
                    {openLine && active && active.amount < 0 && runsHere.length > 0 && (
                      <div className="border-t border-border" data-testid="payment-runs">
                        <div className="bg-surface-neutral/40 px-4 py-1.5 text-[11px] font-medium text-text-muted">Payment runs paid from this account</div>
                        {runsHere.map((r) => {
                          const same = r.currency === active.currency && r.total_net === Math.abs(active.amount);
                          return (
                            <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]" data-run={r.number ?? r.id}>
                              <div className="min-w-0">
                                <Link to={`/${company.slug}/payment-run/${r.id}`} className="font-medium text-text-primary hover:underline">{r.number ?? 'Payment run'}</Link>
                                <span className="ml-2 text-xs tabular-nums text-text-muted">{formatDate(r.run_date)}</span>
                                {same && <span className="ml-2 rounded-[3px] bg-success-soft px-1.5 py-0.5 text-[11px] font-medium text-success">Same amount as this line</span>}
                              </div>
                              <div className="flex shrink-0 items-center gap-3">
                                <span className="font-semibold tabular-nums text-text-primary">{formatMoney(r.total_net, r.currency)}</span>
                                <button type="button" disabled={busy || finished || !active.can.match} onClick={() => void matchRun(r.id)} className={btnSecondary}>
                                  <Link2 className="size-4" /> Match whole run
                                </button>
                              </div>
                            </div>
                          );
                        })}
                        <p className="px-4 pb-2 text-[11px] text-text-muted">All of the run's payments are matched to this one line. The server adds them up and refuses the match unless they equal the line exactly.</p>
                      </div>
                    )}
                    <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-neutral/40 px-4 py-3">
                      <span className="text-xs text-text-muted" data-testid="selection-totals">
                        Your selection: {chosenLines.length} {chosenLines.length === 1 ? 'line' : 'lines'} {formatMoney(linesTotal, currency)} and {chosenBook.length} {chosenBook.length === 1 ? 'entry' : 'entries'} {formatMoney(bookTotal, currency)}. The server checks they match exactly.
                      </span>
                      <button type="button" disabled={busy || finished || chosenLines.length === 0 || chosenBook.length === 0 || !chosenLines.every((l) => l.can.match)} onClick={() => void doMatch()} className={btnPrimary}>
                        <Link2 className="size-4" /> Match selected
                      </button>
                    </div>
                  </TabsContent>
                  <TabsContent value="document" className="mt-0">
                    {openLine && active && active.can.match && active.can.code ? (
                      <CreateDocFromLine key={active.id} line={active} bank={bank} run={run} onMatched={() => setTab('match')} />
                    ) : (
                      <div className="px-4 py-12 text-center text-xs text-text-muted">{openLine ? 'You do not have permission to do this.' : 'Pick a line to match on the left.'}</div>
                    )}
                  </TabsContent>
                  <TabsContent value="create" className="mt-0">
                    {active && active.status === 'unmatched' && !active.pending_journal_id ? (
                      active.can.code ? (
                        <CodeLineForm key={`${active.id}:${suggestions.data?.rule?.id ?? ''}`} line={active} banks={banks.data} rule={suggestions.data?.rule ?? null} run={run} onDone={() => setTab('match')} />
                      ) : (
                        <div className="px-4 py-12 text-center text-xs text-text-muted">You do not have permission to record bank lines.</div>
                      )
                    ) : (
                      <div className="px-4 py-12 text-center text-xs text-text-muted">Pick a line to match on the left to record it here.</div>
                    )}
                  </TabsContent>
                </Tabs>
              </section>
            </div>
          )}
        </>
      )}

      <Dialog open={finishOpen} onOpenChange={(o) => !o && !busy && setFinishOpen(false)}>
        <DialogContent className="max-w-[520px] p-6">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Finish this reconciliation?</DialogTitle>
            <DialogDescription className="text-xs">The server checks the difference again before it locks the matches.</DialogDescription>
          </DialogHeader>
          <dl className="flex flex-col gap-2 rounded-md border border-border bg-surface-neutral p-4 text-xs" data-testid="finish-summary">
            <Row k="Bank account" v={bank.name} />
            <Row k="Statement date" v={formatDate(rec?.as_of)} />
            <Row k="Statement closing balance" v={rep?.statement.closing_balance == null ? '—' : formatMoney(rep.statement.closing_balance, currency)} />
            <Row k="Books, adjusted" v={rep ? formatMoney(rep.adjusted_book_balance, currency) : '—'} />
            <Row k="Difference" v={diff === null ? '—' : formatMoney(diff, currency)} strong />
          </dl>
          {finishError && <p role="alert" className="text-[13px] text-danger">{finishError}</p>}
          <DialogFooter className="gap-2">
            <button type="button" onClick={() => setFinishOpen(false)} disabled={busy} className={btnSecondary}>Cancel</button>
            <button type="button" onClick={() => void finish()} disabled={busy} className="h-8 rounded-md bg-success px-3 text-[13px] font-medium text-white hover:opacity-90 disabled:opacity-50">
              {busy ? 'Finishing…' : 'Finish reconciliation'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={excludeTarget !== null} onOpenChange={(o) => !o && !busy && setExcludeTarget(null)}>
        <DialogContent className="max-w-[460px] p-6">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Exclude this line</DialogTitle>
            <DialogDescription className="text-xs">
              {excludeTarget ? `${lineTitle(excludeTarget)}, ${formatMoney(excludeTarget.amount, excludeTarget.currency)}. ` : ''}The line stays on the statement but is not in your books. You can put it back later.
            </DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-text-muted">
            Reason
            <textarea value={excludeReason} onChange={(e) => setExcludeReason(e.target.value)} rows={3} aria-label="Reason for excluding" className="rounded-md border border-border bg-surface p-2 text-[13px] text-text-primary outline-none focus:border-accent" />
          </label>
          {excludeError && <p role="alert" className="text-[13px] text-danger">{excludeError}</p>}
          <DialogFooter className="gap-2">
            <button type="button" onClick={() => setExcludeTarget(null)} disabled={busy} className={btnSecondary}>Cancel</button>
            <button type="button" onClick={() => void exclude()} disabled={busy} className={btnPrimary}>{busy ? 'Excluding…' : 'Exclude line'}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reopenOpen} onOpenChange={(o) => !o && !busy && setReopenOpen(false)}>
        <DialogContent className="max-w-[460px] p-6">
          <DialogHeader>
            <DialogTitle className="text-sm font-semibold">Reopen this reconciliation</DialogTitle>
            <DialogDescription className="text-xs">Its matches unlock so they can be changed. The reason is kept in the audit log.</DialogDescription>
          </DialogHeader>
          <label className="flex flex-col gap-1 text-[11px] font-medium text-text-muted">
            Reason
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} aria-label="Reason" className="rounded-md border border-border bg-surface p-2 text-[13px] text-text-primary outline-none focus:border-accent" />
          </label>
          {reopenError && <p role="alert" className="text-[13px] text-danger">{reopenError}</p>}
          <DialogFooter className="gap-2">
            <button type="button" onClick={() => setReopenOpen(false)} disabled={busy} className={btnSecondary}>Cancel</button>
            <button type="button" onClick={() => void reopen()} disabled={busy} className={btnPrimary}>{busy ? 'Reopening…' : 'Reopen'}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SignDialog
        {...signProps}
        documentTitle="Bank transaction"
        amount={active ? Math.abs(active.amount) : undefined}
        currency={currency}
        actionTitle="Record this bank line"
        consequenceText="This creates a journal entry for the bank line. It posts at once when it is under your approval limit; otherwise it waits for an approver."
      />
      <ConflictDialog conflict={conflict} />
    </div>
  );
};

const Figure: React.FC<{ label: string; value: number | null; currency: string }> = ({ label, value, currency }) => (
  <div>
    <div className="text-xs text-text-muted">{label}</div>
    <div className="mt-0.5 text-sm font-semibold tabular-nums text-text-primary">{value === null ? '—' : formatMoney(value, currency)}</div>
  </div>
);

const Row: React.FC<{ k: string; v: string; strong?: boolean }> = ({ k, v, strong }) => (
  <div className={cn('flex justify-between gap-4', strong && 'border-t border-border pt-2 text-sm font-semibold')}>
    <dt className="text-text-muted">{k}</dt>
    <dd className="tabular-nums text-text-primary">{v}</dd>
  </div>
);

const BookRow: React.FC<{ checked: boolean; onToggle: () => void; number: string; journalId: string; slug: string; description: string; date: string; amount: number; currency: string; hint?: string }> = ({ checked, onToggle, number, journalId, slug, description, date, amount, currency, hint }) => (
  <div className={cn('flex items-start gap-3 px-4 py-3', checked && 'bg-accent-soft/40')} data-book={number}>
    <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={`Select ${number}`} className="mt-0.5" />
    <div className="min-w-0 flex-1">
      <div className="flex items-center justify-between gap-3">
        <Link to={`/${slug}/journals/${journalId}`} className="truncate text-[13px] font-medium text-text-primary hover:underline">
          {number || 'Entry'}
        </Link>
        <span className={cn('text-[13px] font-semibold tabular-nums', amount > 0 ? 'text-success' : 'text-text-primary')}>{formatMoney(amount, currency)}</span>
      </div>
      <div className="mt-0.5 flex items-center justify-between gap-3 text-xs text-text-muted">
        <span className="truncate">{description}</span>
        <span className="shrink-0 tabular-nums">{formatDate(date)}</span>
      </div>
      {hint && <div className="mt-1.5 inline-flex items-center rounded-[3px] bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">{hint}</div>}
    </div>
  </div>
);
