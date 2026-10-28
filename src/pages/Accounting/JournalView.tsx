import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerlyStore } from '@/mock/store';
import { Journal } from '@/types';
import { DocumentHeader } from '@/components/domain/DocumentHeader';
import { formatMoney, formatDate, formatDateTime } from '@/lib/format';
import {
  RotateCcw,
  Printer,
  Copy,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  Link2,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

export const JournalView: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentCompany, accounts, journals } = useLedgerlyStore();
  const coSlug = currentCompany.slug;

  const [journal, setJournal] = useState<Journal | null>(null);
  const [loading, setLoading] = useState(true);
  const [isReverseOpen, setIsReverseOpen] = useState(false);
  const [reverseReason, setReverseReason] = useState('Correction of erroneous expense allocation');
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    async function loadJournal() {
      if (!id) return;
      const res = await api.getJournalById(id);
      if (res) setJournal(res);
      setLoading(false);
    }
    loadJournal();
  }, [id, journals]);

  if (loading || !journal) {
    return <div className="p-8 text-center text-xs text-ink-500">Loading journal {id}...</div>;
  }

  const handleConfirmReverse = async () => {
    try {
      setActionLoading(true);
      setErrorMsg('');
      const res = await api.reverseJournal(journal.id, reverseReason);
      setJournal(res.original);
      setIsReverseOpen(false);
    } catch (err: any) {
      setErrorMsg(err.message || 'Reversal failed');
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Document Header with Reverse Journal Action */}
      <DocumentHeader
        documentType="General Journal Entry"
        number={journal.number}
        status={journal.status}
        issueDate={journal.journal_date}
        amount={journal.total_debit}
        reference={journal.reference}
        onBack={() => navigate(`/${coSlug}/journals`)}
        onReverse={() => setIsReverseOpen(true)}
      />

      {/* Linked Reversal Notice if already reversed or is a reversal */}
      {journal.status === 'reversed' && journal.reversed_by_id && (
        <div className="p-3.5 bg-reversed-bg/30 border border-reversed/40 rounded-md text-xs flex items-center justify-between text-reversed font-medium">
          <div className="flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-reversed" />
            <span>
              This journal has been reversed. Linked mirror reversal document:{' '}
              <strong className="underline cursor-pointer" onClick={() => navigate(`/${coSlug}/journals/${journal.reversed_by_id}`)}>
                View Reversal Journal
              </strong>
            </span>
          </div>
          <span className="font-mono text-[11px] font-bold">Ledger Balance Restored</span>
        </div>
      )}

      {journal.reversal_of_id && (
        <div className="p-3.5 bg-reversed-bg/30 border border-reversed/40 rounded-md text-xs flex items-center justify-between text-reversed font-medium">
          <div className="flex items-center gap-2">
            <Link2 className="w-4 h-4 text-reversed" />
            <span>
              This is a mirror reversal entry for journal:{' '}
              <strong className="underline cursor-pointer" onClick={() => navigate(`/${coSlug}/journals/${journal.reversal_of_id}`)}>
                View Original Journal
              </strong>
            </span>
          </div>
          <span className="font-mono text-[11px] font-bold">Offsetting Entry</span>
        </div>
      )}

      {/* Journal Details Card */}
      <div className="bg-surface border border-ink-200 rounded-lg p-6 shadow-sm flex flex-col gap-5">
        <div className="flex items-center justify-between border-b border-ink-100 pb-3 text-xs">
          <div>
            <span className="text-[10px] uppercase font-bold text-ink-500 tracking-wider">
              Narrative & Memo
            </span>
            <div className="text-sm font-semibold text-ink-900 mt-1">{journal.memo}</div>
          </div>
          <div className="text-right">
            <span className="text-[10px] uppercase font-bold text-ink-500 tracking-wider">
              Posting Period
            </span>
            <div className="font-mono text-xs font-semibold text-brand-700 mt-1">Oct 2026 (Open)</div>
          </div>
        </div>

        {/* Dense Table of Debits and Credits */}
        <table className="w-full border-collapse table-dense text-left text-xs">
          <thead>
            <tr className="bg-ink-100/80 border-b border-ink-200 text-col-header">
              <th className="w-10 text-center">#</th>
              <th className="w-24">Code</th>
              <th>Account Name</th>
              <th>Dimensions</th>
              <th>Line Memo</th>
              <th className="w-32 text-right">Debit (Dr)</th>
              <th className="w-32 text-right">Credit (Cr)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {journal.lines.map((l, idx) => {
              const acc = accounts.find((a) => a.id === l.account_id);
              return (
                <tr key={l.id}>
                  <td className="text-center font-mono text-ink-500">{idx + 1}</td>
                  <td className="font-mono font-semibold text-brand-600">{acc?.code || '—'}</td>
                  <td className="font-medium text-ink-900">{acc?.name || 'GL Account'}</td>
                  <td>
                    {l.dimensions?.branch && (
                      <span className="text-[10px] font-mono bg-brand-50 text-brand-700 px-1.5 py-0.2 rounded">
                        {l.dimensions.branch}
                      </span>
                    )}
                  </td>
                  <td className="text-ink-500">{l.description}</td>
                  <td className="text-right font-mono font-semibold text-ink-900">
                    {l.debit > 0 ? formatMoney(l.debit) : '—'}
                  </td>
                  <td className="text-right font-mono font-semibold text-ink-900 pr-3">
                    {l.credit > 0 ? formatMoney(l.credit) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="bg-ink-50 font-mono font-bold text-xs border-t border-ink-300">
              <td colSpan={5} className="text-right pr-4 uppercase tracking-wider text-ink-500">
                Totals:
              </td>
              <td className="text-right text-ink-900">{formatMoney(journal.total_debit)}</td>
              <td className="text-right text-ink-900 pr-3">{formatMoney(journal.total_credit)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Confirmation Reversal Dialog (Demo Step 8 Requirement) */}
      <Dialog open={isReverseOpen} onOpenChange={setIsReverseOpen}>
        <DialogContent className="max-w-[480px] p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <RotateCcw className="w-4 h-4 text-accent" />
              <span>Reverse General Journal Entry</span>
            </DialogTitle>
          </DialogHeader>

          {errorMsg && (
            <div className="p-2.5 bg-danger-soft text-danger text-xs rounded-sm border border-danger/30">
              {errorMsg}
            </div>
          )}

          <div className="text-xs text-text-secondary flex flex-col gap-2.5">
            <p>
              Controls policy prohibits deleting or editing posted ledger rows. This action creates
              an exact mirror reversal transaction:
            </p>

            <div className="bg-surface-neutral p-3 rounded-sm border border-border flex flex-col gap-1.5 font-mono text-[11px]">
              <div className="flex justify-between">
                <span className="text-text-muted">Target Journal:</span>
                <span className="font-semibold text-text-primary">{journal.number}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Reversal Amount:</span>
                <span className="font-semibold text-text-primary">{formatMoney(journal.total_debit)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Reversal Period:</span>
                <span className="font-semibold text-accent">Oct 2026 (Open)</span>
              </div>
            </div>

            <div className="flex flex-col gap-1 mt-1">
              <label className="text-[11px] font-semibold text-text-primary">
                Reason for Reversal (Audit Trail)
              </label>
              <input
                type="text"
                value={reverseReason}
                onChange={(e) => setReverseReason(e.target.value)}
                className="h-8 px-2 text-xs bg-surface border border-border rounded-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <p className="text-[11px] text-text-muted italic">
              Consequence: An offsetting entry will be posted immediately, reducing the Trial
              Balance back to its prior state.
            </p>
          </div>

          <DialogFooter className="gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setIsReverseOpen(false)}
              disabled={actionLoading}
              className="px-3.5 py-1.5 rounded-sm border border-border hover:bg-surface-neutral text-xs font-medium text-text-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmReverse}
              disabled={actionLoading || !reverseReason.trim()}
              className="px-4 py-1.5 rounded-sm bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-xs disabled:opacity-50"
            >
              {actionLoading ? 'Posting Reversal...' : 'Confirm Reversal Posting'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
