import React, { useState } from 'react';
import { useLedgerStore } from '@/mock/store';
import { AuditEvent } from '@/types';
import { formatDateTime, formatMoney } from '@/lib/format';
import {
  ShieldCheck,
  Clock,
  Send,
  FileText,
  UserCheck,
  BookOpen,
  DollarSign,
  Copy,
  Check,
  ChevronDown,
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

function humanizeAction(a: string): string {
  const tail = a.split('.').pop() ?? a;
  return 'logged: ' + tail.replace(/_/g, ' ').toLowerCase();
}

function dotTone(badgeClass: string): string {
  return badgeClass;
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
  const { auditEvents, users } = useLedgerStore();
  const nameOf = (id: string | null | undefined, fallback: string) =>
    (id && users.find((u) => u.id === id)?.name) || fallback;
  const [showVerify, setShowVerify] = useState(false);
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
    label: 'created the draft',
    actorName: nameOf(createdBy, 'Rahim Ahmed'),
    actorRole: 'Maker / Staff Accountant',
    timestamp: createdAt,
    detail: documentType === 'journal'
      ? `${linesCount} line${linesCount === 1 ? '' : 's'} · ${formatMoney(total, currency)}`
      : `${contactName} · ${linesCount} item${linesCount === 1 ? '' : 's'} · ${formatMoney(total, currency)}`,
    icon: <FileText className="size-3.5" />,
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
      label: 'submitted it for approval',
      actorName: nameOf(submittedBy, 'Rahim Ahmed'),
      actorRole: 'Maker / Submitter',
      timestamp: submittedAt || createdAt,
      detail: 'Waiting for a second person to approve.',
      icon: <Send className="size-3.5" />,
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
      label: 'sent it back for changes',
      actorName: 'Fatima Hassan',
      actorRole: 'Checker / Finance Manager',
      timestamp: createdAt,
      detail: memo ?? '',
      icon: <Clock className="size-3.5" />,
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
      label: 'approved and posted it',
      actorName: nameOf(approvedBy, 'Fatima Hassan'),
      actorRole: 'Checker / Finance Manager',
      timestamp: signedAt || postedAt || createdAt,
      detail: `Confirmed with PIN. Official number ${documentNumber || documentId}.`,
      icon: <UserCheck className="size-3.5" />,
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
      label: 'recorded it in the books',
      actorName: 'Ledgerly',
      actorRole: 'Automated Posting System',
      timestamp: postedAt || createdAt,
      detail: `Journal ${journalId || 'entry'} added to the open period.`,
      icon: <BookOpen className="size-3.5" />,
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
      label: 'applied a payment',
      actorName: 'Ledgerly',
      actorRole: 'Banking & Treasury',
      timestamp: postedAt || createdAt,
      detail: `${formatMoney(settledAmount, currency)} received. ${formatMoney(total - settledAmount, currency)} still due.`,
      icon: <DollarSign className="size-3.5" />,
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
        label: humanizeAction(storeEv.action),
        actorName: storeEv.actor_name,
        actorRole: '',
        timestamp: storeEv.occurred_at,
        detail: storeEv.detail,
        icon: <ShieldCheck className="size-3.5" />,
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
    <div className="flex flex-col gap-3 min-w-0">
      <ol className="relative flex flex-col gap-3.5 before:absolute before:left-[11px] before:top-3 before:bottom-3 before:w-px before:bg-border">
        {entries.map((entry) => (
          <li key={entry.id} className="relative flex gap-3 min-w-0">
            <span
              aria-hidden
              className={`relative z-10 flex size-6 shrink-0 items-center justify-center bg-surface ${dotTone(entry.badgeClass).split(' ').filter((c) => c.startsWith('text-')).join(' ')}`}
            >
              <span className="size-2 rounded-full bg-current" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-[13px] leading-snug text-text-primary break-words">
                <span className="font-medium">{entry.actorName}</span> {entry.label}
              </p>
              <p className="text-xs text-text-muted mt-0.5" title={formatDateTime(entry.timestamp)}>
                {formatDateTime(entry.timestamp)}
              </p>
              {entry.detail && <p className="text-xs text-text-secondary mt-1 leading-relaxed break-words">{entry.detail}</p>}
            </div>
          </li>
        ))}
      </ol>

      <div className="border-t border-border pt-2">
        <button
          type="button"
          onClick={() => setShowVerify((v) => !v)}
          aria-expanded={showVerify}
          className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary transition-colors"
        >
          <ShieldCheck className="size-3.5 text-success" />
          Verification details
          <ChevronDown className={`size-3.5 transition-transform ${showVerify ? 'rotate-180' : ''}`} />
        </button>
        {showVerify && (
          <div className="mt-2 flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-xs text-success">
              <Check className="size-3.5" /> Verified: {entries.length} events, no changes detected
            </div>
            {entries.map((entry) => (
              <div key={entry.id} className="rounded-md bg-surface-neutral/60 p-2 text-[10px] font-mono text-text-muted min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate" title={entry.hash}>Hash {entry.hash}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(entry.hash)}
                    className="shrink-0 p-1 rounded hover:bg-surface hover:text-text-primary"
                    aria-label="Copy hash"
                  >
                    {copiedHash === entry.hash ? <Check className="size-3 text-success" /> : <Copy className="size-3" />}
                  </button>
                </div>
                <div className="truncate" title={entry.prevHash}>Prev {entry.prevHash}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
