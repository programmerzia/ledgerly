import React, { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerStore } from '@/mock/store';
import { StatusPill } from '@/components/domain/StatusPill';
import { formatDate } from '@/lib/format';
import { PageHeader } from '@/components/domain/PageHeader';
import { IS_LIVE } from '@/api/config';
import { LivePeriods } from './periods/LivePeriods';
import { PeriodTimeline } from './periods/PeriodTimeline';
import { CloseChecklistCard } from './periods/CloseChecklistCard';
import { SignDialog } from '@/components/domain/SignDialog';
import { toast } from 'sonner';
import { Lock, Unlock, ShieldCheck, CheckCircle2, AlertCircle, FileCheck2, UserCheck, ArrowRight } from 'lucide-react';
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

const MockPeriods: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { currentCompany, currentUser, fiscalYear, closeChecks, reopenRequests, users, companySettings, postJournalDirect } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const returnTo = location.state?.returnTo;
  const initialPeriodId = location.state?.periodId || 'per-2026-10';

  const [selectedPeriodId, setSelectedPeriodId] = useState(initialPeriodId);
  const [isReopenModalOpen, setIsReopenModalOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('External auditor year-end cutoff adjustment requested');
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [isYearEndModalOpen, setIsYearEndModalOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  // Signing dialog state for dual approver PIN flows
  const [signingType, setSigningType] = useState<'first' | 'second' | null>(null);

  const selectedPeriod =
    fiscalYear.periods.find((p: any) => p.id === selectedPeriodId) || fiscalYear.periods[9];

  // Active reopen request if exists for this period
  const activeReopenReq = reopenRequests.find(
    (r) => r.period_id === selectedPeriod.id && r.status === 'pending'
  );

  const firstApproverUser = activeReopenReq
    ? users.find((u) => u.id === activeReopenReq.first_approver_id)
    : null;

  const failingChecks = closeChecks.filter((c) => c.status === 'fail');
  const isCloseDisabled = failingChecks.length > 0;
  const closeDisabledReason = isCloseDisabled
    ? `Not ready to close: ${failingChecks.map((c) => c.title).join(', ')}`
    : '';

  // Trigger PIN signing modal for 1st approver
  const handleOpenFirstSign = () => {
    setIsReopenModalOpen(false);
    setSigningType('first');
  };

  // 1st approver signs with PIN
  const handleConfirmFirstSign = async (_pin: string) => {
    try {
      setActionLoading(true);
      setActionError('');
      await api.requestPeriodReopen(selectedPeriod.id, reopenReason);
      setSigningType(null);
      toast.success(
        `Reopen request submitted by ${currentUser.name}. Requires second distinct executive signature (CFO).`
      );
    } catch (err: any) {
      setActionError(err.message || 'Reopen request failed');
      toast.error(err.message || 'Reopen request failed');
    } finally {
      setActionLoading(false);
    }
  };

  // 2nd approver signs with PIN
  const handleConfirmSecondSign = async (_pin: string) => {
    if (!activeReopenReq) return;
    try {
      setActionLoading(true);
      setActionError('');
      await api.approvePeriodReopen(activeReopenReq.id);
      setSigningType(null);
      toast.success(
        `Period ${selectedPeriod.name} unlocked successfully with dual approval! Reopened count updated.`
      );
    } catch (err: any) {
      setActionError(err.message || 'Dual approval failed');
      toast.error(err.message || 'Dual approval failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleClosePeriod = async () => {
    try {
      setActionLoading(true);
      setActionError('');
      await api.closePeriod(selectedPeriod.id);
      setIsCloseModalOpen(false);
      toast.success(`Fiscal period ${selectedPeriod.name} closed and sealed.`);
    } catch (err: any) {
      setActionError(err.message || 'Period close failed');
      toast.error(err.message || 'Period close failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleConfirmYearEndClose = async () => {
    try {
      setActionLoading(true);
      setActionError('');
      postJournalDirect(
        {
          journal_date: '2026-12-31',
          fiscal_period_id: 'per-2026-adj',
          period_id: 'per-2026-adj',
          journal_type: 'closing',
          description: 'FY 2026 Year-End Closing Entry (P&L into Retained Earnings)',
          reference: 'YE-2026-CLOSE',
          currency: 'USD',
          lines: [
            {
              id: 'ye-l1',
              account_id: 'acc-4000',
              description: 'Close Sales Revenue to Retained Earnings',
              debit: 4250000,
              credit: 0,
              currency: 'USD',
              amount_currency: 4250000,
            },
            {
              id: 'ye-l2',
              account_id: 'acc-4900',
              description: 'Close Realised FX Gain to Retained Earnings',
              debit: 250000,
              credit: 0,
              currency: 'USD',
              amount_currency: 250000,
            },
            {
              id: 'ye-l3',
              account_id: 'acc-6100',
              description: 'Close Rent Expense to Retained Earnings',
              debit: 0,
              credit: 1800000,
              currency: 'USD',
              amount_currency: 1800000,
            },
            {
              id: 'ye-l4',
              account_id: 'acc-6200',
              description: 'Close Utilities Expense to Retained Earnings',
              debit: 0,
              credit: 850000,
              currency: 'USD',
              amount_currency: 850000,
            },
            {
              id: 'ye-l5',
              account_id: 'acc-6500',
              description: 'Close Depreciation to Retained Earnings',
              debit: 0,
              credit: 800000,
              currency: 'USD',
              amount_currency: 800000,
            },
            {
              id: 'ye-l6',
              account_id: 'acc-3900',
              description: 'Net FY 2026 Net Income transfer to Retained Earnings',
              debit: 0,
              credit: 1050000,
              currency: 'USD',
              amount_currency: 1050000,
            },
          ],
        },
        currentUser,
        companySettings
      );
      setIsYearEndModalOpen(false);
      toast.success(
        'Year-End closing journal posted. Net income $10,500.00 transferred to 3900 Retained Earnings.'
      );
    } catch (err: any) {
      setActionError(err.message || 'Year-end close failed');
      toast.error(err.message || 'Year-end close failed');
    } finally {
      setActionLoading(false);
    }
  };

  const closed = selectedPeriod.status === 'closed';
  return (
    <div className="flex flex-col gap-6">
      {returnTo && (
        <div className="flex items-center justify-between rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-[13px] text-text-primary">
          <div className="flex items-center gap-2">
            <Unlock className="size-4 shrink-0 text-accent" />
            <span>
              You came here from a journal. {selectedPeriod.name} is currently <strong>{selectedPeriod.status}</strong>.
            </span>
          </div>
          <button
            type="button"
            onClick={() => navigate(returnTo)}
            className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover"
          >
            Back to journal
            <ArrowRight className="size-3.5" />
          </button>
        </div>
      )}

      <PageHeader
        title="Periods and close"
        subtitle="Close each month once everything is checked. Closed months cannot be changed without two approvals."
        actions={
          <>
            <button
              type="button"
              onClick={() => navigate(`/${coSlug}/periods/close-pack`)}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-secondary transition hover:bg-surface-neutral hover:text-text-primary"
            >
              <FileCheck2 className="size-4 text-accent" />
              Close pack
            </button>
            <button
              type="button"
              onClick={() => setIsYearEndModalOpen(true)}
              className="flex h-9 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-secondary transition hover:bg-surface-neutral hover:text-text-primary"
            >
              <Lock className="size-4 text-accent" />
              Year-end close
            </button>
          </>
        }
      />

      {actionError && (
        <div className="flex items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] font-medium text-danger">
          <AlertCircle className="size-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      <PeriodTimeline periods={fiscalYear.periods as any} selectedId={selectedPeriod.id} onSelect={setSelectedPeriodId} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-5">
          {activeReopenReq && (
            <div className="flex flex-col gap-3 rounded-lg border border-warning/40 bg-warning-soft p-5 text-[13px]">
              <div className="flex items-center gap-2 font-semibold text-warning">
                <ShieldCheck className="size-4" />
                Reopening is waiting for a second approval
              </div>
              <p className="text-text-secondary">
                Reason given: <em>"{activeReopenReq.reason}"</em>
              </p>
              <div className="flex flex-wrap justify-between gap-2 rounded-lg border border-border bg-surface p-3 text-xs">
                <span>
                  First approval: <strong>{firstApproverUser?.name || 'Fatima Hassan'}</strong> <span className="text-success">(signed)</span>
                </span>
                <span>
                  Second approval needed from: <strong>Kenneth Mwangi (CFO)</strong>
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                {currentUser.id === activeReopenReq.first_approver_id ? (
                  <div className="flex items-center gap-1.5 text-xs font-medium text-danger">
                    <AlertCircle className="size-3.5 shrink-0" />
                    <span>You gave the first approval. A different person must give the second. Switch to Kenneth Mwangi.</span>
                  </div>
                ) : (
                  <span className="text-xs text-text-muted">Ready for the second approval.</span>
                )}
                {currentUser.id !== activeReopenReq.first_approver_id && (
                  <button
                    type="button"
                    onClick={() => setSigningType('second')}
                    className="flex h-8 items-center gap-1.5 rounded-md bg-success px-4 text-[13px] font-medium text-white transition hover:opacity-90"
                  >
                    <UserCheck className="size-4" />
                    Approve reopening
                  </button>
                )}
              </div>
            </div>
          )}

          <CloseChecklistCard
            checks={closeChecks as any}
            onFix={(chk) => {
              if (chk.check_code === 'BANK_REC') navigate(`/${coSlug}/banking/bnk-1/reconcile`);
              else if (chk.check_code === 'APPROVALS') navigate(`/${coSlug}/approvals`);
              else navigate(`/${coSlug}/dashboard`);
            }}
          />
        </div>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4 lg:self-start">
          <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-text-primary">{selectedPeriod.name}</h2>
              <StatusPill status={selectedPeriod.status} />
            </div>
            <div className="text-xs text-text-muted">
              {formatDate(selectedPeriod.starts_on)} to {formatDate(selectedPeriod.ends_on)}
              {closed && selectedPeriod.closed_at && <div className="mt-1">Closed on {formatDate(selectedPeriod.closed_at)}</div>}
            </div>
            {closed ? (
              <button
                type="button"
                onClick={() => setIsReopenModalOpen(true)}
                className="flex h-8 items-center justify-center gap-1.5 rounded-md bg-accent px-4 text-[13px] font-medium text-white transition hover:bg-accent-hover"
              >
                <Unlock className="size-4" />
                Ask to reopen
              </button>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="block">
                    <button
                      type="button"
                      disabled={isCloseDisabled}
                      onClick={() => setIsCloseModalOpen(true)}
                      className="flex h-8 w-full items-center justify-center gap-1.5 rounded-md bg-text-primary px-3 text-[13px] font-medium text-surface transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Lock className="size-4" />
                      Close {selectedPeriod.name}
                    </button>
                  </span>
                </TooltipTrigger>
                {isCloseDisabled && <TooltipContent className="max-w-xs">{closeDisabledReason}</TooltipContent>}
              </Tooltip>
            )}
            {isCloseDisabled && !closed && (
              <p className="text-xs text-danger">{failingChecks.length} {failingChecks.length === 1 ? 'check is' : 'checks are'} not ready yet.</p>
            )}
          </section>
        </aside>
      </div>

      {/* Request Reopen Modal (Step 1) */}
      <Dialog open={isReopenModalOpen} onOpenChange={setIsReopenModalOpen}>
        <DialogContent className="max-w-[480px] p-6 rounded-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Unlock className="w-4 h-4 text-accent" />
              <span>Ask to reopen {selectedPeriod.name}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="text-xs text-text-secondary flex flex-col gap-2.5">
            <p>
              Period <strong className="text-text-primary">{selectedPeriod.name}</strong> is closed. Two different people have to approve reopening it:
            </p>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-text-primary">Why do you need to reopen it?</label>
              <textarea
                rows={3}
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="e.g. the auditor asked for a correction"
                className="w-full p-2 text-xs bg-surface border border-border rounded-lg text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <p className="text-[11px] text-text-muted italic">
              You approve first ({currentUser.name}) with your PIN. Then a second person (Kenneth Mwangi, CFO) has to approve before anyone can post to this month.
            </p>
          </div>

          <DialogFooter className="gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setIsReopenModalOpen(false)}
              className="h-8 px-3 rounded-md border border-border hover:bg-surface-neutral text-[13px] font-medium text-text-secondary cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleOpenFirstSign}
              disabled={actionLoading || !reopenReason.trim()}
              className="h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium disabled:opacity-50 cursor-pointer"
            >
              Sign and send request
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Period Modal */}
      <Dialog open={isCloseModalOpen} onOpenChange={setIsCloseModalOpen}>
        <DialogContent className="max-w-[480px] p-6 rounded-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Lock className="w-4 h-4 text-text-primary" />
              <span>Close {selectedPeriod.name}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="text-xs text-text-secondary flex flex-col gap-2.5">
            <p>
              Closing <strong className="text-text-primary">{selectedPeriod.name}</strong> stops anyone adding journals, invoices or receipts to it. You can still ask to reopen it later.
            </p>

            {isCloseDisabled ? (
              <div className="p-3 bg-danger-soft border border-danger/30 rounded text-[11px] text-danger font-medium flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-danger" />
                <span>{closeDisabledReason}</span>
              </div>
            ) : (
              <div className="p-3 bg-success-soft border border-success/30 rounded text-[11px] text-success font-medium flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0 text-success" />
                <span>All checks are ready.</span>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setIsCloseModalOpen(false)}
              className="h-8 px-3 rounded-md border border-border hover:bg-surface-neutral text-[13px] font-medium text-text-secondary cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={isCloseDisabled || actionLoading}
              onClick={handleClosePeriod}
              className="h-8 px-3 rounded-md bg-text-primary hover:opacity-90 text-surface text-[13px] font-medium disabled:opacity-50 cursor-pointer"
            >
              Close month
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Year-End Close Modal */}
      <Dialog open={isYearEndModalOpen} onOpenChange={setIsYearEndModalOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Lock className="w-4 h-4 text-accent" />
              <span>Year-end close for FY 2026</span>
            </DialogTitle>
          </DialogHeader>

          <div className="text-xs text-text-secondary flex flex-col gap-3">
            <p>
              This transaction closes all temporary revenue and expense accounts for the fiscal year ending{' '}
              <strong className="text-text-primary">2026-12-31</strong> and transfers the net operating income of{' '}
              <strong className="text-success">$10,500.00</strong> into <strong className="text-text-primary">3900 Retained Earnings</strong>.
            </p>

            <div className="border border-border rounded-md overflow-hidden">
              <div className="bg-surface-neutral px-3 py-1.5 text-[11px] font-semibold text-text-primary border-b border-border flex justify-between">
                <span>Closing Journal Lines Preview (YE-2026-CLOSE)</span>
                <span className="font-mono text-text-muted">Balanced · $45,000.00 Dr / Cr</span>
              </div>
              <table className="w-full text-[11px]">
                <thead className="bg-surface border-b border-border text-text-muted font-medium">
                  <tr>
                    <th className="px-3 py-1.5 text-left">Account</th>
                    <th className="px-3 py-1.5 text-left">Classification</th>
                    <th className="px-3 py-1.5 text-right">Debit ($)</th>
                    <th className="px-3 py-1.5 text-right">Credit ($)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  <tr>
                    <td className="px-3 py-1.5 font-mono text-text-primary">4000 Sales Revenue</td>
                    <td className="px-3 py-1.5 text-text-muted">Income (close)</td>
                    <td className="px-3 py-1.5 text-right font-mono text-text-primary">42,500.00</td>
                    <td className="px-3 py-1.5 text-right font-mono text-text-muted">0.00</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5 font-mono text-text-primary">4900 Realised FX Gain</td>
                    <td className="px-3 py-1.5 text-text-muted">Other Income (close)</td>
                    <td className="px-3 py-1.5 text-right font-mono text-text-primary">2,500.00</td>
                    <td className="px-3 py-1.5 text-right font-mono text-text-muted">0.00</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5 font-mono text-text-primary">6100 Rent Expense</td>
                    <td className="px-3 py-1.5 text-text-muted">Expense (close)</td>
                    <td className="px-3 py-1.5 text-right font-mono text-text-muted">0.00</td>
                    <td className="px-3 py-1.5 text-right font-mono text-text-primary">18,000.00</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5 font-mono text-text-primary">6200 Utilities & Comm</td>
                    <td className="px-3 py-1.5 text-text-muted">Expense (close)</td>
                    <td className="px-3 py-1.5 text-right font-mono text-text-muted">0.00</td>
                    <td className="px-3 py-1.5 text-right font-mono text-text-primary">8,500.00</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-1.5 font-mono text-text-primary">6500 Depreciation Expense</td>
                    <td className="px-3 py-1.5 text-text-muted">Expense (close)</td>
                    <td className="px-3 py-1.5 text-right font-mono text-text-muted">0.00</td>
                    <td className="px-3 py-1.5 text-right font-mono text-text-primary">8,000.00</td>
                  </tr>
                  <tr className="bg-accent-soft/40 font-semibold">
                    <td className="px-3 py-1.5 font-mono text-accent">3900 Retained Earnings</td>
                    <td className="px-3 py-1.5 text-accent">Equity (Net Profit)</td>
                    <td className="px-3 py-1.5 text-right font-mono text-text-muted">0.00</td>
                    <td className="px-3 py-1.5 text-right font-mono text-accent">10,500.00</td>
                  </tr>
                </tbody>
                <tfoot className="bg-surface font-semibold border-t border-border">
                  <tr>
                    <td colSpan={2} className="px-3 py-1.5 text-text-primary">Total</td>
                    <td className="px-3 py-1.5 text-right font-mono text-text-primary">$45,000.00</td>
                    <td className="px-3 py-1.5 text-right font-mono text-text-primary">$45,000.00</td>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="p-2.5 bg-surface-neutral border border-border rounded text-[11px] text-text-muted">
              The entry is numbered in sequence and recorded in the activity log.
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setIsYearEndModalOpen(false)}
              className="h-8 px-3 rounded-md border border-border hover:bg-surface-neutral text-[13px] font-medium text-text-secondary cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={actionLoading}
              onClick={handleConfirmYearEndClose}
              className="h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium disabled:opacity-50 cursor-pointer"
            >
              {actionLoading ? 'Posting...' : 'Post year-end entry'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 1st Approver SignDialog */}
      <SignDialog
        isOpen={signingType === 'first'}
        onClose={() => setSigningType(null)}
        onConfirm={handleConfirmFirstSign}
        documentTitle={`Reopen request: ${selectedPeriod.name}`}
        documentNumber={selectedPeriod.name}
        actionTitle="Send reopen request (1 of 2)"
        consequenceText={`Your signature is saved as the first approval. A second person must approve before the month reopens.`}
      />

      {/* 2nd Approver SignDialog */}
      <SignDialog
        isOpen={signingType === 'second'}
        onClose={() => setSigningType(null)}
        onConfirm={handleConfirmSecondSign}
        documentTitle={`Reopen approval: ${selectedPeriod.name}`}
        documentNumber={selectedPeriod.name}
        actionTitle="Approve reopening (2 of 2)"
        consequenceText={`This reopens ${selectedPeriod.name} so entries can be added again.`}
      />
    </div>
  );
};

/** Mock mode keeps the original screen; live mode reads and writes the API (docs/15). */
export const Periods: React.FC = IS_LIVE ? LivePeriods : MockPeriods;
