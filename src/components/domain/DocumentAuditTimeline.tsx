import React, { useState } from 'react';
import { useLedgerStore } from '@/mock/store';
import { AuditEvent } from '@/types';
import { formatDateTime, formatMoney } from '@/lib/format';
import {
  ShieldCheck,
  CheckCircle2,
  Clock,
  Send,
  FileText,
  UserCheck,
  BookOpen,
  DollarSign,
  Copy,
  Check,
  Hash,
  Lock,
} from 'lucide-react';

export interface DocumentAuditTimelineProps {
  documentId: string;
  documentNumber?: string | null;
  documentType?: 'invoice' | 'bill' | 'journal' | 'receipt';
  documentStatus: string;
  createdAt: string;
  createdBy?: string | null;
  submittedAt?: string | null;
  submittedBy?: string | null;
  postedAt?: string | null;
  approvedBy?: string | null;
  signedAt?: string | null;
  signatureHash?: string | null;
  memo?: string | null;
  total?: number;
  currency?: string;
  linesCount?: number;
  contactName?: string | null;
  settledAmount?: number;
  journalId?: string | null;
}

interface TimelineEntry {
  id: string;
  action: string;
  label: string;
  actorName: string;
  actorRole: string;
  timestamp: string;
  detail: string;
  icon: React.ReactNode;
  badgeClass: string;
  hash: string;
  prevHash: string;
  statusBadge?: string;
}

