import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/mock/api';
import type { BulkApprovalTarget } from '@/types';
import { useLedgerStore } from '@/mock/store';
import { formatMoney, formatDateTime } from '@/lib/format';
import { SignDialog } from '@/components/domain/SignDialog';
import {
  CheckSquare,
  Clock,
  CheckCircle,
  CheckCircle2,
  RotateCcw,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  BookMarked,
  XCircle,
  Lock,
} from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Kbd } from '@/components/ui/kbd';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { PageHeader } from '@/components/domain/PageHeader';
import { Avatar } from '@/components/ui/avatar';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

export const ApprovalsInbox: React.FC = () => {
  const navigate = useNavigate();
  const {
    currentCompany, currentUser, companySettings, invoices, bills, journals, contacts,
    bulkApprove, returnInvoice, returnBill, returnJournal,
  } = useLedgerStore();
  const [activeTab, setActiveTab] = useState<'waiting' | 'submitted' | 'all'>('waiting');

  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [modalType, setModalType] = useState<'return' | null>(null);
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [returnComment, setReturnComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const coSlug = currentCompany.slug;

  // Bulk selection (E5)
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkSignOpen, setBulkSignOpen] = useState(false);
  const [bulkReturnOpen, setBulkReturnOpen] = useState(false);
  const [bulkReason, setBulkReason] = useState('');
  const [results, setResults] = useState<
    { kind: 'approve' | 'return'; rows: { id: string; title: string; number: string; ok: boolean; newNumber?: string | null; reason?: string }[] } | null
  >(null);

  // Derive all pending approval items dynamically from invoices, bills, journals
  const pendingItems = [
    ...invoices
      .filter((i) => i.status === 'pending_approval')
      .map((i) => ({
        id: `appr-inv-${i.id}`,
        document_type: 'sales_invoice' as const,
        document_id: i.id,
        document_number: i.number || 'DRAFT',
        title: `Sales Invoice: ${contacts.find((c) => c.id === i.contact_id)?.name || 'Customer'}`,
        contact_name: contacts.find((c) => c.id === i.contact_id)?.name || 'Customer',
        amount: i.total,
        currency: i.currency,
        maker_id: i.created_by,
        maker_name: i.created_by === 'usr-1' ? 'Rahim Ahmed' : 'User',
        submitted_at: i.created_at,
        period_name: 'Oct 2026',
      })),
    ...bills
      .filter((b) => b.status === 'pending_approval')
      .map((b) => ({
        id: `appr-bill-${b.id}`,
        document_type: 'purchase_bill' as const,
        document_id: b.id,
        document_number: b.number || 'DRAFT-BILL',
        title: `Purchase Bill: ${contacts.find((c) => c.id === b.contact_id)?.name || 'Supplier'}`,
        contact_name: contacts.find((c) => c.id === b.contact_id)?.name || 'Supplier',
        amount: b.total,
        currency: b.currency,
        maker_id: b.created_by,
        maker_name: b.created_by === 'usr-1' ? 'Rahim Ahmed' : 'User',
        submitted_at: b.created_at,
        period_name: 'Oct 2026',
      })),
    ...journals
      .filter((j) => j.status === 'pending_approval')
      .map((j) => ({
        id: `appr-jrn-${j.id}`,
        document_type: 'manual_journal' as const,
        document_id: j.id,
        document_number: j.number || 'DRAFT-JRN',
        title: `Manual Journal: ${j.memo}`,
        contact_name: 'General Ledger',
        amount: j.total_debit,
        currency: 'USD',
        maker_id: j.created_by,
        maker_name: j.created_by === 'usr-1' ? 'Rahim Ahmed' : 'User',
        submitted_at: j.created_at,
        period_name: 'Oct 2026',
      })),
  ];

  const waitingForMe = pendingItems.filter((a) => a.maker_id !== currentUser.id);
  const submittedByMe = pendingItems.filter((a) => a.maker_id === currentUser.id);

  const displayList =
    activeTab === 'waiting'
      ? waitingForMe
      : activeTab === 'submitted'
      ? submittedByMe
      : pendingItems;

  const selectableIds = displayList.filter((a) => a.maker_id !== currentUser.id).map((a) => a.id);
  const selectedItems = pendingItems.filter((a) => selected.has(a.id) && a.maker_id !== currentUser.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(selectableIds));

  const targetOf = (item: (typeof pendingItems)[number]): BulkApprovalTarget => ({
    type: item.document_type === 'sales_invoice' ? 'invoice' : item.document_type === 'purchase_bill' ? 'bill' : 'journal',
    id: item.document_id,
  });

  const handleBulkApprove = (pin: string) => {
    const snapshot = selectedItems;
    try {
      const res = bulkApprove(snapshot.map(targetOf), currentUser, pin, companySettings);
      setResults({
        kind: 'approve',
        rows: res.map((r, i) => ({
          id: snapshot[i].id,
          title: snapshot[i].title,
          number: snapshot[i].document_number,
          ok: r.ok,
          newNumber: r.number,
          reason: r.reason,
        })),
      });
      setSelected(new Set());
      const okCount = res.filter((r) => r.ok).length;
      toast.success(`${okCount} of ${res.length} approved`);
    } catch (err: any) {
      toast.error(
        err?.code === 'PIN_LOCKED'
          ? 'Signing is paused after too many wrong PINs. Wait a moment and try again.'
          : err?.message || 'Approval failed'
      );
    }
  };

  const handleBulkReturn = () => {
    const reason = bulkReason.trim();
    if (!reason) return;
    const rows = selectedItems.map((item) => {
      try {
        if (item.document_type === 'sales_invoice') returnInvoice(item.document_id, reason, currentUser);
        else if (item.document_type === 'purchase_bill') returnBill(item.document_id, reason, currentUser);
        else returnJournal(item.document_id, reason, currentUser);
        return { id: item.id, title: item.title, number: item.document_number, ok: true };
      } catch (err: any) {
        return { id: item.id, title: item.title, number: item.document_number, ok: false, reason: err?.message || 'Could not send back' };
      }
    });
    setResults({ kind: 'return', rows });
    setSelected(new Set());
    setBulkReturnOpen(false);
    setBulkReason('');
  };

  useEffect(() => {
    if (selected.size === 0 || bulkSignOpen || bulkReturnOpen || results) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !(document.activeElement instanceof HTMLTextAreaElement)) setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected.size, bulkSignOpen, bulkReturnOpen, results]);

  const handleOpenDoc = (item: any) => {
    if (item.document_type === 'sales_invoice') {
      navigate(`/${coSlug}/invoices/${item.document_id}`);
    } else if (item.document_type === 'purchase_bill') {
      navigate(`/${coSlug}/bills/${item.document_id}`);
    } else {
      navigate(`/${coSlug}/journals/${item.document_id}`);
    }
  };

  const handleStartApprove = (item: any) => {
    if (item.maker_id === currentUser.id) {
      toast.error('You created this document, so someone else has to approve it. Switch to the approver account to continue.');
      return;
    }
    setSelectedItem(item);
    setSignDialogOpen(true);
  };

  const handleConfirmApproveWithPin = async (pin: string) => {
    if (!selectedItem) return;
    try {
      setLoading(true);
      setErrorMsg('');
      if (selectedItem.document_type === 'sales_invoice') {
        await api.approveInvoice(selectedItem.document_id, pin);
      } else if (selectedItem.document_type === 'purchase_bill') {
        await api.approveBill(selectedItem.document_id, pin);
      }
      setSignDialogOpen(false);
      setSelectedItem(null);
    } catch (err: any) {
      toast.error(err.message || 'Approval failed');
    } finally {
      setLoading(false);
    }
  };

  const handleConfirmReturn = async () => {
    if (!selectedItem || !returnComment.trim()) return;
    try {
      setLoading(true);
      setErrorMsg('');
      if (selectedItem.document_type === 'sales_invoice') {
        await api.returnInvoice(selectedItem.document_id, returnComment);
      } else if (selectedItem.document_type === 'purchase_bill') {
        await api.returnBill(selectedItem.document_id, returnComment);
      }
      setModalType(null);
      setSelectedItem(null);
      setReturnComment('');
    } catch (err: any) {
      setErrorMsg(err.message || 'Return failed');
    } finally {
      setLoading(false);
    }
  };

  const GROUPS = [
    { type: 'sales_invoice', label: 'Sales invoices', icon: FileSpreadsheet },
    { type: 'purchase_bill', label: 'Supplier bills', icon: FileText },
    { type: 'manual_journal', label: 'Manual journals', icon: BookMarked },
  ] as const;

  const ageLabel = (iso: string) => {
    const days = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
    return days === 0 ? 'waiting since today' : days === 1 ? 'waiting 1 day' : `waiting ${days} days`;
  };

  const tabs = [
    { key: 'waiting', label: 'Waiting for me', count: waitingForMe.length },
    { key: 'submitted', label: 'Sent by me', count: submittedByMe.length },
    { key: 'all', label: 'Everything pending', count: pendingItems.length },
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<CheckSquare />}
        title="Approvals"
        subtitle="Documents are posted only after a second person approves them."
        meta={
          <span className="rounded-full border border-border bg-surface-neutral px-2.5 py-0.5 text-xs text-text-secondary">
            Signed in as <span className="font-medium text-text-primary">{currentUser.name}</span>
          </span>
        }
      />

      <div className="flex items-center gap-1 border-b border-border" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={activeTab === t.key}
            onClick={() => setActiveTab(t.key)}
            className={cn(
              'flex items-center gap-2 border-b-2 px-4 py-2.5 text-[13px] font-medium transition-colors -mb-px',
              activeTab === t.key ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary'
            )}
          >
            {t.label}
            <span
              className={cn(
                'rounded-full px-1.5 text-[11px] font-semibold tabular-nums',
                t.key === 'waiting' && t.count > 0 ? 'bg-warning-soft text-warning' : 'bg-surface-neutral text-text-secondary'
              )}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {selectableIds.length > 0 && (
        <div className="-mb-2 flex items-center gap-2.5 text-[13px] text-text-secondary">
          <Checkbox
            checked={allSelected}
            onCheckedChange={toggleAll}
            aria-label="Select all documents I can approve"
          />
          <button type="button" onClick={toggleAll} className="cursor-pointer font-medium hover:text-text-primary">
            Select all ({selectableIds.length})
          </button>
          <span className="text-xs text-text-muted">Documents you created are left out.</span>
        </div>
      )}

      {displayList.length === 0 ? (
        <div className="ui-rise-in flex flex-col items-center rounded-xl border border-border bg-surface px-6 py-16 text-center shadow-card">
          <span className="flex size-14 items-center justify-center rounded-full bg-success-soft text-success">
            <CheckCircle2 className="size-7" />
          </span>
          <h3 className="mt-4 text-base font-semibold text-text-primary">You are all caught up</h3>
          <p className="mt-1 max-w-sm text-[13px] text-text-muted">Nothing is waiting for approval in this view. New requests will show up here.</p>
        </div>
      ) : (
        GROUPS.map((g) => {
          const items = displayList.filter((i) => i.document_type === g.type);
          if (items.length === 0) return null;
          const Icon = g.icon;
          return (
            <section key={g.type} className="flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <span className="flex size-7 items-center justify-center rounded-lg bg-accent-soft text-accent">
                  <Icon className="size-4" />
                </span>
                <h2 className="text-sm font-semibold text-text-primary">{g.label}</h2>
                <span className="text-xs text-text-muted">{items.length}</span>
              </div>
              <div className="flex flex-col gap-2.5">
                {items.map((item) => {
                  const isMaker = item.maker_id === currentUser.id;
                  return (
                    <div
                      key={item.id}
                      data-testid="approval-card"
                      className="flex flex-col justify-between gap-4 rounded-xl border border-border bg-surface p-4 shadow-card transition duration-200 hover:border-border-strong hover:shadow-card-hover md:flex-row md:items-center"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        {isMaker ? (
                          <span title="You created this, so someone else must approve it" className="flex size-4 shrink-0 items-center justify-center text-text-muted">
                            <Lock className="size-3.5" />
                          </span>
                        ) : (
                          <Checkbox
                            checked={selected.has(item.id)}
                            onCheckedChange={() => toggleOne(item.id)}
                            aria-label={`Select ${item.document_number}`}
                            data-testid="approval-select"
                          />
                        )}
                        <Avatar name={item.maker_name} size="lg" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[13.5px] font-semibold text-text-primary">{item.title}</span>
                            <span className="shrink-0 rounded bg-surface-neutral px-1.5 py-0.5 text-[11px] text-text-secondary">{item.document_number}</span>
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-text-muted">
                            <span>
                              Sent by <span className="font-medium text-text-secondary">{item.maker_name}</span>
                            </span>
                            <span aria-hidden>·</span>
                            <span className="flex items-center gap-1" title={formatDateTime(item.submitted_at)}>
                              <Clock className="size-3" />
                              {ageLabel(item.submitted_at)}
                            </span>
                          </div>
                          {isMaker && (
                            <div className="mt-1 text-xs font-medium text-warning">You created this — someone else must approve</div>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center justify-between gap-5 md:justify-end">
                        <div className="text-right text-lg font-semibold tabular-nums tracking-tight text-text-primary">
                          {formatMoney(item.amount, item.currency)}
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleOpenDoc(item)}
                            className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text-secondary transition hover:bg-surface-neutral hover:text-text-primary"
                          >
                            <ExternalLink className="size-3.5" />
                            Open
                          </button>
                          {isMaker ? (
                            <span
                              className="cursor-not-allowed rounded-lg bg-surface-neutral px-2.5 py-1.5 text-xs font-medium text-text-muted"
                              title="You created this document, so someone else has to approve it."
                            >
                              Waiting for another approver
                            </span>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedItem(item);
                                  setModalType('return');
                                }}
                                className="flex h-8 items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text-secondary transition hover:border-danger/50 hover:bg-danger-soft hover:text-danger"
                              >
                                <RotateCcw className="size-3.5" />
                                Return
                              </button>
                              <button
                                type="button"
                                onClick={() => handleStartApprove(item)}
                                className="flex h-8 items-center gap-1.5 rounded-lg bg-success px-3.5 text-xs font-semibold text-white transition hover:opacity-90"
                              >
                                <CheckCircle className="size-3.5" />
                                Approve
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {/* Sticky bulk action bar */}
      {selectedItems.length > 0 && (
        <div
          role="toolbar"
          aria-label="Approve selected"
          className="ui-rise-in sticky bottom-4 z-30 mx-auto flex max-w-full items-center gap-3 rounded-xl border border-border-strong bg-surface-elevated py-2 pl-4 pr-2 shadow-popover"
        >
          <span className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
            <span className="flex size-5 items-center justify-center rounded-md bg-accent text-[11px] text-white">{selectedItems.length}</span>
            selected
          </span>
          <button
            type="button"
            onClick={() => setBulkReturnOpen(true)}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text-secondary transition hover:border-danger/50 hover:bg-danger-soft hover:text-danger"
          >
            <RotateCcw className="size-3.5" /> Return selected
          </button>
          <button
            type="button"
            onClick={() => setBulkSignOpen(true)}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-success px-3.5 text-xs font-semibold text-white transition hover:opacity-90"
          >
            <CheckCircle className="size-3.5" /> Approve {selectedItems.length}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs text-text-muted hover:bg-surface-neutral hover:text-text-primary"
          >
            Clear <Kbd>Esc</Kbd>
          </button>
        </div>
      )}

      {/* Bulk return dialog */}
      <Dialog open={bulkReturnOpen} onOpenChange={setBulkReturnOpen}>
        <DialogContent className="max-w-[480px] p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <RotateCcw className="size-4 text-warning" />
              Send back {selectedItems.length} {selectedItems.length === 1 ? 'document' : 'documents'}
            </DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-2 text-xs text-text-secondary">
            <label htmlFor="bulk-return-reason" className="font-semibold text-text-primary">Why are you sending them back?</label>
            <textarea
              id="bulk-return-reason"
              autoFocus
              rows={3}
              value={bulkReason}
              onChange={(e) => setBulkReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleBulkReturn();
              }}
              placeholder="The same reason is sent to every maker"
              className="w-full rounded-lg border border-border bg-surface p-2 text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
            <span className="text-[11px] text-text-muted">Ctrl+Enter to send</span>
          </div>
          <DialogFooter className="gap-2 border-t border-border pt-2">
            <button type="button" onClick={() => setBulkReturnOpen(false)} className="h-8 rounded-lg border border-border px-3 text-xs font-medium text-text-secondary hover:bg-surface-neutral">Cancel</button>
            <button
              type="button"
              onClick={handleBulkReturn}
              disabled={!bulkReason.trim()}
              className="h-8 rounded-lg bg-warning px-4 text-xs font-semibold text-white transition-colors hover:opacity-90 disabled:opacity-50"
            >
              Send back
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk PIN (asked once for the whole selection) */}
      <SignDialog
        isOpen={bulkSignOpen}
        onClose={() => setBulkSignOpen(false)}
        onConfirm={handleBulkApprove}
        documentTitle={`${selectedItems.length} ${selectedItems.length === 1 ? 'document' : 'documents'} waiting for approval`}
        actionTitle={`Approve ${selectedItems.length}`}
        consequenceText="Your PIN is checked once. Each document is then approved and posted on its own, and any that cannot be approved are listed afterwards with the reason."
      />

      {/* Results sheet */}
      <Sheet open={!!results} onOpenChange={(open) => !open && setResults(null)}>
        <SheetContent className="flex w-full flex-col gap-4 sm:max-w-md">
          <SheetHeader>
            <SheetTitle>{results?.kind === 'return' ? 'Sent back' : 'Approval results'}</SheetTitle>
            <SheetDescription>
              {results && `${results.rows.filter((r) => r.ok).length} of ${results.rows.length} ${results.kind === 'return' ? 'sent back' : 'approved'}.`}
            </SheetDescription>
          </SheetHeader>
          <ul className="flex flex-1 flex-col gap-2 overflow-auto" data-testid="bulk-results">
            {results?.rows.map((r) => (
              <li key={r.id} className="flex items-start gap-2.5 rounded-lg border border-border bg-surface p-3">
                {r.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-warning" />}
                <div className="min-w-0 text-[13px]">
                  <div className="truncate font-medium text-text-primary">{r.title}</div>
                  {r.ok ? (
                    <div className="text-xs text-text-muted">
                      {results.kind === 'return' ? 'Sent back to the maker' : <>Approved as <span className="font-medium text-text-secondary">{r.newNumber ?? r.number}</span></>}
                    </div>
                  ) : (
                    <div className="text-xs text-warning">Skipped: {r.reason}</div>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setResults(null)} className="h-9 rounded-lg bg-accent text-xs font-semibold text-white hover:bg-accent-hover">Done</button>
        </SheetContent>
      </Sheet>

      {/* Return Dialog */}
      <Dialog open={modalType === 'return' && !!selectedItem} onOpenChange={(open) => !open && setModalType(null)}>
        <DialogContent className="max-w-[480px] p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <RotateCcw className="w-4 h-4 text-warning" />
              <span>Send back for changes</span>
            </DialogTitle>
          </DialogHeader>

          {selectedItem && (
            <div className="text-xs text-text-secondary flex flex-col gap-2">
              <p>Return <strong className="text-text-primary">{selectedItem.document_number}</strong> to <strong className="text-text-primary">{selectedItem.maker_name}</strong> for correction.</p>
              <label className="font-semibold text-text-primary mt-2">
                Why are you sending it back?
              </label>
              <textarea
                rows={3}
                value={returnComment}
                onChange={(e) => setReturnComment(e.target.value)}
                placeholder="e.g. Please update unit price per revised commercial agreement"
                className="w-full p-2 bg-surface border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          )}

          <DialogFooter className="gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="h-8 px-3 rounded-lg border border-border text-xs font-medium text-text-secondary hover:bg-surface-neutral"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmReturn}
              disabled={loading || !returnComment.trim()}
              className="h-8 px-4 rounded-lg bg-warning hover:opacity-90 text-white text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
            >
              Send back
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 6-Digit PIN Signing Modal (Block D) */}
      {selectedItem && (
        <SignDialog
          isOpen={signDialogOpen}
          onClose={() => {
            setSignDialogOpen(false);
            setSelectedItem(null);
          }}
          onConfirm={handleConfirmApproveWithPin}
          documentTitle={selectedItem.title}
          documentNumber={selectedItem.document_number}
          amount={selectedItem.amount}
          currency={selectedItem.currency}
          periodName={selectedItem.period_name}
          makerName={selectedItem.maker_name}
          actionTitle="Approve and post"
          consequenceText={`Approving posts this document to your books with the next document number. It cannot be edited afterwards; mistakes are fixed with a reversal.`}
        />
      )}
    </div>
  );
};
