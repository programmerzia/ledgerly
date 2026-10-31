import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ColumnDef } from '@tanstack/react-table';
import { useLedgerStore } from '@/mock/store';
import { Bill } from '@/types';
import { DataTable } from '@/components/domain/DataTable';
import { StatusPill } from '@/components/domain/StatusPill';
import { formatMoney, formatDate } from '@/lib/format';
import { SplitPane } from '@/components/domain/SplitPane';
import { SignDialog } from '@/components/domain/SignDialog';
import { CoachPanel } from '@/components/domain/CoachPanel';
import { paymentStatus, amountDue, daysOverdue, summarizeByStatus } from '@/lib/docStatus';
import { StatusSummaryStrip, DueCell } from '@/pages/Sales/StatusSummaryStrip';
import { PageHeader } from '@/components/domain/PageHeader';
import { Kbd } from '@/components/ui/kbd';
import { toast } from 'sonner';
import { api } from '@/mock/api';
import {
  Eye,
  CreditCard,
  Bell,
  Copy,
  Download,
  RotateCcw,
  Plus,
  FileText,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Building,
  Coins,
} from 'lucide-react';

export const BillsList: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, currentUser, companySettings, bills, contacts, approveBill, openTab, uiDensity } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [actionError, setActionError] = useState('');

  // Suppliers map
  const suppliersMap = useMemo(() => {
    return new Map(contacts.map((c) => [c.id, c]));
  }, [contacts]);

  // Filtered bills
  const buckets = useMemo(() => summarizeByStatus(bills), [bills]);

  const filteredBills = useMemo(() => {
    const list = bills.filter((b) => {
      if (selectedStatus === 'all') return true;
      const st = paymentStatus(b);
      return (st === 'partially_paid' ? 'awaiting_payment' : st) === selectedStatus;
    });
    return [...list].sort(
      (a, b) =>
        b.issue_date.localeCompare(a.issue_date) || (b.number || '').localeCompare(a.number || '')
    );
  }, [bills, selectedStatus]);

  const selectedBill = useMemo(() => {
    return bills.find((b) => b.id === selectedBillId) || null;
  }, [bills, selectedBillId]);

  const handleOpenTab = (bill: Bill) => {
    openTab({
      id: `bill-${bill.id}`,
      title: bill.number || `Draft Bill (${bill.reference})`,
      url: `/${coSlug}/bills/${bill.id}`,
      type: 'bill',
    });
    navigate(`/${coSlug}/bills/${bill.id}`);
  };

  const handleApproveConfirm = async (pin: string) => {
    if (!selectedBill) return;
    try {
      setActionError('');
      approveBill(selectedBill.id, currentUser, pin, companySettings);
      setSignDialogOpen(false);
    } catch (err: any) {
      setActionError(err.message || 'Approval failed');
    }
  };

  const rowActions = (bill: Bill) => {
    const st = paymentStatus(bill);
    const posted = bill.status === 'posted';
    const open = posted && amountDue(bill) > 0;
    return [
      { label: 'Open', icon: Eye, shortcut: 'Enter', onClick: () => handleOpenTab(bill) },
      ...(open
        ? [{ label: 'Pay', icon: CreditCard, onClick: () => { toast.info('Choose how much to pay on the bill page'); handleOpenTab(bill); } }]
        : []),
      ...(st === 'overdue'
        ? [{ label: 'Send reminder', icon: Bell, onClick: () => toast.success('Payment note queued for the supplier') }]
        : []),
      {
        label: 'Duplicate',
        icon: Copy,
        onClick: async () => {
          const dup = await api.duplicateBill(bill.id);
          toast.success(`Draft copy created: ${dup.number}`);
          navigate(`/${coSlug}/bills/${dup.id}`);
        },
      },
      { label: 'Download PDF', icon: Download, onClick: () => toast.success(`Preparing PDF for ${bill.number || 'draft bill'}`) },
      {
        label: 'Reverse',
        icon: RotateCcw,
        destructive: true,
        disabled: !posted,
        disabledReason: 'Only bills already in the books can be reversed',
        onClick: () => {
          toast.info('Review and confirm the reversal on the bill page');
          handleOpenTab(bill);
        },
      },
    ];
  };

  const columns: ColumnDef<Bill>[] = [
    {
      accessorKey: 'number',
      header: 'Bill #',
      cell: ({ row }) => (
        <span
          onClick={(e) => {
            e.stopPropagation();
            handleOpenTab(row.original);
          }}
          className="font-mono font-medium text-accent hover:underline cursor-pointer"
        >
          {row.original.number || 'DRAFT-BILL'}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusPill status={paymentStatus(row.original)} size="sm" />,
    },
    {
      accessorKey: 'contact_id',
      header: 'Supplier',
      cell: ({ row }) => {
        const supplier = suppliersMap.get(row.original.contact_id);
        return <span className="font-medium text-text-primary">{supplier?.name || row.original.contact_id}</span>;
      },
    },
    {
      accessorKey: 'issue_date',
      header: 'Issue date',
      cell: ({ row }) => <span className="text-text-secondary">{formatDate(row.original.issue_date)}</span>,
    },
    {
      accessorKey: 'due_date',
      header: 'Due date',
      cell: ({ row }) => {
        const st = paymentStatus(row.original);
        const open = st === 'awaiting_payment' || st === 'partially_paid' || st === 'overdue';
        return (
          <DueCell
            date={row.original.due_date}
            formatted={formatDate(row.original.due_date)}
            open={open}
            overdueDays={daysOverdue(row.original)}
          />
        );
      },
    },
    {
      accessorKey: 'wht_amount_fc',
      header: () => <div className="text-right">WHT</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono text-num text-text-muted">
          {row.original.wht_amount_fc ? formatMoney(row.original.wht_amount_fc) : '—'}
        </div>
      ),
    },
    {
      accessorKey: 'total',
      header: () => <div className="text-right">Total</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono text-num font-semibold text-text-primary">
          {formatMoney(row.original.total)}
        </div>
      ),
    },
    {
      id: 'amount_due',
      header: () => <div className="text-right">Amount due</div>,
      cell: ({ row }) => {
        const due = amountDue(row.original);
        const st = paymentStatus(row.original);
        const isOpen = st === 'awaiting_payment' || st === 'partially_paid' || st === 'overdue';
        return due > 0 && isOpen ? (
          <div className={`text-right font-mono text-num font-medium ${st === 'overdue' ? 'text-danger' : 'text-text-primary'}`}>
            {formatMoney(due)}
          </div>
        ) : (
          <div className="text-right font-mono text-num text-text-muted">—</div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Bills"
        subtitle="Track what you owe suppliers"
        icon={<FileText />}
        actions={
          <button
            type="button"
            onClick={() => navigate(`/${coSlug}/bills/new`)}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-[13px] font-semibold shadow-xs transition-colors"
          >
            <Plus className="size-4" />
            <span>New bill</span>
            <Kbd className="ml-1 bg-white/20 text-white border-transparent">N</Kbd>
          </button>
        }
      />

      <StatusSummaryStrip
        buckets={buckets}
        active={selectedStatus}
        onChange={setSelectedStatus}
        totalCount={bills.length}
        currency={currentCompany.base_currency}
      />

      {/* 3-Step Guided Coach Panel */}
      <CoachPanel
        moduleId="bills"
        moduleName="Bills"
        steps={[
          {
            title: '1. Enter a supplier bill',
            desc: 'Choose the supplier, add their invoice reference and the expenses on it.',
            actionLabel: 'New bill',
            onAction: () => navigate(`/${coSlug}/bills/new`),
          },
          {
            title: '2. Get it approved',
            desc: 'Someone other than the person who entered the bill needs to approve it.',
            actionLabel: 'Approvals',
            onAction: () => navigate(`/${coSlug}/approvals`),
          },
          {
            title: '3. Pay your suppliers',
            desc: 'Pay several bills at once. Withholding tax is deducted for you.',
            actionLabel: 'Payment run',
            onAction: () => navigate(`/${coSlug}/payment-run`),
          },
        ]}
      />

      {/* Main SplitPane View */}
      <SplitPane
        storageKey="ledgerly_bills_split_width"
        isOpen={Boolean(selectedBill)}
        onClose={() => setSelectedBillId(null)}
        title={selectedBill?.number || 'Draft Bill'}
        subtitle={
          selectedBill
            ? `Supplier: ${suppliersMap.get(selectedBill.contact_id)?.name || 'Supplier'} • Ref: ${selectedBill.reference}`
            : undefined
        }
        icon={<FileText className="w-4 h-4" />}
        onOpenFull={() => selectedBill && handleOpenTab(selectedBill)}
        openFullLabel="Open Bill"
        badge={selectedBill ? <StatusPill status={paymentStatus(selectedBill)} size="sm" /> : undefined}
        detailContent={
          selectedBill && (
            <div className="flex flex-col gap-4 text-xs">
              {/* Supplier info */}
              <div className="p-3 bg-surface-neutral/60 border border-border rounded-sm flex flex-col gap-1.5">
                <div className="text-[10px] uppercase font-bold text-text-muted flex items-center gap-1">
                  <Building className="w-3 h-3 text-accent" />
                  Supplier
                </div>
                <div className="font-semibold text-text-primary text-sm">
                  {suppliersMap.get(selectedBill.contact_id)?.name || 'Unknown Supplier'}
                </div>
                <div className="text-text-muted font-mono text-[11px]">
                  Ref: {selectedBill.reference} • Terms: 30 days
                </div>
              </div>

              {/* Consequence Preview Banner */}
              <div className="p-2.5 bg-accent/5 border border-accent/20 rounded-sm text-text-primary flex flex-col gap-1">
                <span className="font-semibold text-[11px] text-accent uppercase tracking-wide flex items-center gap-1">
                  <Coins className="w-3.5 h-3.5" />
                  How it is recorded
                </span>
                <p className="text-[11px] text-text-secondary leading-relaxed">
                  {selectedBill.status === 'posted' ? (
                    <>
                      Posted to Accounts Payable (2000). Total liability{' '}
                      <strong className="text-num font-mono text-text-primary">
                        {formatMoney(selectedBill.total)}
                      </strong>
                      {selectedBill.wht_amount_fc ? (
                        <>
                          {' '}with{' '}
                          <strong className="text-num font-mono text-text-primary">
                            {formatMoney(selectedBill.wht_amount_fc)}
                          </strong>{' '}
                          withholding tax withheld.
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      Posting will credit AP Control 2000 for{' '}
                      <strong className="text-num font-mono text-text-primary">
                        {formatMoney(selectedBill.total - (selectedBill.wht_amount_fc || 0))}
                      </strong>{' '}
                      and credit WHT Payable for{' '}
                      <strong className="text-num font-mono text-text-primary">
                        {formatMoney(selectedBill.wht_amount_fc || 0)}
                      </strong>.
                    </>
                  )}
                </p>
              </div>

              {/* Key Dates & Currency */}
              <div className="grid grid-cols-2 gap-2 p-2.5 bg-surface-neutral/40 border border-border rounded-sm text-[11px]">
                <div>
                  <span className="text-text-muted block">Issue Date</span>
                  <span className="font-mono text-text-primary font-medium">{selectedBill.issue_date}</span>
                </div>
                <div>
                  <span className="text-text-muted block">Due Date</span>
                  <span className="font-mono text-text-primary font-medium">{selectedBill.due_date}</span>
                </div>
                <div>
                  <span className="text-text-muted block">Currency / FX</span>
                  <span className="font-mono text-text-primary font-medium">
                    {selectedBill.currency} @ {selectedBill.fx_rate.toFixed(4)}
                  </span>
                </div>
                <div>
                  <span className="text-text-muted block">Period</span>
                  <span className="font-mono text-text-primary font-medium">{selectedBill.issue_date.slice(0, 7)}</span>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-col gap-2 pt-2 border-t border-border">
                {actionError && (
                  <div className="p-2 rounded bg-danger/10 border border-danger/30 text-danger text-[11px] flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{actionError}</span>
                  </div>
                )}

                {selectedBill.status === 'pending_approval' && (
                  <button
                    type="button"
                    onClick={() => setSignDialogOpen(true)}
                    className="w-full h-8 bg-success hover:bg-success/90 text-white rounded-sm font-semibold transition flex items-center justify-center gap-1.5 shadow-xs"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Approve bill</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleOpenTab(selectedBill)}
                  className="w-full h-8 bg-accent hover:bg-accent-hover text-white rounded-sm font-semibold transition flex items-center justify-center gap-1.5 shadow-xs"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open bill (Enter)</span>
                </button>
              </div>
            </div>
          )
        }
      >
        <DataTable
          columns={columns}
          data={filteredBills}
          activeRowId={selectedBillId}
          searchPlaceholder="Filter bills by number, supplier, or reference..."
          rowDensity={uiDensity}
          rowActions={rowActions}
          contextMenuTitle={(r) => r.number || r.reference || 'Draft bill'}
          onRowClick={(row) => setSelectedBillId(row.id)}
          onRowDoubleClick={(row) => handleOpenTab(row)}
        />
      </SplitPane>

      {/* 6-Digit PIN SignDialog */}
      {selectedBill && (
        <SignDialog
          isOpen={signDialogOpen}
          onClose={() => setSignDialogOpen(false)}
          onConfirm={handleApproveConfirm}
          documentTitle="Supplier Bill Approval"
          documentNumber={selectedBill.number || 'Bill Draft'}
          periodName={currentCompany.base_currency}
          amount={selectedBill.total}
          consequenceText={`This will finalize the bill and post AP Control journal entry. Net payable of ${formatMoney(
            selectedBill.total - (selectedBill.wht_amount_fc || 0)
          )} will be scheduled for supplier payment.`}
        />
      )}
    </div>
  );
};
