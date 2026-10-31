import React, { useState, useMemo } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { useLedgerStore } from '@/mock/store';
import { AuditEvent } from '@/types';
import { DataTable } from '@/components/domain/DataTable';
import { SplitPane } from '@/components/domain/SplitPane';
import { formatDateTime } from '@/lib/format';
import { PageHeader } from '@/components/domain/PageHeader';
import { Kbd } from '@/components/ui/kbd';
import { Avatar } from '@/components/ui/avatar';
import { toast } from 'sonner';
import { Copy, Eye } from 'lucide-react';
import {
  History,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Lock,
  ExternalLink,
  Code2,
} from 'lucide-react';

const humanize = (action: string) => {
  const t = action.replace(/[._]/g, ' ').trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const AuditLog: React.FC = () => {
  const { currentCompany, auditEvents, verifyAuditChain, uiDensity } = useLedgerStore();
  const [selectedAction, setSelectedAction] = useState('all');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{
    isValid: boolean;
    totalEvents: number;
    reason?: string;
  } | null>(null);

  const filterTabs = [
    { label: 'Everything', value: 'all', count: auditEvents.length },
    { label: 'Journals', value: 'journal', count: auditEvents.filter((e) => e.action.includes('journal')).length },
    { label: 'Periods', value: 'period', count: auditEvents.filter((e) => e.action.includes('period')).length },
    { label: 'Invoices', value: 'invoice', count: auditEvents.filter((e) => e.action.includes('invoice')).length },
    { label: 'Bills', value: 'bill', count: auditEvents.filter((e) => e.action.includes('bill')).length },
  ];

  const filteredEvents = useMemo(() => {
    return auditEvents.filter((ev) => {
      if (selectedAction === 'all') return true;
      return ev.action.includes(selectedAction);
    });
  }, [auditEvents, selectedAction]);

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
    }, 400);
  };

  const rowActions = (ev: AuditEvent) => [
    { label: 'View details', icon: Eye, shortcut: 'Enter', onClick: () => setSelectedEventId(ev.id) },
    {
      label: 'Copy reference',
      icon: Copy,
      onClick: () => {
        navigator.clipboard?.writeText(ev.subject_number || ev.subject_id).catch(() => undefined);
        toast.success('Reference copied');
      },
    },
  ];

  const columns: ColumnDef<AuditEvent>[] = [
    {
      accessorKey: 'occurred_at',
      header: 'When',
      cell: ({ row }) => (
        <span className="whitespace-nowrap text-xs text-text-muted">{formatDateTime(row.original.occurred_at)}</span>
      ),
    },
    {
      accessorKey: 'actor_name',
      header: 'Who',
      cell: ({ row }) => (
        <span className="flex items-center gap-2 whitespace-nowrap font-medium text-text-primary">
          <Avatar name={row.original.actor_name} size="sm" /> {row.original.actor_name}
        </span>
      ),
    },
    {
      accessorKey: 'action',
      header: 'What happened',
      cell: ({ row }) => <span className="font-medium text-text-primary">{humanize(row.original.action)}</span>,
    },
    {
      accessorKey: 'subject_number',
      header: 'On',
      cell: ({ row }) => <span className="text-text-secondary">{row.original.subject_number || row.original.subject_id}</span>,
    },
    {
      accessorKey: 'detail',
      header: 'Details',
      cell: ({ row }) => <span className="block max-w-sm truncate text-text-muted">{row.original.detail}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Activity log"
        subtitle="A permanent record of who did what. Each entry is linked to the one before it, so nothing can be changed quietly."
        actions={
          <button
            type="button"
            onClick={handleRunVerify}
            disabled={isVerifying}
            className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:opacity-70"
          >
            {isVerifying ? 'Checking' : 'Verify chain'}
            <Kbd className="ml-1 border-white/30 bg-white/20 text-white">V</Kbd>
          </button>
        }
      />

      {verifyResult && (
        <div
          role="status"
          className={`flex items-center justify-between gap-3 rounded-lg border px-4 py-3 text-[13px] ${
            verifyResult.isValid ? 'border-success/30 bg-success-soft text-success' : 'border-danger/30 bg-danger-soft text-danger'
          }`}
        >
          <div className="flex items-center gap-3">
                        <div>
              <div className="font-semibold">{verifyResult.isValid ? 'Chain verified. Nothing has been changed.' : 'Chain check failed'}</div>
              <p className="mt-0.5 text-xs opacity-90">
                {verifyResult.isValid
                  ? `All ${verifyResult.totalEvents} log entries link correctly to the one before them.`
                  : verifyResult.reason}
              </p>
            </div>
          </div>
          <button type="button" onClick={() => setVerifyResult(null)} className="text-xs font-medium hover:underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Main SplitPane Layout */}
      <SplitPane
        storageKey="ledgerly_audit_split_width"
        isOpen={Boolean(selectedEvent)}
        onClose={() => setSelectedEventId(null)}
        title={selectedEvent ? `${humanize(selectedEvent.action)}` : 'Details'}
        subtitle={
          selectedEvent
            ? `By ${selectedEvent.actor_name}`
            : undefined
        }
        icon={<ShieldCheck className="w-4 h-4" />}
        badge={
          selectedEvent ? (
            <span className="text-[11px] bg-surface-neutral text-text-secondary px-1.5 py-px rounded-[3px] font-medium">
              {selectedEvent.action}
            </span>
          ) : undefined
        }
        detailContent={
          selectedEvent && (
            <div className="flex flex-col gap-4 text-xs">
              {/* Event metadata */}
              <div className="p-3 bg-surface-neutral/60 border border-border rounded-lg flex flex-col gap-2">
                <span className="font-semibold text-text-primary text-xs">
                  About this entry
                </span>
                <div className="grid grid-cols-2 gap-2 text-[11px]">
                  <div>
                    <span className="text-text-muted block">When</span>
                    <span className="font-mono text-text-primary font-medium">
                      {new Date(selectedEvent.occurred_at).toLocaleString()}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-muted block">Who</span>
                    <span className="font-medium text-text-primary">{selectedEvent.actor_name}</span>
                  </div>
                  <div>
                    <span className="text-text-muted block">Type</span>
                    <span className="font-mono text-text-primary">{selectedEvent.subject_type}</span>
                  </div>
                  <div>
                    <span className="text-text-muted block">Document</span>
                    <span className="font-mono text-accent font-medium">
                      {selectedEvent.subject_number || selectedEvent.subject_id}
                    </span>
                  </div>
                </div>
              </div>

              {/* Action Detail */}
              <div className="p-3 bg-surface border border-border rounded-lg flex flex-col gap-1">
                <span className="text-text-muted uppercase font-semibold text-[10px]">
                  What it means
                </span>
                <p className="text-text-primary leading-relaxed font-medium">
                  {selectedEvent.detail}
                </p>
              </div>

              {/* Before / After Diff */}
              <div className="p-3 bg-surface-neutral/40 border border-border rounded-lg flex flex-col gap-2 font-mono text-[11px]">
                <span className="font-semibold text-text-primary font-sans uppercase text-[10px] flex items-center gap-1">
                  <Code2 className="w-3.5 h-3.5 text-accent" />
                  What changed
                </span>
                <div className="grid grid-cols-2 gap-2 p-2 bg-surface rounded border border-border text-[10px]">
                  <div>
                    <span className="text-danger font-semibold block mb-1">Before</span>
                    <pre className="text-text-muted font-mono whitespace-pre-wrap">
                      {JSON.stringify(
                        {
                          status: selectedEvent.action.includes('posted')
                            ? 'draft'
                            : selectedEvent.action.includes('reopened')
                            ? 'closed'
                            : 'previous',
                          version: 1,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                  <div className="border-l border-border pl-2">
                    <span className="text-success font-semibold block mb-1">After</span>
                    <pre className="text-text-primary font-mono whitespace-pre-wrap">
                      {JSON.stringify(
                        {
                          status: selectedEvent.action.includes('posted')
                            ? 'posted'
                            : selectedEvent.action.includes('reopened')
                            ? 'open'
                            : 'updated',
                          version: 2,
                          signatory: selectedEvent.actor_name,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>
                </div>
              </div>

              {/* Cryptographic Hashes */}
              <div className="p-3 bg-surface-neutral/60 border border-border rounded-lg flex flex-col gap-2 font-mono text-[11px]">
                <span className="font-semibold text-text-primary font-sans uppercase text-[10px] flex items-center gap-1">
                  <Lock className="w-3.5 h-3.5 text-accent" />
                  Tamper-proof seal
                </span>

                <div>
                  <span className="text-text-muted block text-[10px]">This entry's seal</span>
                  <span className="break-all text-accent font-semibold selection:bg-accent/20">
                    {selectedEvent.hash}
                  </span>
                </div>

                <div className="pt-2 border-t border-border">
                  <span className="text-text-muted block text-[10px]">Previous entry's seal</span>
                  <span className="break-all text-text-muted">
                    {selectedEvent.prev_hash}
                  </span>
                </div>
              </div>
            </div>
          )
        }
      >
        <DataTable
          columns={columns}
          data={filteredEvents}
          activeRowId={selectedEventId}
          filterTabs={filterTabs}
          activeTab={selectedAction}
          onTabChange={setSelectedAction}
          searchPlaceholder="Search by person, action or document"
          rowDensity={uiDensity}
          rowActions={rowActions}
          contextMenuTitle={(r) => humanize(r.action)}
          onRowClick={(row) => setSelectedEventId(row.id)}
        />
      </SplitPane>
    </div>
  );
};
