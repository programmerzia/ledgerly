import { selectByMode } from '@/data/select';
import { BankReconcileLive } from './live/BankReconcileLive';
import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerStore } from '@/mock/store';
import { formatMoney, formatDate } from '@/lib/format';
import { toast } from 'sonner';
import { CheckCircle2, ShieldCheck, Check, Link2, Clock, Settings2 } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { CreateTab } from './reconcile/CreateTab';
import type { BankRule, BankStatementLine } from '@/types';
import { PageHeader } from '@/components/domain/PageHeader';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

const MockBankReconcile: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const {
    currentCompany, bankAccounts, bankStatementLines, accounts, ruleSuggestionFor,
    createBankTransaction, currentUser, companySettings,
  } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const currentBank = bankAccounts.find((b) => b.id === id) ?? bankAccounts[0];
  const [tab, setTab] = useState<'match' | 'create'>('match');
  const [selectedStatementLineId, setSelectedStatementLineId] = useState<string>('bsl-1');
  const [selectedBookTxnId, setSelectedBookTxnId] = useState<string>('rct-1');
  const [isFinishedModalOpen, setIsFinishedModalOpen] = useState(false);

  const statementLines = bankStatementLines.filter((l) => l.bank_account_id === currentBank.id);
  const unmatchedStatementLines = statementLines.filter((l) => l.status === 'unmatched' && !l.pending_journal_id);
  const pendingStatementLines = statementLines.filter((l) => l.status === 'unmatched' && l.pending_journal_id);
  const matchedStatementLines = statementLines.filter((l) => l.status === 'matched');

  // Book transactions for reconciliation matching
  const [bookTransactions, setBookTransactions] = useState([
    {
      id: 'rct-1',
      date: '2026-10-24',
      doc_number: 'RCT-2026-0016',
      contact_name: 'Hormuud Telecom',
      amount: 154500, // $1,545.00
      type: 'Receipt',
      reference: 'HT-88219',
      isMatched: false,
    },
    {
      id: 'bill-1',
      date: '2026-10-25',
      doc_number: 'BILL-2026-0011',
      contact_name: 'Golis Internet',
      amount: -45000, // -$450.00
      type: 'Payment',
      reference: 'GOLIS-8812',
      isMatched: false,
    },
    {
      id: 'rct-2',
      date: '2026-10-26',
      doc_number: 'RCT-2026-0017',
      contact_name: 'Somtel',
      amount: 820000,
      type: 'Receipt',
      reference: 'SOM-9921',
      isMatched: false,
    },
  ]);

  const activeStatementLine = statementLines.find((l) => l.id === selectedStatementLineId);

  // Match the receipt to a statement line (Demo Step 5 requirement!)
  const handleMatch = async () => {
    if (!selectedStatementLineId) return;

    await api.matchBankLine(selectedStatementLineId, selectedBookTxnId, 'receipt');

    setBookTransactions((prev) =>
      prev.map((t) => (t.id === selectedBookTxnId ? { ...t, isMatched: true } : t))
    );

    // Auto-advance to next unmatched line if available
    const remaining = unmatchedStatementLines.filter((l) => l.id !== selectedStatementLineId);
    if (remaining.length > 0) {
      setSelectedStatementLineId(remaining[0].id);
    }
  };

  /** Records one line from a rule. Throws PostingError with a readable message. */
  const applyRule = (line: BankStatementLine, rule: BankRule) =>
    createBankTransaction(
      {
        lineId: line.id,
        kind: line.amount < 0 ? 'spend' : 'receive',
        accountId: rule.account_id,
        taxCodeId: rule.tax_code_id,
        contactId: rule.contact_id,
        dimensions: rule.dimensions,
        memo: rule.memo,
        ruleId: rule.id,
      },
      currentUser,
      companySettings
    );

  const acceptRule = (line: BankStatementLine, rule: BankRule) => {
    try {
      const r = applyRule(line, rule);
      toast.success(
        r.outcome === 'posted'
          ? `Recorded ${formatMoney(Math.abs(line.amount))} as ${accountLabel(rule.account_id)}.`
          : 'Sent for approval. This line leaves your to-do list until it is approved.'
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not record this line.');
    }
  };

  // Accept every rule suggestion and every document match suggestion, then summarise.
  const handleAcceptAll = async () => {
    let matched = 0;
    let pending = 0;
    const failed: string[] = [];
    for (const l of unmatchedStatementLines) {
      const rule = ruleSuggestionFor(l.id);
      try {
        if (rule) {
          const r = applyRule(l, rule);
          if (r.outcome === 'posted') matched++;
          else pending++;
        } else if (l.confidence) {
          await api.matchBankLine(l.id, 'doc-auto', 'receipt');
          matched++;
        }
      } catch (err) {
        failed.push(`${l.counterparty || l.description}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }
    if (matched + pending + failed.length === 0) {
      toast.info('Nothing to accept yet. Lines without a rule or a likely match need to be coded by hand.');
      return;
    }
    const parts = [`${matched} matched`, `${pending} sent for approval`, `${failed.length} failed`];
    if (failed.length) toast.error(`${parts.join(', ')}. ${failed.join(' · ')}`);
    else toast.success(parts.join(', '));
  };

  const accountLabel = (accId: string) => {
    const a = accounts.find((x: { id: string }) => x.id === accId);
    return a ? `${a.code} ${a.name}` : 'the chosen account';
  };

  // Keep the selection on a line that still needs work.
  useEffect(() => {
    if (!unmatchedStatementLines.some((l) => l.id === selectedStatementLineId) && unmatchedStatementLines[0]) {
      setSelectedStatementLineId(unmatchedStatementLines[0].id);
    }
  });

  const onCreated = () => {
    const idx = unmatchedStatementLines.findIndex((l) => l.id === selectedStatementLineId);
    const next = unmatchedStatementLines[idx + 1] ?? unmatchedStatementLines[idx - 1];
    if (next) setSelectedStatementLineId(next.id);
  };

  const suggestedCount = unmatchedStatementLines.filter((l) => ruleSuggestionFor(l.id) || l.confidence).length;

  const isDifferenceZero = unmatchedStatementLines.length === 0;
  const totalLines = statementLines.length;
  const progress = totalLines === 0 ? 100 : Math.round((matchedStatementLines.length / totalLines) * 100);
  const difference = unmatchedStatementLines.reduce((s, l) => s + l.amount, 0);
  const openBook = bookTransactions.filter((t) => !t.isMatched);

  // Keyboard: J/K or arrows move through statement lines, Enter matches.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[role="dialog"]')) return;
      const idx = unmatchedStatementLines.findIndex((l) => l.id === selectedStatementLineId);
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const n = unmatchedStatementLines[Math.min(idx + 1, unmatchedStatementLines.length - 1)];
        if (n) setSelectedStatementLineId(n.id);
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const n = unmatchedStatementLines[Math.max(idx - 1, 0)];
        if (n) setSelectedStatementLineId(n.id);
      } else if (e.key === 'c') {
        e.preventDefault();
        setTab('create');
      } else if (e.key === 'm') {
        e.preventDefault();
        setTab('match');
      } else if (e.key === 'Enter') {
        if (tab !== 'match') return;
        if (t && (t.tagName === 'BUTTON' || t.tagName === 'A')) return;
        e.preventDefault();
        void handleMatch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const paneCard = 'flex flex-col rounded-lg border border-border bg-surface overflow-hidden';
  const rowBase = 'relative w-full text-left px-4 py-3 transition-colors duration-150 outline-none focus-visible:bg-accent-soft/50';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumb={[{ label: 'Bank & cash', to: `/${coSlug}/banking` }, { label: currentBank.name }]}
        title="Reconcile bank account"
        subtitle="Pair each bank statement line with the matching entry in your books, until nothing is left over."
        actions={
          <>
            <Link
              to={`/${coSlug}/banking/rules`}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-neutral hover:text-text-primary"
            >
              <Settings2 className="size-4 text-text-muted" />
              Rules
            </Link>
            <button
              type="button"
              onClick={handleAcceptAll}
              className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-secondary transition-colors hover:bg-surface-neutral hover:text-text-primary"
            >
              Accept all suggested{suggestedCount > 0 ? ` (${suggestedCount})` : ''}
            </button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block">
                  <button
                    type="button"
                    disabled={!isDifferenceZero}
                    onClick={() => setIsFinishedModalOpen(true)}
                    className="flex h-8 items-center gap-1.5 rounded-md bg-success px-3 text-[13px] font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <CheckCircle2 className="size-4" />
                    Finish reconciliation
                  </button>
                </span>
              </TooltipTrigger>
              {!isDifferenceZero && (
                <TooltipContent className="max-w-xs">
                  {unmatchedStatementLines.length} statement {unmatchedStatementLines.length === 1 ? 'line is' : 'lines are'} still unmatched. Match them to finish.
                </TooltipContent>
              )}
            </Tooltip>
          </>
        }
      />

      {/* Sticky progress header */}
      <div className="sticky top-0 z-10 -mx-1 rounded-lg border border-border bg-surface px-5 py-4" data-testid="recon-progress">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <div className="text-xs text-text-muted">Difference</div>
            <div
              className={cn(
                'mt-0.5 flex items-center gap-2 text-[22px] leading-7 font-medium tabular-nums',
                isDifferenceZero ? 'text-success' : 'text-text-primary'
              )}
            >
              {formatMoney(isDifferenceZero ? 0 : difference)}
              {isDifferenceZero ? (
                <span className="text-xs font-normal text-success">Balanced</span>
              ) : (
                <span className="text-xs font-normal text-text-muted">goal: $0.00</span>
              )}
            </div>
          </div>
          <div className="min-w-[200px] flex-1">
            <div className="mb-1.5 flex justify-between text-xs text-text-muted">
              <span>
                {matchedStatementLines.length} of {totalLines} lines matched
              </span>
              <span className="tabular-nums">{progress}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-[2px] bg-surface-neutral">
              <div
                className={cn('h-full transition-all duration-150', isDifferenceZero ? 'bg-success' : 'bg-accent')}
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <div className="flex gap-6 text-xs">
            <div>
              <div className="text-text-muted">Money in (matched)</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums text-success">
                +{formatMoney(matchedStatementLines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0))}
              </div>
            </div>
            <div>
              <div className="text-text-muted">Money out (matched)</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums text-danger">
                -{formatMoney(Math.abs(matchedStatementLines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0)))}
              </div>
            </div>
            <div>
              <div className="text-text-muted">Statement balance</div>
              <div className="mt-0.5 text-sm font-semibold tabular-nums text-text-primary">{formatMoney(currentBank.last_statement_balance)}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Left: statement lines */}
        <section className={paneCard} aria-label="Bank statement lines">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-text-primary">From your bank</h2>
              <span className="rounded-[3px] bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">{unmatchedStatementLines.length} to match</span>
            </div>
          </div>
          <div className="max-h-[460px] divide-y divide-border overflow-y-auto">
            {unmatchedStatementLines.length === 0 && (
              <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
                <p className="text-sm font-semibold text-text-primary">Every statement line is matched</p>
                <p className="text-xs text-text-muted">Difference is $0.00. You can finish the reconciliation.</p>
              </div>
            )}
            {unmatchedStatementLines.map((line) => {
              const isSelected = selectedStatementLineId === line.id;
              const rule = ruleSuggestionFor(line.id);
              return (
                <div key={line.id} className={cn(isSelected ? 'bg-surface-neutral' : 'hover:bg-canvas')}>
                <button
                  type="button"
                  onClick={() => setSelectedStatementLineId(line.id)}
                  aria-pressed={isSelected}
                  className={cn(rowBase, rule && 'pb-1.5')}
                >
                  {isSelected && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-[13px] font-medium text-text-primary">{line.counterparty}</span>
                    <span className={cn('text-[13px] font-semibold tabular-nums', line.amount > 0 ? 'text-success' : 'text-text-primary')}>
                      {formatMoney(line.amount)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-3 text-xs text-text-muted">
                    <span className="truncate">{line.description}</span>
                    <span className="shrink-0 tabular-nums">{formatDate(line.txn_date)}</span>
                  </div>
                  {line.confidence && !rule && (
                    <div className="mt-1.5 inline-flex items-center rounded-[3px] bg-surface-neutral px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
                      {line.confidence}% sure of a match
                    </div>
                  )}
                </button>
                {rule && (
                  <div className="flex items-center gap-2 px-4 pb-2.5">
                    <span className="inline-flex min-w-0 items-center gap-1 rounded-[3px] bg-surface-neutral px-1.5 py-0.5 text-[11px] font-medium text-text-secondary" data-testid="rule-chip">
                      <span className="truncate">Rule: {rule.name} → {accountLabel(rule.account_id)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => acceptRule(line, rule)}
                      className="ml-auto flex h-6 shrink-0 items-center gap-1 rounded-md bg-accent px-2 text-[11px] font-medium text-white transition hover:bg-accent-hover"
                    >
                      <Check className="size-3" /> Accept
                    </button>
                  </div>
                )}
                </div>
              );
            })}
            {pendingStatementLines.map((line) => (
              <div key={line.id} className="flex items-center justify-between gap-3 bg-warning-soft/30 px-4 py-2.5 text-xs">
                <span className="flex min-w-0 items-center gap-2 text-text-secondary">
                  <span className="truncate">{line.counterparty}</span>
                  <Link
                    to={`/${coSlug}/journals/${line.pending_journal_id}`}
                    className="inline-flex shrink-0 items-center gap-1 rounded-[3px] bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning hover:underline"
                  >
                    <Clock className="size-3" /> Waiting for approval
                  </Link>
                </span>
                <span className="tabular-nums text-text-muted">{formatMoney(line.amount)}</span>
              </div>
            ))}
            {matchedStatementLines.map((line) => (
              <div key={line.id} className="flex items-center justify-between gap-3 bg-success-soft/30 px-4 py-2.5 text-xs">
                <span className="flex items-center gap-2 truncate text-text-secondary">
                  <Check className="size-3.5 text-success" />
                  <span className="truncate">{line.counterparty}</span>
                </span>
                <span className="tabular-nums text-text-muted">{formatMoney(line.amount)}</span>
              </div>
            ))}
          </div>
        </section>

        {/* Right: ledger suggestions */}
        <section className={paneCard} aria-label="Entries in your books">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-text-primary">From your books</h2>
              <span className="text-xs text-text-muted">not yet on a statement</span>
            </div>
          </div>
          <Tabs value={tab} onValueChange={(v) => setTab(v as 'match' | 'create')} className="flex flex-1 flex-col">
            <div className="flex items-center justify-between border-b border-border px-4 py-2">
              <TabsList>
                <TabsTrigger value="match">Match <Kbd className="ml-1.5">M</Kbd></TabsTrigger>
                <TabsTrigger value="create">Create <Kbd className="ml-1.5">C</Kbd></TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="match" className="mt-0 flex flex-1 flex-col">
          <div className="max-h-[460px] divide-y divide-border overflow-y-auto">
            {openBook.length === 0 && <div className="px-4 py-12 text-center text-xs text-text-muted">No book entries are waiting for a match.</div>}
            {openBook.map((txn) => {
              const isSelected = selectedBookTxnId === txn.id;
              const exact = activeStatementLine?.amount === txn.amount;
              return (
                <button
                  type="button"
                  key={txn.id}
                  onClick={() => setSelectedBookTxnId(txn.id)}
                  aria-pressed={isSelected}
                  className={cn(rowBase, isSelected ? 'bg-accent-soft/60' : 'hover:bg-canvas')}
                >
                  {isSelected && <span className="absolute inset-y-0 left-0 w-0.5 bg-accent" />}
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-text-primary">{txn.contact_name}</span>
                      <span className="shrink-0 text-xs text-text-muted">{txn.doc_number}</span>
                    </div>
                    <span className={cn('text-[13px] font-semibold tabular-nums', txn.amount > 0 ? 'text-success' : 'text-text-primary')}>
                      {formatMoney(txn.amount)}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center justify-between gap-3 text-xs text-text-muted">
                    <span>
                      {txn.type === 'Receipt' ? 'Payment received' : 'Payment made'} · Ref {txn.reference}
                    </span>
                    <span className="shrink-0 tabular-nums">{formatDate(txn.date)}</span>
                  </div>
                  {exact && (
                    <div className="mt-1.5 inline-flex items-center gap-1 rounded-[3px] bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">
                      <Link2 className="size-3" />
                      Same amount as the selected line
                    </div>
                  )}
                </button>
              );
            })}
          </div>
          <div className="mt-auto flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface-neutral/40 px-4 py-3">
            <span className="hidden items-center gap-2 text-xs text-text-muted sm:flex">
              <Kbd>J</Kbd>
              <Kbd>K</Kbd> move
              <Kbd>Enter</Kbd> match
            </span>
            <button
              type="button"
              onClick={handleMatch}
              className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover"
            >
              <Check className="size-4" />
              Match
              {activeStatementLine ? ` ${formatMoney(activeStatementLine.amount)}` : ''}
            </button>
          </div>
            </TabsContent>
            <TabsContent value="create" className="mt-0">
              {activeStatementLine && activeStatementLine.status === 'unmatched' && !activeStatementLine.pending_journal_id ? (
                <CreateTab key={activeStatementLine.id} line={activeStatementLine} onDone={onCreated} />
              ) : (
                <div className="px-4 py-12 text-center text-xs text-text-muted">Pick a statement line on the left to record it here.</div>
              )}
            </TabsContent>
          </Tabs>
        </section>
      </div>

      {/* Finished Reconciliation Proof Dialog (Demo Step 5 requirement: Difference = 0) */}
      <Dialog open={isFinishedModalOpen} onOpenChange={setIsFinishedModalOpen}>
        <DialogContent className="max-w-[540px] p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="w-5 h-5 text-success" />
              <span>Bank reconciliation certificate</span>
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3 text-xs text-text-secondary ">
            <div className="p-4 bg-surface-neutral rounded-md border border-border flex flex-col gap-2">
              <div className="flex justify-between">
                <span className="text-text-muted">Bank account:</span>
                <span className="font-semibold text-text-primary">{currentBank.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Statement end date:</span>
                <span className="text-text-primary">2026-10-31</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Statement end balance:</span>
                <span className="font-semibold text-text-primary">{formatMoney(currentBank.last_statement_balance)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Adjusted book balance:</span>
                <span className="font-semibold text-text-primary">{formatMoney(currentBank.last_statement_balance)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-border font-semibold text-sm">
                <span className="text-success font-sans">Final variance:</span>
                <span className="text-success">$0.00 (Zero Difference)</span>
              </div>
            </div>

            <p className="text-[11px] text-text-muted font-sans italic">
              Control Attestation: All 30 statement lines have been matched or accounted for. This
              reconciliation report will be sealed into the audit log and enables period closing.
            </p>
          </div>

          <DialogFooter className="gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setIsFinishedModalOpen(false)}
              className="px-3.5 py-1.5 rounded-sm border border-border hover:bg-surface-neutral text-xs font-medium text-text-secondary"
            >
              Close
            </button>
            <button
              type="button"
              onClick={() => {
                setIsFinishedModalOpen(false);
                useLedgerStore.setState((s: any) => ({
                  closeChecks: s.closeChecks.map((c: any) =>
                    c.check_code === 'BANK_REC'
                      ? { ...c, status: 'pass', detail: 'Bank accounts fully reconciled (Zero Difference certified)' }
                      : c
                  ),
                }));
                toast.success('Reconciliation certified and sealed into audit log. BANK_REC check passed.');
                navigate(`/${coSlug}/periods`);
              }}
              className="px-4 py-1.5 rounded-sm bg-success hover:opacity-90 text-white text-xs font-semibold cursor-pointer"
            >
              Lock Reconciliation & View Periods
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export const BankReconcile: React.FC = selectByMode({ mock: MockBankReconcile, live: BankReconcileLive });
