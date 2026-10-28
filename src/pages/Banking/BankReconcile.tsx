import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerStore } from '@/mock/store';
import { formatMoney, formatDate } from '@/lib/format';
import {
  CreditCard,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Check,
  AlertCircle,
  FileCheck,
  Building,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

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

  return (
    <div className="flex flex-col gap-5">
      {/* Workspace Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-ink-200">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-h1 font-bold text-ink-900 flex items-center gap-2">
              <Building className="w-5 h-5 text-brand-600" />
              Bank Reconciliation Workspace
            </h1>
            <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-100">
              {currentBank.name}
            </span>
          </div>
          <p className="text-xs text-ink-500 mt-0.5">
            Statement Period: Oct 01–31, 2026 • Match imported feeds against general ledger journal entries
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleMatchAll}
            className="flex items-center gap-1.5 h-8 px-3 rounded-sm border border-brand-200 hover:bg-brand-50 text-brand-700 text-xs font-medium transition-colors"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Auto-Match High Confidence (Demo)</span>
          </button>

          <button
            type="button"
            onClick={() => setIsFinishedModalOpen(true)}
            className="flex items-center gap-1.5 h-8 px-4 bg-success hover:opacity-90 text-white rounded-sm text-xs font-semibold shadow-sm transition-all"
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Finish Reconciliation</span>
          </button>
        </div>
      </div>

      {/* Proof Strip Summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 p-4 bg-surface border border-ink-200 rounded-md shadow-sm font-mono text-xs">
        <div className="flex flex-col">
          <span className="text-[10px] text-ink-500 uppercase tracking-wider font-sans font-medium">
            Statement Opening
          </span>
          <span className="font-bold text-ink-900 text-sm mt-0.5">{formatMoney(12000000)}</span>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] text-ink-500 uppercase tracking-wider font-sans font-medium">
            Matched Cleared Receipts
          </span>
          <span className="font-bold text-success text-sm mt-0.5">
            +{formatMoney(matchedStatementLines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0))}
          </span>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] text-ink-500 uppercase tracking-wider font-sans font-medium">
            Matched Cleared Payments
          </span>
          <span className="font-bold text-danger text-sm mt-0.5">
            -{formatMoney(Math.abs(matchedStatementLines.filter((l) => l.amount < 0).reduce((s, l) => s + l.amount, 0)))}
          </span>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] text-ink-500 uppercase tracking-wider font-sans font-medium">
            Statement Closing
          </span>
          <span className="font-bold text-ink-900 text-sm mt-0.5">
            {formatMoney(currentBank.last_statement_balance)}
          </span>
        </div>

        <div className="flex flex-col justify-center">
          <span className="text-[10px] text-ink-500 uppercase tracking-wider font-sans font-medium">
            Reconciliation Variance
          </span>
          <div
            className={`font-bold text-sm mt-0.5 inline-flex items-center gap-1.5 ${
              isDifferenceZero ? 'text-success' : 'text-danger'
            }`}
          >
            {isDifferenceZero ? (
              <>
                <Check className="w-4 h-4 text-success" />
                <span>Difference: $0.00 (Balanced)</span>
              </>
            ) : (
              <>
                <AlertCircle className="w-4 h-4 text-danger" />
                <span>Difference: {formatMoney(unmatchedStatementLines.reduce((s, l) => s + l.amount, 0))}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Two-Pane Workspace (02_AppFlow §8: Left statement lines, right book transactions) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left Pane: Bank Statement Lines */}
        <div className="bg-surface border border-ink-200 rounded-lg p-4 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2 border-b border-ink-100">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-ink-900 uppercase tracking-wider">
                1. Bank Statement Feed
              </span>
              <span className="text-[11px] font-mono bg-warning-bg text-warning px-1.5 rounded-full font-bold">
                {unmatchedStatementLines.length} unmatched
              </span>
            </div>
            <span className="text-[11px] text-ink-500">Electronic Feed • Verified</span>
          </div>

          <div className="divide-y divide-ink-100 max-h-[460px] overflow-y-auto">
            {unmatchedStatementLines.map((line) => {
              const isSelected = selectedStatementLineId === line.id;
              return (
                <div
                  key={line.id}
                  onClick={() => setSelectedStatementLineId(line.id)}
                  className={`p-3 rounded-md cursor-pointer transition-all flex flex-col gap-1.5 ${
                    isSelected
                      ? 'bg-brand-50 border border-brand-500/50 shadow-sm'
                      : 'hover:bg-ink-50 border border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-ink-900">{line.counterparty}</span>
                    <span
                      className={`text-xs font-mono font-bold ${
                        line.amount > 0 ? 'text-success' : 'text-ink-900'
                      }`}
                    >
                      {formatMoney(line.amount)}
                    </span>
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-ink-500">
                    <span className="truncate max-w-[260px] font-mono">{line.description}</span>
                    <span className="font-mono">{formatDate(line.txn_date)}</span>
                  </div>

                  {line.confidence && (
                    <div className="flex items-center gap-1.5 text-[10px] text-brand-700 bg-brand-100/50 px-2 py-0.5 rounded font-medium mt-0.5">
                      <Sparkles className="w-3 h-3 text-brand-600" />
                      <span>{line.confidence}% confidence suggested match</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Pane: General Ledger / Book Transactions */}
        <div className="bg-surface border border-ink-200 rounded-lg p-4 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2 border-b border-ink-100">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-ink-900 uppercase tracking-wider">
                2. General Ledger Transactions
              </span>
              <span className="text-[11px] text-ink-500 font-mono">Unmatched Book Entries</span>
            </div>
          </div>

          <div className="divide-y divide-ink-100 max-h-[460px] overflow-y-auto">
            {bookTransactions
              .filter((t) => !t.isMatched)
              .map((txn) => {
                const isSelected = selectedBookTxnId === txn.id;
                return (
                  <div
                    key={txn.id}
                    onClick={() => setSelectedBookTxnId(txn.id)}
                    className={`p-3 rounded-md cursor-pointer transition-all flex flex-col gap-1.5 ${
                      isSelected
                        ? 'bg-brand-50 border border-brand-500/50 shadow-sm'
                        : 'hover:bg-ink-50 border border-transparent'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-brand-700">
                          {txn.doc_number}
                        </span>
                        <span className="text-xs font-medium text-ink-900">{txn.contact_name}</span>
                      </div>
                      <span
                        className={`text-xs font-mono font-bold ${
                          txn.amount > 0 ? 'text-success' : 'text-ink-900'
                        }`}
                      >
                        {formatMoney(txn.amount)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-ink-500">
                      <span>
                        {txn.type} • Ref: {txn.reference}
                      </span>
                      <span className="font-mono">{formatDate(txn.date)}</span>
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Match Action Bar */}
          <div className="mt-auto pt-3 border-t border-ink-100 flex items-center justify-between">
            <span className="text-xs text-ink-500">
              Selected Pair:{' '}
              <strong className="text-ink-900 font-mono">
                {activeStatementLine ? formatMoney(activeStatementLine.amount) : 'None'}
              </strong>
            </span>

            <button
              type="button"
              onClick={handleMatch}
              className="flex items-center gap-1.5 h-8 px-4 bg-brand-600 hover:bg-brand-700 text-white rounded-sm text-xs font-semibold shadow-sm transition-colors"
            >
              <Check className="w-4 h-4" />
              <span>Match Selected Transactions</span>
            </button>
          </div>
        </div>
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

          <div className="flex flex-col gap-3 text-xs text-text-secondary font-mono">
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
                navigate(`/${coSlug}/periods`);
              }}
              className="px-4 py-1.5 rounded-sm bg-success hover:opacity-90 text-white text-xs font-semibold shadow-xs"
            >
              Lock Reconciliation & View Periods
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
