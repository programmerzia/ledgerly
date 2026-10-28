import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerlyStore } from '@/mock/store';
import { StatusPill } from '@/components/domain/StatusPill';
import { formatDate } from '@/lib/format';
import {
  Calendar,
  Lock,
  Unlock,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  FileCheck2,
  X,
  UserCheck,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

export const Periods: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, currentUser, fiscalYear, closeChecks, reopenRequests } = useLedgerlyStore();
  const coSlug = currentCompany.slug;

  const [selectedPeriodId, setSelectedPeriodId] = useState('per-2026-10'); // Oct 2026
  const [isReopenModalOpen, setIsReopenModalOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState('External auditor year-end cutoff adjustment requested');
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [actionError, setActionError] = useState('');
  const [actionLoading, setActionLoading] = useState(false);

  const selectedPeriod = fiscalYear.periods.find((p: any) => p.id === selectedPeriodId) || fiscalYear.periods[9];

  // Active reopen request if exists for this period
  const activeReopenReq = reopenRequests.find((r) => r.period_id === selectedPeriod.id && r.status === 'pending');

  const handleRequestReopen = async () => {
    try {
      setActionLoading(true);
      setActionError('');
      await api.requestPeriodReopen(selectedPeriod.id, reopenReason);
      setIsReopenModalOpen(false);
    } catch (err: any) {
      setActionError(err.message || 'Reopen request failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleApproveReopen = async () => {
    if (!activeReopenReq) return;
    try {
      setActionLoading(true);
      setActionError('');
      // Second approver approves (Kenneth Mwangi in Demo Step 7)
      await api.approvePeriodReopen(activeReopenReq.id);
    } catch (err: any) {
      setActionError(err.message || 'Dual approval failed');
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
    } catch (err: any) {
      setActionError(err.message || 'Period close failed');
    } finally {
      setActionLoading(false);
    }
  };

  // Helper to test closed Sep 2026
  const handleSelectSep = () => {
    setSelectedPeriodId('per-2026-09');
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-ink-200">
        <div>
          <h1 className="text-h1 font-bold text-ink-900 flex items-center gap-2">
            <Calendar className="w-6 h-6 text-brand-600" />
            Fiscal Periods & Close Control Checklist
          </h1>
          <p className="text-xs text-ink-500 mt-0.5">
            FY 2026 Calendar • Dual-approval period reopening • Gapless month-end locking
          </p>
        </div>

        <div className="flex items-center gap-2">
          {selectedPeriod.status === 'open' ? (
            <button
              type="button"
              onClick={() => setIsCloseModalOpen(true)}
              className="flex items-center gap-1.5 h-8 px-4 bg-ink-900 hover:bg-black text-white rounded-sm text-xs font-semibold shadow-sm transition-colors"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>Execute Period Close</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setIsReopenModalOpen(true)}
              className="flex items-center gap-1.5 h-8 px-4 bg-brand-600 hover:bg-brand-700 text-white rounded-sm text-xs font-semibold shadow-sm transition-colors"
            >
              <Unlock className="w-3.5 h-3.5" />
              <span>Request Reopen (Dual Approver)</span>
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="p-3 bg-danger-bg text-danger border border-danger/30 rounded-md text-xs font-medium flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {/* Main Grid: Periods Table on Left, Close Checklist on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: 12 Fiscal Periods */}
        <div className="bg-surface border border-ink-200 rounded-lg p-5 shadow-sm flex flex-col gap-3">
          <div className="flex items-center justify-between border-b border-ink-100 pb-2">
            <span className="text-xs font-semibold text-ink-900 uppercase tracking-wider">
              FY 2026 Calendar (Jan–Dec)
            </span>
            <span className="text-[11px] text-ink-500 font-mono">12 Monthly Periods</span>
          </div>

          <div className="divide-y divide-ink-100 max-h-[500px] overflow-y-auto">
            {fiscalYear.periods.map((p: any) => {
              const isSelected = selectedPeriod.id === p.id;
              return (
                <div
                  key={p.id}
                  onClick={() => setSelectedPeriodId(p.id)}
                  className={`p-3 rounded-md cursor-pointer transition-all flex items-center justify-between ${
                    isSelected
                      ? 'bg-brand-50 border border-brand-500/50 font-medium'
                      : 'hover:bg-ink-50 border border-transparent'
                  }`}
                >
                  <div className="flex flex-col">
                    <span className="text-xs font-semibold text-ink-900">{p.name}</span>
                    <span className="text-[11px] text-ink-500 font-mono">
                      {formatDate(p.starts_on)} – {formatDate(p.ends_on)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {p.reopened_count > 0 && (
                      <span className="text-[10px] bg-warning-bg text-warning font-mono px-1 rounded">
                        Reopened {p.reopened_count}x
                      </span>
                    )}
                    <StatusPill status={p.status} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right: Selected Period Details & Close Checklist Controls */}
        <div className="lg:col-span-2 flex flex-col gap-5">
          {/* Active Period Card */}
          <div className="p-5 bg-surface border border-ink-200 rounded-lg shadow-sm flex flex-col gap-3">
            <div className="flex items-center justify-between border-b border-ink-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-h2 font-bold text-ink-900">{selectedPeriod.name}</span>
                <StatusPill status={selectedPeriod.status} size="md" />
              </div>

              {selectedPeriod.status === 'closed' && (
                <span className="text-xs text-ink-500">
                  Closed on {formatDate(selectedPeriod.closed_at)} by Fatima Hassan
                </span>
              )}
            </div>

            {/* Dual Approver Reopen Banner if pending (Demo Step 7 Requirement!) */}
            {activeReopenReq && (
              <div className="p-4 bg-warning-bg/40 border border-warning/50 rounded-md text-xs flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 font-bold text-warning">
                    <ShieldCheck className="w-4 h-4" />
                    <span>Reopen Request Pending Second Approval (Dual-Control)</span>
                  </div>
                  <span className="text-[11px] text-ink-500 font-mono">
                    Req ID: {activeReopenReq.id}
                  </span>
                </div>

                <p className="text-ink-700">
                  Reason submitted by Maker: <em>"{activeReopenReq.reason}"</em>
                </p>

                <div className="p-2.5 bg-surface rounded border border-ink-200 flex items-center justify-between text-[11px]">
                  <span>
                    1st Approver: <strong>Rahim Ahmed (Accountant)</strong>
                  </span>
                  <span>
                    Required 2nd Approver: <strong>Kenneth Mwangi (CFO)</strong>
                  </span>
                </div>

                <div className="flex justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={handleApproveReopen}
                    className="flex items-center gap-1.5 h-8 px-4 bg-success hover:opacity-90 text-white rounded-sm text-xs font-semibold shadow-sm transition-colors"
                  >
                    <UserCheck className="w-3.5 h-3.5" />
                    <span>Approve Reopening as Kenneth (CFO)</span>
                  </button>
                </div>
              </div>
            )}

            {/* Checklist of 5 Period Close Controls */}
            <div className="flex flex-col gap-2.5 pt-1">
              <span className="text-xs font-semibold text-ink-900 uppercase tracking-wider">
                Controls Verification Suite (5 Pre-Close Checks)
              </span>

              <div className="border border-ink-200 rounded-md bg-surface overflow-hidden divide-y divide-ink-100">
                {closeChecks.map((chk) => (
                  <div key={chk.id} className="p-3.5 flex items-start justify-between gap-4 text-xs">
                    <div className="flex items-start gap-3">
                      {chk.status === 'pass' ? (
                        <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" />
                      ) : (
                        <AlertCircle className="w-4 h-4 text-danger shrink-0 mt-0.5" />
                      )}
                      <div className="flex flex-col">
                        <span className="font-semibold text-ink-900">{chk.title}</span>
                        <span className="text-[11px] text-ink-500 mt-0.5">{chk.detail}</span>
                      </div>
                    </div>

                    <span
                      className={`text-[10px] font-mono font-bold uppercase px-2 py-0.5 rounded border ${
                        chk.status === 'pass'
                          ? 'bg-success-bg text-success border-success/30'
                          : 'bg-danger-bg text-danger border-danger/30'
                      }`}
                    >
                      {chk.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Request Reopen Modal */}
      <Dialog open={isReopenModalOpen} onOpenChange={setIsReopenModalOpen}>
        <DialogContent className="max-w-[480px] p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Unlock className="w-4 h-4 text-accent" />
              <span>Request Period Reopening</span>
            </DialogTitle>
          </DialogHeader>

          <div className="text-xs text-text-secondary flex flex-col gap-2.5">
            <p>
              Period <strong className="text-text-primary">{selectedPeriod.name}</strong> is currently locked. Dual-authorization
              is required to reopen for audited adjustments:
            </p>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-text-primary">Audit Justification</label>
              <textarea
                rows={3}
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                placeholder="Detail the mandatory ledger adjustment and auditor reference..."
                className="w-full p-2 text-xs bg-surface border border-border rounded-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>

            <p className="text-[11px] text-text-muted italic">
              Rule: After your submission, a second distinct executive approver (Kenneth Mwangi, CFO)
              must authorize before posting is unlocked.
            </p>
          </div>

          <DialogFooter className="gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setIsReopenModalOpen(false)}
              className="px-3.5 py-1.5 rounded-sm border border-border hover:bg-surface-neutral text-xs font-medium text-text-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleRequestReopen}
              disabled={actionLoading || !reopenReason.trim()}
              className="px-4 py-1.5 rounded-sm bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-xs disabled:opacity-50"
            >
              Submit Reopen Request
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Close Period Modal */}
      <Dialog open={isCloseModalOpen} onOpenChange={setIsCloseModalOpen}>
        <DialogContent className="max-w-[480px] p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <Lock className="w-4 h-4 text-text-primary" />
              <span>Close Fiscal Period {selectedPeriod.name}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="text-xs text-text-secondary flex flex-col gap-2.5">
            <p>
              Closing <strong className="text-text-primary">{selectedPeriod.name}</strong> seals the general ledger against
              any further journal writes, invoice approvals, or receipt postings.
            </p>

            <div className="p-3 bg-success-soft border border-success/30 rounded text-[11px] text-success font-medium flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-success" />
              <span>All 5 pre-close verification checks confirmed passed.</span>
            </div>
          </div>

          <DialogFooter className="gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setIsCloseModalOpen(false)}
              className="px-3.5 py-1.5 rounded-sm border border-border hover:bg-surface-neutral text-xs font-medium text-text-secondary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleClosePeriod}
              className="px-4 py-1.5 rounded-sm bg-text-primary hover:bg-black text-surface text-xs font-semibold shadow-xs"
            >
              Confirm & Lock Period
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
