import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { AuditEvent } from '@/types';
import { SplitPane } from '@/components/domain/SplitPane';
import {
  History,
  ShieldCheck,
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  Lock,
  Copy,
  ExternalLink,
  Calendar,
  User,
  Hash,
} from 'lucide-react';

export const AuditLog: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, auditEvents, verifyAuditChain } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAction, setSelectedAction] = useState('all');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    isValid: boolean;
    totalEvents: number;
    reason?: string;
  } | null>(null);

  const filteredEvents = useMemo(() => {
    return auditEvents.filter((ev) => {
      if (selectedAction !== 'all' && !ev.action.includes(selectedAction)) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      return (
        ev.action.toLowerCase().includes(q) ||
        ev.actor_name.toLowerCase().includes(q) ||
        ev.detail.toLowerCase().includes(q) ||
        (ev.subject_number || '').toLowerCase().includes(q) ||
        ev.hash.toLowerCase().includes(q)
      );
    });
  }, [auditEvents, selectedAction, searchQuery]);

  const selectedEvent = useMemo(() => {
    return auditEvents.find((e) => e.id === selectedEventId) || null;
  }, [auditEvents, selectedEventId]);

  const handleRunVerify = () => {
    setIsVerifying(true);
    setVerifyResult(null);
    setTimeout(() => {
      const result = verifyAuditChain();
      setVerifyResult(result);
      setIsVerifying(false);
    }, 700);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-surface-canvas">
      {/* Top Header */}
      <div className="h-12 border-b border-line-border px-4 flex items-center justify-between shrink-0 bg-surface-elevated">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-brand-teal" />
            <h1 className="text-sm font-bold text-ink-900">Audit Trail & Security Chain</h1>
            <span className="text-[11px] text-ink-muted">Cryptographic SHA-256 Forward-Chained Ledger Log</span>
          </div>

          <span className="text-line-border">|</span>

          {/* Action Filter */}
          <div className="flex items-center gap-1">
            {[
              { id: 'all', label: 'All Actions' },
              { id: 'journal', label: 'Journals' },
              { id: 'period', label: 'Periods' },
              { id: 'invoice', label: 'Invoices' },
              { id: 'bill', label: 'Bills' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedAction(tab.id)}
                className={`px-2.5 py-1 text-xs rounded-sm font-medium transition ${
                  selectedAction === tab.id
                    ? 'bg-surface-neutral text-ink-900 font-semibold'
                    : 'text-ink-muted hover:text-ink-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Verify button */}
          <button
            type="button"
            onClick={handleRunVerify}
            disabled={isVerifying}
            className="flex items-center gap-1.5 h-8 px-3 rounded-sm bg-brand-teal text-white text-xs font-semibold hover:bg-brand-teal-hover transition shadow-2xs"
          >
            <ShieldCheck className={`w-3.5 h-3.5 ${isVerifying ? 'animate-spin' : ''}`} />
            <span>{isVerifying ? 'Verifying Hashes...' : 'Verify Hash Chain'}</span>
          </button>

          {/* Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-ink-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search actors, events, hashes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-3 text-xs rounded-sm border border-line-border bg-surface-subtle focus:bg-surface-elevated focus:outline-none focus:border-brand-teal w-60"
            />
          </div>
        </div>
      </div>

      {/* Verification banner if verified */}
      {verifyResult && (
        <div
          className={`px-4 py-2 text-xs flex items-center justify-between border-b ${
            verifyResult.isValid
              ? 'bg-success/10 border-success/30 text-success'
              : 'bg-danger/10 border-danger/30 text-danger'
          }`}
        >
          <div className="flex items-center gap-2">
            {verifyResult.isValid ? (
              <CheckCircle2 className="w-4 h-4 shrink-0" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0" />
            )}
            <span className="font-semibold">
              {verifyResult.isValid
                ? `Cryptographic Chain Integrity Verified: All ${verifyResult.totalEvents} audit events form an unbroken SHA-256 Merkle link.`
                : `Tampering Detected: ${verifyResult.reason}`}
            </span>
          </div>

          <button
            type="button"
            onClick={() => setVerifyResult(null)}
            className="text-[11px] hover:underline font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* SplitPane view */}
      <SplitPane
        storageKey="ledgerly_audit_split_width"
        isOpen={Boolean(selectedEvent)}
        onClose={() => setSelectedEventId(null)}
        title={selectedEvent?.action}
        badge={
          selectedEvent && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-neutral font-semibold text-brand-teal">
              {selectedEvent.id}
            </span>
          )
        }
        detailContent={
          selectedEvent && (
            <div className="flex flex-col gap-4 text-xs">
              {/* Event metadata */}
              <div className="p-3 bg-surface-subtle border border-line-border rounded-sm flex flex-col gap-2">
                <span className="font-bold text-ink-900 text-[11px] uppercase tracking-wider">
                  Event Metadata
                </span>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-ink-muted block">Timestamp</span>
                    <span className="font-mono text-ink-900 font-medium">
                      {new Date(selectedEvent.occurred_at).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-ink-muted block">Signatory / Actor</span>
                    <span className="font-medium text-ink-900">{selectedEvent.actor_name}</span>
                  </div>
                  <div>
                    <span className="text-ink-muted block">Subject Type</span>
                    <span className="font-mono text-ink-900">{selectedEvent.subject_type}</span>
                  </div>
                  <div>
                    <span className="text-ink-muted block">Subject ID</span>
                    <span className="font-mono text-brand-teal font-medium">
                      {selectedEvent.subject_number || selectedEvent.subject_id}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Detail */}
              <div className="p-3 bg-surface-neutral border border-line-border rounded-sm flex flex-col gap-1">
                <span className="text-ink-muted uppercase font-bold text-[10px]">
                  Audit Consequence Description
                </span>
                <p className="text-ink-900 leading-relaxed font-medium">
                  {selectedEvent.detail}
                </p>
              </div>

              {/* Cryptographic Hashes */}
              <div className="p-3 bg-surface-subtle border border-line-border rounded-sm flex flex-col gap-2 font-mono text-[11px]">
                <span className="font-bold text-ink-900 font-sans uppercase text-[10px] flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5 text-brand-teal" />
                  SHA-256 Merkle Block Hash
                </span>

                <div>
                  <span className="text-ink-muted block text-[10px]">Current Event Hash</span>
                  <span className="break-all text-brand-teal font-semibold selection:bg-brand-teal/20">
                    {selectedEvent.hash}
                  </span>
                </div>

                <div className="pt-2 border-t border-line-border">
                  <span className="text-ink-muted block text-[10px]">Parent Event Hash (prev_hash)</span>
                  <span className="break-all text-ink-muted selection:bg-surface-neutral">
                    {selectedEvent.prev_hash}
                  </span>
                </div>
              </div>
            </div>
          )
        }
      >
        {/* Table Content */}
        <div className="p-4 flex flex-col gap-3">
          <div className="border border-line-border rounded-md overflow-hidden bg-surface-elevated shadow-2xs">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="h-9 bg-surface-neutral border-b border-line-border text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                  <th className="px-3">Timestamp (UTC)</th>
                  <th className="px-3">Signatory</th>
                  <th className="px-3">Action Type</th>
                  <th className="px-3">Subject</th>
                  <th className="px-3">Details</th>
                  <th className="px-3">SHA-256 Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-border">
                {filteredEvents.map((ev) => {
                  const isSelected = selectedEventId === ev.id;
                  return (
                    <tr
                      key={ev.id}
                      onClick={() => setSelectedEventId(ev.id)}
                      className={`h-9 cursor-pointer transition select-none ${
                        isSelected ? 'bg-brand-teal/10 font-medium' : 'hover:bg-surface-neutral'
                      }`}
                    >
                      <td className="px-3 font-mono text-[11px] text-ink-muted whitespace-nowrap">
                        {new Date(ev.occurred_at).toLocaleDateString()} {new Date(ev.occurred_at).toLocaleTimeString()}
                      </td>
                      <td className="px-3 font-medium text-ink-900 whitespace-nowrap">
                        {ev.actor_name}
                      </td>
                      <td className="px-3 font-mono text-[11px] text-brand-teal">
                        {ev.action}
                      </td>
                      <td className="px-3 font-mono font-medium text-ink-900">
                        {ev.subject_number || ev.subject_id}
                      </td>
                      <td className="px-3 text-ink-muted truncate max-w-xs">
                        {ev.detail}
                      </td>
                      <td className="px-3 font-mono text-[10px] text-ink-muted truncate max-w-[120px]">
                        {ev.hash.slice(0, 16)}...
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-[11px] text-ink-muted px-1">
            <span>Showing {filteredEvents.length} audit trail records</span>
            <span>Tamper-evident append-only ledger security</span>
          </div>
        </div>
      </SplitPane>
    </div>
  );
};