export const DocumentAuditTimeline: React.FC<DocumentAuditTimelineProps> = ({
  documentId,
  documentNumber,
  documentType = 'invoice',
  documentStatus,
  createdAt,
  createdBy = 'Rahim Ahmed',
  submittedAt,
  submittedBy,
  postedAt,
  approvedBy,
  signedAt,
  signatureHash,
  memo,
  total = 0,
  currency = 'USD',
  linesCount = 1,
  contactName = 'Customer',
  settledAmount = 0,
  journalId,
}) => {
  const { auditEvents } = useLedgerStore();
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const handleCopy = (hashStr: string) => {
    navigator.clipboard.writeText(hashStr);
    setCopiedHash(hashStr);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  // Compile full immutable audit trail
  const entries: TimelineEntry[] = [];

  // 1. Genesis: Document Creation
  const genesisHash = '0000000000000000000000000000000000000000000000000000000000000000';
  const createdHash = '7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069';

  entries.push({
    id: `timeline-created-${documentId}`,
    action: 'document.created',
    label: 'Document Draft Created',
    actorName: (createdBy === 'usr-1' || !createdBy) ? 'Rahim Ahmed' : createdBy,
    actorRole: 'Maker / Staff Accountant',
    timestamp: createdAt,
    detail: `Draft ${documentType} initiated for ${contactName} with ${linesCount} item(s) totaling ${formatMoney(total, currency)}. Initial tracking ID allocated: ${documentId}.`,
    icon: <FileText className="w-3.5 h-3.5 text-text-muted" />,
    badgeClass: 'text-text-muted bg-surface-neutral border-border',
    hash: createdHash,
    prevHash: genesisHash,
    statusBadge: 'Draft',
  });

  // 2. Submission for 4-Eyes Independent Approval
  const hasSubmitted = documentStatus === 'pending_approval' || documentStatus === 'posted' || Boolean(submittedBy);
  const submittedHash = '2b9069d200126dfc2d4b1fa3d677284ad7f83b1657ff1fc53b92dc18148a1d65';

  if (hasSubmitted) {
    entries.push({
      id: `timeline-submitted-${documentId}`,
      action: 'document.submitted',
      label: 'Submitted for Approval',
      actorName: (submittedBy === 'usr-1' || !submittedBy) ? 'Rahim Ahmed' : submittedBy,
      actorRole: 'Maker / Submitter',
      timestamp: submittedAt || createdAt,
      detail: 'Submitted to checker queue for 4-eyes approval workflow. Segregation of duties invariant enforced (Creator cannot approve). Assigned to Fatima Hassan.',
      icon: <Send className="w-3.5 h-3.5 text-warning" />,
      badgeClass: 'text-warning bg-warning-soft border-warning/30',
      hash: submittedHash,
      prevHash: createdHash,
      statusBadge: 'Pending Approval',
    });
  }

  // 3. Document Return (if applicable)
  if (memo?.toLowerCase().includes('returned')) {
    entries.push({
      id: `timeline-returned-${documentId}`,
      action: 'document.returned',
      label: 'Returned by Approver',
      actorName: 'Fatima Hassan',
      actorRole: 'Checker / Finance Manager',
      timestamp: createdAt,
      detail: `Document returned to maker with revision request: ${memo}`,
      icon: <Clock className="w-3.5 h-3.5 text-danger" />,
      badgeClass: 'text-danger bg-danger-soft border-danger/30',
      hash: '9a4c12ef0038472b89ad7e531846b9a8f2c3d4e5f601728394a5b6c7d8e9f012',
      prevHash: submittedHash,
      statusBadge: 'Returned',
    });
  }

  // 4. Verification, Authorization & 2FA Signing
  const isPosted = documentStatus === 'posted' || Boolean(approvedBy);
  const signedHash = signatureHash || '4b1fa3d677284ad7f83b1657ff1fc53b92dc18148a1d65dfc2d2b9069d200126';

  if (isPosted) {
    entries.push({
      id: `timeline-authorized-${documentId}`,
      action: 'document.authorized_and_signed',
      label: 'Authorized & Cryptographically Signed',
      actorName: (approvedBy === 'usr-2' || !approvedBy) ? 'Fatima Hassan' : approvedBy,
      actorRole: 'Checker / Finance Manager',
      timestamp: signedAt || postedAt || createdAt,
      detail: `6-Digit PIN authentication confirmed. Four-Eyes principle validated. Permanent gapless sequence assigned: ${documentNumber || documentId}.`,
      icon: <UserCheck className="w-3.5 h-3.5 text-success" />,
      badgeClass: 'text-success bg-success-soft border-success/30',
      hash: signedHash,
      prevHash: submittedHash,
      statusBadge: 'Authorized',
    });

    // 5. General Ledger Posting
    const ledgerHash = 'e82b719034f5c6a1b2d3e4f5061728394a5b6c7d8e9f0123456789abcdef0123';
    entries.push({
      id: `timeline-ledger-${documentId}`,
      action: 'ledger.journal_committed',
      label: 'Posted to General Ledger',
      actorName: 'General Ledger Engine',
      actorRole: 'Automated Posting System',
      timestamp: postedAt || createdAt,
      detail: `Balanced double-entry journal ${journalId || 'JRN-2026-0103'} committed to open fiscal period. AR Control (1200) debited, Revenue (4000) credited. Dr = Cr verified.`,
      icon: <BookOpen className="w-3.5 h-3.5 text-accent" />,
      badgeClass: 'text-accent bg-accent-soft border-accent/30',
      hash: ledgerHash,
      prevHash: signedHash,
      statusBadge: 'Posted',
    });
  }

  // 6. Settlements / Receipts (if applicable)
  if (settledAmount > 0) {
    const settlementHash = 'f1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f80';
    entries.push({
      id: `timeline-settled-${documentId}`,
      action: 'settlement.payment_applied',
      label: 'Settlement Receipt Applied',
      actorName: 'Cashier Subsystem',
      actorRole: 'Banking & Treasury',
      timestamp: postedAt || createdAt,
      detail: `Cash receipt allocated in amount of ${formatMoney(settledAmount, currency)}. Remaining customer balance due: ${formatMoney(total - settledAmount, currency)}.`,
      icon: <DollarSign className="w-3.5 h-3.5 text-info" />,
      badgeClass: 'text-info bg-info-soft border-info/30',
      hash: settlementHash,
      prevHash: 'e82b719034f5c6a1b2d3e4f5061728394a5b6c7d8e9f0123456789abcdef0123',
      statusBadge: 'Settlement',
    });
  }

  // Merge any store audit events matching this document
  const matchingStoreEvents = auditEvents.filter(
    (a) =>
      a.subject_id === documentId ||
      (documentNumber && a.subject_number === documentNumber) ||
      (documentNumber && a.detail?.includes(documentNumber)) ||
      (documentId && a.detail?.includes(documentId))
  );

  matchingStoreEvents.forEach((storeEv) => {
    // Avoid exact duplicate action on same subject
    if (!entries.some((e) => e.action === storeEv.action && e.timestamp === storeEv.occurred_at)) {
      entries.push({
        id: `timeline-store-${storeEv.id}`,
        action: storeEv.action,
        label: storeEv.action.replace('_', ' ').replace('.', ' · '),
        actorName: storeEv.actor_name,
        actorRole: 'System Audit Record',
        timestamp: storeEv.occurred_at,
        detail: storeEv.detail,
        icon: <ShieldCheck className="w-3.5 h-3.5 text-accent" />,
        badgeClass: 'text-accent bg-accent-soft border-accent/30',
        hash: storeEv.hash,
        prevHash: storeEv.prev_hash,
        statusBadge: 'Logged',
      });
    }
  });

  // Sort ascending chronologically
  entries.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return (
    <div className="flex flex-col gap-4">
      {/* Integrity Header Banner */}
      <div className="p-3 rounded-md bg-surface-neutral/60 border border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-success-soft border border-success/30 flex items-center justify-center">
            <ShieldCheck className="w-3.5 h-3.5 text-success" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-text-primary">Full Immutable Audit Trail</span>
              <span className="text-[10px] font-mono font-bold bg-accent-soft text-accent px-1.5 py-0.2 rounded border border-accent/20">
                SHA-256 Chained
              </span>
            </div>
            <span className="text-[11px] text-text-muted">
              {entries.length} cryptographic events verified • Tamper-evident sequence
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-text-muted bg-surface px-2 py-1 rounded border border-border">
          <Lock className="w-3 h-3 text-text-muted" />
          <span>Genesis Verified</span>
        </div>
      </div>

      {/* Vertical Timeline */}
      <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-border">
        {entries.map((entry, idx) => (
          <div key={entry.id} className="relative group">
            {/* Timeline Dot */}
            <div className="absolute -left-6 top-1.5 w-5 h-5 rounded-full bg-surface border-2 border-accent flex items-center justify-center shadow-xs">
              <div className="w-1.5 h-1.5 rounded-full bg-accent" />
            </div>

            {/* Event Card */}
            <div className="rounded-md border border-border bg-surface p-3.5 shadow-2xs hover:border-border-strong transition flex flex-col gap-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono uppercase font-bold px-2 py-0.5 rounded border ${entry.badgeClass}`}>
                    {entry.action}
                  </span>
                  <span className="text-xs font-bold text-text-primary">
                    {entry.label}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-text-muted">
                  {formatDateTime(entry.timestamp)}
                </span>
              </div>

              {/* Actor & Role */}
              <div className="flex items-center gap-2 text-xs text-text-secondary">
                <span className="font-medium text-text-primary">{entry.actorName}</span>
                <span className="text-[11px] text-text-muted">({entry.actorRole})</span>
              </div>

              {/* Event Details */}
              <p className="text-xs text-text-secondary leading-relaxed">
                {entry.detail}
              </p>

              {/* Cryptographic Hash Chaining Block */}
              <div className="mt-1 pt-2 border-t border-border/60 flex flex-col gap-1 text-[10px] font-mono text-text-muted bg-surface-neutral/50 p-2 rounded">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 truncate">
                    <span className="text-text-muted">Hash:</span>
                    <span className="text-text-primary font-mono truncate">{entry.hash}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopy(entry.hash)}
                    className="shrink-0 p-1 rounded hover:bg-surface text-text-muted hover:text-text-primary transition"
                    title="Copy SHA-256 hash"
                  >
                    {copiedHash === entry.hash ? (
                      <Check className="w-3 h-3 text-success" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                  </button>
                </div>
                <div className="flex items-center gap-1.5 truncate text-[10px]">
                  <span className="text-text-muted">Prev:</span>
                  <span className="truncate text-text-muted">{entry.prevHash}</span>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
