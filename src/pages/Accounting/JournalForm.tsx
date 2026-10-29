import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerlyStore } from '@/mock/store';
import { LineGrid, GridLineItem } from '@/components/domain/LineGrid';
import { formatMoney } from '@/lib/format';
import { ArrowLeft, Save, Send, AlertTriangle, ShieldAlert, CheckCircle2 } from 'lucide-react';

export const JournalForm: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, accounts, dimensions, fiscalYear } = useLedgerlyStore();
  const coSlug = currentCompany.slug;

  const [journalDate, setJournalDate] = useState('2026-10-28');
  const [reference, setReference] = useState('ADJ-OCT-REALLOC');
  const [memo, setMemo] = useState('Monthly departmental expense reallocation');
  const [errorMessage, setErrorMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Initial balanced sample lines ($250.00 Dr / $250.00 Cr)
  const [lines, setLines] = useState<GridLineItem[]>([
    {
      id: 'jl-1',
      line_no: 1,
      account_id: 'acc-6200', // Utilities
      description: 'Mogadishu Office Internet Connectivity Allocation',
      debit: 25000, // $250.00
      credit: 0,
      dimensions: { branch: 'MG', cost_centre: 'ADMIN' },
    },
    {
      id: 'jl-2',
      line_no: 2,
      account_id: 'acc-1010', // Premier Bank USD
      description: 'Direct Debit Clearing',
      debit: 0,
      credit: 25000, // $250.00
      dimensions: { branch: 'MG', cost_centre: 'ADMIN' },
    },
  ]);

  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
  const difference = totalDebit - totalCredit;
  const isBalanced = difference === 0 && totalDebit > 0;

  // Check period status for the chosen date (Demo Step 7 Requirement!)
  const selectedPeriod = fiscalYear.periods.find(
    (p: any) => journalDate >= p.starts_on && journalDate <= p.ends_on
  );
  const isPeriodClosed = selectedPeriod && selectedPeriod.status !== 'open';

  const handleSubmit = async () => {
    setErrorMessage('');

    if (isPeriodClosed) {
      setErrorMessage(
        `Controls Enforcement: Fiscal Period ${selectedPeriod?.name} is ${selectedPeriod?.status?.toUpperCase()}. Postings to closed periods are strictly blocked.`
      );
      return;
    }

    if (!isBalanced) {
      setErrorMessage(
        `Ledger Invariant Violation: Debits must exactly equal Credits. Current difference: ${formatMoney(
          Math.abs(difference)
        )}.`
      );
      return;
    }

    try {
      setIsSubmitting(true);
      const journal = await api.createJournal({
        journal_date: journalDate,
        reference,
        memo,
        journal_type: 'manual',
        total_debit: totalDebit,
        total_credit: totalCredit,
        lines: lines.map((l) => ({
          id: l.id,
          line_no: l.line_no,
          account_id: l.account_id,
          description: l.description,
          debit: l.debit || 0,
          credit: l.credit || 0,
          currency: 'USD',
          fx_rate: 1.0,
          amount_fc: (l.debit || 0) + (l.credit || 0),
          dimensions: l.dimensions,
        })),
      });

      navigate(`/${coSlug}/journals/${journal.id}`);
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to post journal');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-ink-200">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(`/${coSlug}/journals`)}
            className="p-1.5 rounded-sm border border-ink-200 hover:bg-ink-100 text-ink-500 hover:text-ink-900 transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl sm:text-h1 font-bold text-ink-900">New Manual Journal Entry</h1>
            <p className="text-xs text-ink-500 mt-0.5">
              Double-entry balanced posting • Real-time trial balance impact
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || !isBalanced || isPeriodClosed}
            className="flex items-center gap-1.5 h-8 px-4 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-sm text-xs font-semibold shadow-sm transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Post to General Ledger</span>
          </button>
        </div>
      </div>

      {/* Blocked Period Warning Banner (Demo Step 7 Requirement) */}
      {isPeriodClosed && (
        <div className="p-4 bg-danger-bg text-danger border border-danger/40 rounded-md text-xs flex items-center justify-between animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <div>
              <div className="font-bold">Posting Blocked: Period {selectedPeriod?.name} is Closed</div>
              <div className="text-[11px] opacity-90 mt-0.5">
                Controls policy prohibits ledger writes to closed fiscal periods. You must request a formal reopening requiring dual CFO approval.
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate(`/${coSlug}/periods`)}
            className="px-3 py-1 bg-surface border border-danger text-danger hover:bg-danger hover:text-white rounded-sm text-xs font-semibold transition-colors shrink-0 ml-4"
          >
            Request Period Reopen
          </button>
        </div>
      )}

      {errorMessage && !isPeriodClosed && (
        <div className="p-3 bg-danger-bg text-danger border border-danger/30 rounded-md text-xs font-medium flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Header Fields: Date, Reference, Period */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-5 bg-surface border border-ink-200 rounded-md shadow-sm">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-700 flex items-center justify-between">
            <span>Journal Date</span>
            {/* Quick Demo Helper: click to test closed Sep 2026 */}
            <span
              onClick={() => setJournalDate('2026-09-15')}
              className="text-[10px] text-brand-600 cursor-pointer hover:underline"
            >
              Set Sep 2026 (Demo Step 7)
            </span>
          </label>
          <input
            type="date"
            value={journalDate}
            onChange={(e) => setJournalDate(e.target.value)}
            className="h-8 px-2.5 bg-surface border border-ink-200 rounded-sm text-xs font-mono text-ink-900 focus:outline-none focus:border-brand-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-700">Target Fiscal Period</label>
          <div className="h-8 px-2.5 bg-ink-100 border border-ink-200 rounded-sm text-xs font-mono flex items-center justify-between text-ink-700">
            <span>{selectedPeriod?.name || 'Oct 2026'}</span>
            <span
              className={`text-[10px] uppercase font-bold px-1.5 py-0.2 rounded ${
                selectedPeriod?.status === 'open'
                  ? 'bg-success-bg text-success'
                  : 'bg-danger-bg text-danger'
              }`}
            >
              {selectedPeriod?.status || 'Open'}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-700">Journal Reference #</label>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. ADJ-OCT-REALLOC"
            className="h-8 px-2.5 bg-surface border border-ink-200 rounded-sm text-xs font-mono text-ink-900 focus:outline-none focus:border-brand-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-700">Currency</label>
          <div className="h-8 px-2.5 bg-ink-100 border border-ink-200 rounded-sm text-xs font-mono flex items-center text-ink-700">
            USD (Base Currency • Rate 1.00000000)
          </div>
        </div>

        <div className="flex flex-col gap-1 md:col-span-4">
          <label className="text-xs font-medium text-ink-700">Journal Narrative / Memo</label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Provide audit explanation for this adjustment..."
            className="h-8 px-2.5 bg-surface border border-ink-200 rounded-sm text-xs text-ink-900 focus:outline-none focus:border-brand-500"
          />
        </div>
      </div>

      {/* Line Grid with live balancing pill */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-ink-900 uppercase tracking-wider">
            Double-Entry Journal Lines
          </span>
          <span className="text-[11px] text-ink-500">
            Tab / Enter to navigate • ⌘ + Enter to append new line
          </span>
        </div>

        <LineGrid
          mode="journal"
          lines={lines}
          onChange={setLines}
          accounts={accounts}
          dimensions={dimensions}
          currency="USD"
        />
      </div>
    </div>
  );
};
