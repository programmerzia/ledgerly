import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerStore } from '@/mock/store';
import { formatMoney, formatDateTime } from '@/lib/format';
import { SignDialog } from '@/components/domain/SignDialog';
import {
  CheckSquare,
  Clock,
  CheckCircle,
  RotateCcw,
  ExternalLink,
  ShieldAlert,
  AlertTriangle,
  X,
  Building,
  FileSpreadsheet,
  FileText,
  BookMarked,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

export const ApprovalsInbox: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, currentUser, invoices, bills, journals, contacts } = useLedgerStore();
  const [activeTab, setActiveTab] = useState<'waiting' | 'submitted' | 'all'>('waiting');

  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [modalType, setModalType] = useState<'return' | null>(null);
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [returnComment, setReturnComment] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const coSlug = currentCompany.slug;

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
      alert('Segregation of Duties: As the creator of this document, you cannot approve it. Switch user to Fatima Hassan (Approver) to approve.');
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
      alert(err.message || 'Approval failed');
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

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-ink-200">
        <div>
          <h1 className="text-h1 font-bold text-ink-900 flex items-center gap-2">
            <CheckSquare className="w-6 h-6 text-brand-600" />
            Approvals Inbox
          </h1>
          <p className="text-xs text-ink-500 mt-0.5">
            Segregation of duties & maker-checker dual authorization queue
          </p>
        </div>

        <div className="text-xs font-medium text-ink-500 bg-ink-100 px-3 py-1.5 rounded-sm border border-ink-200">
          Current Reviewer: <span className="text-ink-900 font-semibold">{currentUser.name}</span> ({currentUser.roleTitle})
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-ink-200">
        <button
          type="button"
          onClick={() => setActiveTab('waiting')}
          className={`flex items-center gap-2 px-4 py-2 border-b-2 text-xs font-medium transition-colors ${
            activeTab === 'waiting'
              ? 'border-brand-600 text-brand-700 font-semibold'
              : 'border-transparent text-ink-500 hover:text-ink-900'
          }`}
        >
          <span>Waiting for My Review</span>
          <span className="text-[10px] font-mono bg-warning-bg text-warning px-1.5 py-0.2 rounded-full font-bold">
            {waitingForMe.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('submitted')}
          className={`flex items-center gap-2 px-4 py-2 border-b-2 text-xs font-medium transition-colors ${
            activeTab === 'submitted'
              ? 'border-brand-600 text-brand-700 font-semibold'
              : 'border-transparent text-ink-500 hover:text-ink-900'
          }`}
        >
          <span>Submitted by Me</span>
          <span className="text-[10px] font-mono bg-ink-100 text-ink-700 px-1.5 py-0.2 rounded-full">
            {submittedByMe.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('all')}
          className={`flex items-center gap-2 px-4 py-2 border-b-2 text-xs font-medium transition-colors ${
            activeTab === 'all'
              ? 'border-brand-600 text-brand-700 font-semibold'
              : 'border-transparent text-ink-500 hover:text-ink-900'
          }`}
        >
          <span>All Pending Requests</span>
          <span className="text-[10px] font-mono bg-ink-100 text-ink-700 px-1.5 py-0.2 rounded-full">
            {pendingItems.length}
          </span>
        </button>
      </div>

      {/* List */}
      <div className="flex flex-col gap-3">
        {displayList.length === 0 ? (
          <div className="p-12 text-center bg-surface border border-ink-200 rounded-lg">
            <div className="w-12 h-12 rounded-full bg-success-bg text-success mx-auto flex items-center justify-center mb-3">
              <CheckCircle className="w-6 h-6" />
            </div>
            <h3 className="text-h3 font-semibold text-ink-900">All clear!</h3>
            <p className="text-xs text-ink-500 mt-1 max-w-sm mx-auto">
              No approval requests are currently waiting in this view. Controls-grade dual approval is satisfied.
            </p>
          </div>
        ) : (
          displayList.map((item) => {
            const isMaker = item.maker_id === currentUser.id;

            return (
              <div
                key={item.id}
                className="p-4 bg-surface border border-ink-200 rounded-lg shadow-sm hover:border-brand-500/60 transition-colors flex flex-col md:flex-row md:items-center justify-between gap-4"
              >
                <div className="flex items-start gap-3">
                  <div className="p-2 rounded bg-brand-50 text-brand-600 mt-0.5">
                    {item.document_type === 'sales_invoice' ? (
                      <FileSpreadsheet className="w-5 h-5" />
                    ) : item.document_type === 'purchase_bill' ? (
                      <FileText className="w-5 h-5" />
                    ) : (
                      <BookMarked className="w-5 h-5" />
                    )}
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-xs text-ink-900">{item.title}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-ink-100 text-ink-700">
                        {item.document_number}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3 text-xs text-ink-500">
                      <span>Counterparty: <strong className="text-ink-700">{item.contact_name}</strong></span>
                      <span>•</span>
                      <span>Maker: <strong className="text-ink-700">{item.maker_name}</strong></span>
                      <span>•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDateTime(item.submitted_at)}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex items-center justify-between md:justify-end gap-5 pt-3 md:pt-0 border-t md:border-t-0 border-ink-100">
                  <div className="text-right font-mono">
                    <div className="text-sm font-bold text-ink-900">
                      {formatMoney(item.amount, item.currency)}
                    </div>
                    <div className="text-[10px] text-ink-500">Period: {item.period_name}</div>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenDoc(item)}
                      className="flex items-center gap-1.5 h-8 px-3 rounded-sm border border-ink-200 hover:border-brand-500 bg-surface text-ink-700 text-xs font-medium transition-colors"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-brand-600" />
                      <span>Open</span>
                    </button>

                    {isMaker ? (
                      <span
                        className="text-[11px] font-medium text-ink-500 bg-ink-100 px-2.5 py-1.5 rounded-sm border border-ink-200 cursor-not-allowed"
                        title="Controls Rule: Maker cannot approve own document"
                      >
                        Own Document (Maker)
                      </span>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedItem(item);
                            setModalType('return');
                          }}
                          className="flex items-center gap-1 h-8 px-2.5 rounded-sm border border-ink-200 hover:border-danger hover:text-danger bg-surface text-ink-700 text-xs font-medium transition-colors"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Return</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleStartApprove(item)}
                          className="flex items-center gap-1 h-8 px-3.5 rounded-sm bg-success hover:opacity-90 text-white text-xs font-semibold shadow-sm transition-colors"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          <span>Approve</span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Return Dialog */}
      <Dialog open={modalType === 'return' && !!selectedItem} onOpenChange={(open) => !open && setModalType(null)}>
        <DialogContent className="max-w-[480px] p-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-semibold">
              <RotateCcw className="w-4 h-4 text-warning" />
              <span>Return Document to Maker</span>
            </DialogTitle>
          </DialogHeader>

          {selectedItem && (
            <div className="text-xs text-text-secondary flex flex-col gap-2">
              <p>Return <strong className="text-text-primary">{selectedItem.document_number}</strong> to <strong className="text-text-primary">{selectedItem.maker_name}</strong> for correction.</p>
              <label className="font-semibold text-text-primary mt-2">
                Reason for Return (Mandatory Audit Requirement)
              </label>
              <textarea
                rows={3}
                value={returnComment}
                onChange={(e) => setReturnComment(e.target.value)}
                placeholder="e.g. Please update unit price per revised commercial agreement"
                className="w-full p-2 bg-surface border border-border rounded-sm text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          )}

          <DialogFooter className="gap-2 pt-2 border-t border-border">
            <button
              type="button"
              onClick={() => setModalType(null)}
              className="h-8 px-3 rounded-sm border border-border text-xs font-medium text-text-secondary hover:bg-surface-neutral"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirmReturn}
              disabled={loading || !returnComment.trim()}
              className="h-8 px-4 rounded-sm bg-warning hover:opacity-90 text-white text-xs font-semibold shadow-xs transition-colors disabled:opacity-50"
            >
              Return to Maker
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
          actionTitle="Authorize & Post Document"
          consequenceText={`Approving will verify maker-checker controls, allocate a gapless sequence number, update ledger lines, and stamp your cryptographic signature hash.`}
        />
      )}
    </div>
  );
};
