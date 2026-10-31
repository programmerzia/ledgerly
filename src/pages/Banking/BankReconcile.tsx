import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerStore } from '@/mock/store';
import { formatMoney, formatDate } from '@/lib/format';
import { toast } from 'sonner';
import { CheckCircle2, Sparkles, ShieldCheck, Check, AlertCircle, Landmark, Link2 } from 'lucide-react';
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

export const BankReconcile: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentCompany, bankAccounts, bankStatementLines } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const currentBank = bankAccounts[0]; // Premier Bank USD
  const [selectedStatementLineId, setSelectedStatementLineId] = useState<string>('bsl-1');
  const [selectedBookTxnId, setSelectedBookTxnId] = useState<string>('rct-1');
  const [isFinishedModalOpen, setIsFinishedModalOpen] = useState(false);

  const statementLines = bankStatementLines.filter((l) => l.bank_account_id === currentBank.id);
  const unmatchedStatementLines = statementLines.filter((l) => l.status === 'unmatched');
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

  // Match All Remaining for Demo
  const handleMatchAll = async () => {
    for (const l of unmatchedStatementLines) {
      await api.matchBankLine(l.id, 'doc-auto', 'receipt');
    }
  };

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
      } else if (e.key === 'Enter') {
        if (t && (t.tagName === 'BUTTON' || t.tagName === 'A')) return;
        e.preventDefault();
        void handleMatch();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const paneCard = 'flex flex-col rounded-xl border border-border bg-surface shadow-card overflow-hidden';
  const rowBase = 'relative w-full text-left px-4 py-3 transition-colors duration-150 outline-none focus-visible:bg-accent-soft/50';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumb={[{ label: 'Bank & cash', to: `/${coSlug}/banking` }, { label: currentBank.name }]}
        icon={<Landmark />}
        title="Reconcile bank account"
        subtitle="Pair each bank statement line with the matching entry in your books, until nothing is left over."
        actions={
          <>
            <button
              type="button"
              onClick={handleMatchAll}
              className="flex h-9 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-[13px] font-medium text-text-secondary transition hover:bg-surface-neutral hover:text-text-primary"
            >
              <Sparkles className="size-4 text-accent" />
              Match all suggested
            </button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-block">
                  <button
                    type="button"
                    disabled={!isDifferenceZero}
                    onClick={() => setIsFinishedModalOpen(true)}
                    className="flex h-9 items-center gap-1.5 rounded-lg bg-success px-3.5 text-[13px] font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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
      <div className="sticky top-0 z-10 -mx-1 rounded-xl border border-border bg-surface/95 px-5 py-4 shadow-card backdrop-blur" data-testid="recon-progress">
        <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
          <div>
            <div className="text-xs text-text-muted">Difference</div>
            <div
              className={cn(
                'mt-0.5 flex items-center gap-2 text-2xl font-semibold tabular-nums tracking-tight',
                isDifferenceZero ? 'text-success' : 'text-text-primary'
              )}
            >
              {formatMoney(isDifferenceZero ? 0 : difference)}
              {isDifferenceZero ? (
                <span className="ui-rise-in flex size-6 items-center justify-center rounded-full bg-success text-white">
                  <Check className="size-4" />
                </span>
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
            <div className="h-2 overflow-hidden rounded-full bg-surface-neutral">
              <div
                className={cn('h-full rounded-full transition-all duration-500 ease-out', isDifferenceZero ? 'bg-success' : 'bg-accent')}
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
              <span className="flex size-6 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">1</span>
              <h2 className="text-sm font-semibold text-text-primary">From your bank</h2>
              <span className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-medium text-warning">{unmatchedStatementLines.length} to match</span>
            </div>
          </div>
          <div className="max-h-[460px] divide-y divide-border overflow-y-auto">
            {unmatchedStatementLines.length === 0 && (
              <div className="ui-rise-in flex flex-col items-center gap-2 px-4 py-12 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-success-soft text-success">
                  <CheckCircle2 className="size-6" />
                </span>
                <p className="text-sm font-semibold text-text-primary">Every statement line is matched</p>
                <p className="text-xs text-text-muted">Difference is $0.00. You can finish the reconciliation.</p>
              </div>
            )}
            {unmatchedStatementLines.map((line) => {
              const isSelected = selectedStatementLineId === line.id;
              return (
                <button
                  type="button"
                  key={line.id}
                  onClick={() => setSelectedStatementLineId(line.id)}
                  aria-pressed={isSelected}
                  className={cn(rowBase, isSelected ? 'bg-accent-soft/60' : 'hover:bg-surface-neutral/70')}
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
                  {line.confidence && (
                    <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-violet-soft px-2 py-0.5 text-[11px] font-medium text-violet">
                      <Sparkles className="size-3" />
                      {line.confidence}% sure of a match
                    </div>
                  )}
                </button>
              );
            })}
            {matchedStatementLines.map((line) => (
              <div key={line.id} className="flex items-center justify-between gap-3 bg-success-soft/30 px-4 py-2.5 text-xs">
                <span className="flex items-center gap-2 truncate text-text-secondary">
                  <span className="flex size-4 items-center justify-center rounded-full bg-success text-white">
                    <Check className="size-3" />
                  </span>
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
              <span className="flex size-6 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent">2</span>
              <h2 className="text-sm font-semibold text-text-primary">From your books</h2>
              <span className="text-xs text-text-muted">not yet on a statement</span>
            </div>
          </div>
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
                  className={cn(rowBase, isSelected ? 'bg-accent-soft/60' : 'hover:bg-surface-neutral/70')}
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
                    <div className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-success-soft px-2 py-0.5 text-[11px] font-medium text-success">
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
              className="flex h-9 items-center gap-1.5 rounded-lg bg-accent px-4 text-[13px] font-semibold text-white transition hover:bg-accent-hover"
            >
              <Check className="size-4" />
              Match
              {activeStatementLine ? ` ${formatMoney(activeStatementLine.amount)}` : ''}
            </button>
          </div>
        </section>
      </div>

      {/* Finished Reconciliation Proof Dialog (Demo Step 5 requirement: Difference = 0) */}
      <Dialog open={isFinishedModalOpen} onOpenChange={setIsFinishedModalOpen}>
        <DialogContent className="max-w-[540px] p-6">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <ShieldCheck className="w-5 h-5 text-success" />
              <span>Bank Reconciliation Audit Certification</span>
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-3 text-xs text-text-secondary ">
            <div className="p-4 bg-surface-neutral rounded-md border border-border flex flex-col gap-2">
              <div className="flex justify-between">
                <span className="text-text-muted">Bank Account:</span>
                <span className="font-semibold text-text-primary">{currentBank.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Statement Ending Date:</span>
                <span className="text-text-primary">2026-10-31</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Statement Ending Balance:</span>
                <span className="font-semibold text-text-primary">{formatMoney(currentBank.last_statement_balance)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Adjusted Book Balance:</span>
                <span className="font-semibold text-text-primary">{formatMoney(currentBank.last_statement_balance)}</span>
              </div>
              <div className="flex justify-between pt-2 border-t border-border font-bold text-sm">
                <span className="text-success font-sans">Final Variance:</span>
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
              Close View
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
              className="px-4 py-1.5 rounded-sm bg-success hover:opacity-90 text-white text-xs font-semibold shadow-xs cursor-pointer"
            >
              Lock Reconciliation & View Periods
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
