/**
 * Billing Operations Console per docs/10_SaaS_Admin.md §3.5 and §10.
 * Invoices aging, Stripe payouts reconciliation, dual-approval refunds queue,
 * ASC 606 revenue recognition export, and dunning engine configuration.
 */

import React, { useState, useMemo } from 'react';
import { useAdminStore } from '@/mock/store/adminStore';
import { StripeInvoiceMirrored } from '@/types/admin';
import { StatusPill } from '@/components/domain/StatusPill';
import { adminBillingApi } from '@/mock/api/admin/billing';
import { toast } from 'sonner';
import {
  CreditCard,
  Download,
  Search,
  Filter,
  ShieldCheck,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Clock,
  ArrowRight,
  KeyRound,
  FileText,
  DollarSign,
  TrendingDown,
} from 'lucide-react';

export const BillingOps: React.FC = () => {
  const {
    invoices,
    approvals,
    currentAdmin,
    decideApproval,
    requestRefundApproval,
  } = useAdminStore();

  const [activeTab, setActiveTab] = useState<'invoices' | 'refunds_queue' | 'dunning' | 'tax_recon'>('invoices');
  const [invoiceSearch, setInvoiceSearch] = useState('');
  const [invoiceStatusFilter, setInvoiceStatusFilter] = useState<string>('all');

  // Approval modal PIN signing
  const [selectedApprovalId, setSelectedApprovalId] = useState<string | null>(null);
  const [pinInput, setPinInput] = useState('223344');
  const [rejectionReason, setRejectionReason] = useState('');
  const [showSignDialog, setShowSignDialog] = useState(false);

  // Filtered Invoices
  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      if (invoiceStatusFilter !== 'all' && inv.status !== invoiceStatusFilter) return false;
      if (invoiceSearch.trim()) {
        const q = invoiceSearch.toLowerCase();
        return (
          inv.number.toLowerCase().includes(q) ||
          inv.tenantId.toLowerCase().includes(q) ||
          inv.stripeId.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [invoices, invoiceStatusFilter, invoiceSearch]);

  // Pending Refund Approvals
  const pendingRefunds = useMemo(() => {
    return approvals.filter((a) => a.kind === 'refund' && a.status === 'pending');
  }, [approvals]);

  // Export ASC 606 CSV
  const handleExportAsc606 = async () => {
    try {
      const csv = await adminBillingApi.exportRevenueScheduleCsv();
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ASC606_Revenue_Recognition_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      toast.success('ASC 606 Deferred Revenue Recognition schedule exported (CSV)');
    } catch {
      toast.error('Export failed');
    }
  };

  const handleDecideApproval = (decision: 'approved' | 'rejected') => {
    if (!selectedApprovalId) return;
    try {
      decideApproval(selectedApprovalId, decision, pinInput, rejectionReason);
      setShowSignDialog(false);
      setSelectedApprovalId(null);
      toast.success(`Refund request marked as ${decision.toUpperCase()}!`);
    } catch (err: any) {
      toast.error(err.message || 'Approval signing failed');
    }
  };

  return (
    <div className="flex-1 flex flex-col p-4 space-y-3 max-w-7xl mx-auto w-full select-none text-text-primary">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight">Billing & Revenue Operations</h1>
            <span className="px-2 py-0.5 rounded-full bg-violet-soft text-violet text-[10px] font-mono font-semibold">
              Stripe Mirrored • 400 Invoices
            </span>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Aging schedules, automated dunning, two-person refund approvals, and ASC 606 revenue recognition.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportAsc606}
            className="h-8 px-3 rounded-sm bg-surface border border-border hover:border-border-strong text-text-primary text-xs font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-text-muted" />
            <span>Export ASC 606 Schedule</span>
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1.5 border-b border-border text-xs overflow-x-auto no-scrollbar flex-nowrap">
        <button
          type="button"
          onClick={() => setActiveTab('invoices')}
          className={`px-3 py-1.5 border-b-2 font-medium flex items-center gap-1.5 transition cursor-pointer shrink-0 whitespace-nowrap ${
            activeTab === 'invoices'
              ? 'border-violet text-violet font-semibold'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <span>All Mirrored Invoices ({invoices.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('refunds_queue')}
          className={`px-3 py-1.5 border-b-2 font-medium flex items-center gap-1.5 transition cursor-pointer shrink-0 whitespace-nowrap ${
            activeTab === 'refunds_queue'
              ? 'border-violet text-violet font-semibold'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <span>Dual-Approval Refunds Queue</span>
          {pendingRefunds.length > 0 && (
            <span className="px-1.5 py-0.2 rounded-full bg-warning-soft text-warning font-mono text-[10px] font-bold">
              {pendingRefunds.length} Pending
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('dunning')}
          className={`px-3 py-1.5 border-b-2 font-medium flex items-center gap-1.5 transition cursor-pointer shrink-0 whitespace-nowrap ${
            activeTab === 'dunning'
              ? 'border-violet text-violet font-semibold'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <span>Dunning Cadence & Suspension Rules</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('tax_recon')}
          className={`px-3 py-1.5 border-b-2 font-medium flex items-center gap-1.5 transition cursor-pointer shrink-0 whitespace-nowrap ${
            activeTab === 'tax_recon'
              ? 'border-violet text-violet font-semibold'
              : 'border-transparent text-text-muted hover:text-text-primary'
          }`}
        >
          <span>Stripe Tax & Payouts Recon</span>
        </button>
      </div>

      {/* Tab 1: Invoices Table */}
      {activeTab === 'invoices' && (
        <div className="space-y-3">
          {/* Filters Bar */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={invoiceSearch}
                  onChange={(e) => setInvoiceSearch(e.target.value)}
                  placeholder="Filter invoice or tenant ID..."
                  className="h-8 pl-8 pr-3 w-56 text-xs bg-surface border border-border rounded-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                />
              </div>

              <select
                value={invoiceStatusFilter}
                onChange={(e) => setInvoiceStatusFilter(e.target.value)}
                className="h-8 px-2 bg-surface border border-border rounded-sm text-xs text-text-secondary"
              >
                <option value="all">All Invoice Statuses</option>
                <option value="paid">Paid</option>
                <option value="open">Open (Past Due)</option>
                <option value="refunded">Refunded</option>
                <option value="void">Void</option>
              </select>
            </div>

            <div className="text-xs text-text-muted font-mono">
              Showing {filteredInvoices.length} of {invoices.length} Invoices
            </div>
          </div>

          {/* 36px Table */}
          <div className="rounded bg-surface border border-border overflow-hidden">
            <div className="overflow-x-auto max-h-[520px]">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-surface-neutral/90 backdrop-blur-xs border-b border-border z-10">
                  <tr className="h-8 text-text-muted text-[11px] uppercase font-semibold">
                    <th className="px-3">Invoice #</th>
                    <th className="px-3">Tenant ID</th>
                    <th className="px-3">Issued Date</th>
                    <th className="px-3">Status</th>
                    <th className="px-3 text-right">Subtotal</th>
                    <th className="px-3 text-right">Tax (VAT)</th>
                    <th className="px-3 text-right">Total</th>
                    <th className="px-3">Dunning</th>
                    <th className="px-3 text-right">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {filteredInvoices.slice(0, 50).map((inv: StripeInvoiceMirrored) => (
                    <tr key={inv.id} className="h-9 hover:bg-surface-neutral/50 transition-colors">
                      <td className="px-3 font-mono font-bold text-text-primary">{inv.number}</td>
                      <td className="px-3 font-mono text-text-secondary">{inv.tenantId}</td>
                      <td className="px-3 font-mono text-[11px] text-text-muted">{inv.paidAt || inv.dueAt}</td>
                      <td className="px-3">
                        <StatusPill status={inv.status as any} />
                      </td>
                      <td className="px-3 text-right font-mono text-text-secondary">
                        ${(inv.subtotal / 100).toFixed(2)}
                      </td>
                      <td className="px-3 text-right font-mono text-text-muted">
                        ${(inv.tax / 100).toFixed(2)}
                      </td>
                      <td className="px-3 text-right font-mono font-bold text-text-primary">
                        ${(inv.total / 100).toFixed(2)}
                      </td>
                      <td className="px-3 font-mono text-[11px] text-text-muted">
                        {inv.dunningStage && inv.dunningStage > 0 ? (
                          <span className="text-warning font-semibold">Stage {inv.dunningStage}</span>
                        ) : (
                          'Normal'
                        )}
                      </td>
                      <td className="px-3 text-right">
                        <button
                          type="button"
                          onClick={() => toast.success(`Generated official Stripe PDF invoice for ${inv.number}`)}
                          className="p-1 rounded hover:bg-surface-neutral text-text-muted hover:text-text-primary cursor-pointer"
                        >
                          <Download className="w-3.5 h-3.5" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Dual-Approval Refunds Queue */}
      {activeTab === 'refunds_queue' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Maker / Checker Authorization Queue (Four-Eyes Principle)
            </h3>
            <span className="text-[11px] text-text-muted font-mono">
              Approver must be distinct from request maker
            </span>
          </div>

          <div className="rounded bg-surface border border-border divide-y divide-border/60">
            {approvals.length === 0 ? (
              <div className="p-8 text-center text-text-muted text-xs">
                No refund requests pending review.
              </div>
            ) : (
              approvals.map((req) => {
                const isMaker = req.requestedBy.id === currentAdmin.id;
                const canApprove = req.status === 'pending' && !isMaker;

                return (
                  <div key={req.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-text-primary uppercase px-1.5 py-0.2 rounded bg-surface-neutral">
                          {req.kind}
                        </span>
                        <span className="font-bold text-text-primary">
                          Amount: ${((req.amount || 0) / 100).toFixed(2)} {req.currency || 'USD'}
                        </span>
                        <StatusPill status={req.status as any} />
                      </div>
                      <div className="text-text-muted text-[11px]">
                        Target Invoice: <span className="font-mono text-text-primary">{req.subjectData?.invoiceId || req.tenantId}</span> • Reason: {req.description || req.subjectData?.reason}
                      </div>
                      <div className="text-[10px] font-mono text-text-muted">
                        Requested by: <span className="text-text-primary">{req.requestedBy.name}</span> on {new Date(req.createdAt).toLocaleString()}
                        {req.decidedAt && req.approvedBy && ` • Decided by: ${req.approvedBy.name}`}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {req.status === 'pending' ? (
                        <>
                          {isMaker ? (
                            <span className="text-[11px] text-warning font-mono italic">
                              Cannot sign (You are the maker)
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedApprovalId(req.id);
                                setShowSignDialog(true);
                              }}
                              className="h-8 px-3 rounded bg-violet text-white hover:opacity-90 font-medium text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                            >
                              <KeyRound className="w-3.5 h-3.5" />
                              <span>Sign & Decide</span>
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="text-[11px] font-mono font-semibold text-text-muted">
                          Decision Locked
                        </span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}

      {/* Tab 3: Dunning Cadence */}
      {activeTab === 'dunning' && (
        <div className="p-4 rounded bg-surface border border-border space-y-4 text-xs">
          <div>
            <h3 className="font-bold text-sm text-text-primary">Automated SaaS Dunning Lifecycle Engine</h3>
            <p className="text-text-muted mt-0.5">Configured per docs/10_SaaS_Admin.md §5 lifecycle transitions</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="p-3 rounded bg-surface-neutral/50 border border-border space-y-1">
              <span className="font-semibold text-text-primary">Stage 1: Grace Period</span>
              <div className="font-mono text-violet font-bold text-sm">Days 1 – 7</div>
              <p className="text-[11px] text-text-muted">Retry card every 48h. Soft amber in-app warning banner shown.</p>
            </div>

            <div className="p-3 rounded bg-surface-neutral/50 border border-border space-y-1">
              <span className="font-semibold text-text-primary">Stage 2: Read-Only Mode</span>
              <div className="font-mono text-warning font-bold text-sm">Days 8 – 21</div>
              <p className="text-[11px] text-text-muted">Posting blocked. Customer can only view reports and update payment card.</p>
            </div>

            <div className="p-3 rounded bg-surface-neutral/50 border border-border space-y-1">
              <span className="font-semibold text-text-primary">Stage 3: Account Suspension</span>
              <div className="font-mono text-danger font-bold text-sm">Day 22</div>
              <p className="text-[11px] text-text-muted">App locked. DNS redirected to customer billing portal.</p>
            </div>

            <div className="p-3 rounded bg-surface-neutral/50 border border-border space-y-1">
              <span className="font-semibold text-text-primary">Stage 4: Data Retention & Purge</span>
              <div className="font-mono text-text-secondary font-bold text-sm">Day 90+</div>
              <p className="text-[11px] text-text-muted">GDPR encrypted archive retained for 90 days before permanent deletion.</p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Tax Recon */}
      {activeTab === 'tax_recon' && (
        <div className="p-4 rounded bg-surface border border-border space-y-3 text-xs">
          <h3 className="font-bold text-sm text-text-primary">Stripe Automated Tax & Bank Payout Reconciliation</h3>
          <p className="text-text-muted">Tax collected by jurisdiction and reconciled to Stripe balance payout batches.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="p-3 rounded bg-surface-neutral/50 border border-border">
              <div className="text-[10px] text-text-muted uppercase">VAT Collected (Kenya 16%)</div>
              <div className="text-base font-mono font-bold text-text-primary mt-1">$2,140.00</div>
              <div className="text-[10px] text-success mt-0.5">KRA e-TIMS Synced</div>
            </div>
            <div className="p-3 rounded bg-surface-neutral/50 border border-border">
              <div className="text-[10px] text-text-muted uppercase">EU Reverse-Charge (0%)</div>
              <div className="text-base font-mono font-bold text-text-primary mt-1">$4,820.00</div>
              <div className="text-[10px] text-text-muted mt-0.5">VIES Validated</div>
            </div>
            <div className="p-3 rounded bg-surface-neutral/50 border border-border">
              <div className="text-[10px] text-text-muted uppercase">Next Stripe Net Payout</div>
              <div className="text-base font-mono font-bold text-text-primary mt-1">$36,260.00</div>
              <div className="text-[10px] text-text-muted mt-0.5">Settles Nov 01, 2026</div>
            </div>
          </div>
        </div>
      )}

      {/* SignDialog Dual-Approval PIN Signing Modal */}
      {showSignDialog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-md bg-surface border border-border rounded-lg shadow-xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center gap-2 text-violet">
              <ShieldCheck className="w-5 h-5 shrink-0" />
              <h3 className="text-sm font-bold text-text-primary">Dual-Approval Signing (PIN Verification)</h3>
            </div>
            <p className="text-xs text-text-muted">
              Signing as <strong className="text-text-primary">{currentAdmin.name}</strong> ({currentAdmin.role.toUpperCase()}).
              Your signing PIN will be cryptographically sealed in the audit block.
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-text-secondary block mb-1">Enter 6-Digit Staff Signing PIN</label>
                <input
                  type="password"
                  maxLength={6}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
                  placeholder="******"
                  className="w-full h-9 px-3 text-center tracking-[0.4em] font-mono font-bold text-base bg-surface border border-border rounded"
                />
                <span className="text-[10px] font-mono text-text-muted block mt-1">
                  Demo PIN for {currentAdmin.name}: {currentAdmin.signingPin}
                </span>
              </div>
            </div>

            <div className="pt-2 border-t border-border flex justify-between gap-2">
              <button
                type="button"
                onClick={() => handleDecideApproval('rejected')}
                className="h-8 px-3 rounded bg-danger-soft text-danger hover:opacity-90 font-medium text-xs cursor-pointer"
              >
                Reject Request
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowSignDialog(false)}
                  className="h-8 px-3 rounded border border-border hover:bg-surface-neutral text-xs cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => handleDecideApproval('approved')}
                  className="h-8 px-4 rounded bg-success text-white hover:opacity-90 font-semibold text-xs cursor-pointer shadow-xs"
                >
                  Authorize & Sign
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
