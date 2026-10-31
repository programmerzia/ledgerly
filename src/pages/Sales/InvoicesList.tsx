import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ColumnDef } from '@tanstack/react-table';
import { useLedgerStore } from '@/mock/store';
import { Invoice } from '@/types';
import { DataTable } from '@/components/domain/DataTable';
import { StatusPill } from '@/components/domain/StatusPill';
import { formatMoney, formatDate } from '@/lib/format';
import { Plus, FileText, ExternalLink, Eye, CreditCard, Bell, Copy, Download, RotateCcw, Printer, Building, Calendar, Layers, ShieldCheck, FileSpreadsheet } from 'lucide-react';
import { DocumentAuditTimeline } from '@/components/domain/DocumentAuditTimeline';
import { SplitPane } from '@/components/domain/SplitPane';
import { CoachPanel } from '@/components/domain/CoachPanel';
import { paymentStatus, amountDue, daysOverdue, summarizeByStatus, PAYMENT_STATUS_LABEL } from '@/lib/docStatus';
import { PageHeader } from '@/components/domain/PageHeader';
import { Kbd } from '@/components/ui/kbd';
import { toast } from 'sonner';
import { api } from '@/mock/api';
import { StatusSummaryStrip, DueCell } from './StatusSummaryStrip';

export const InvoicesList: React.FC = () => {
  const navigate = useNavigate();
  const { invoices, contacts, currentCompany, uiDensity, openTab } = useLedgerStore();
  const [activeTab, setActiveTab] = useState<string>('all');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [drawerTab, setDrawerTab] = useState<'details' | 'audit'>('details');

  const coSlug = currentCompany.slug;

  const buckets = useMemo(() => summarizeByStatus(invoices), [invoices]);

  const filteredInvoices = useMemo(() => {
    const list = invoices.filter((inv) => {
      if (activeTab === 'all') return true;
      const st = paymentStatus(inv);
      return (st === 'partially_paid' ? 'awaiting_payment' : st) === activeTab;
    });
    return [...list].sort(
      (a, b) =>
        b.issue_date.localeCompare(a.issue_date) || (b.number || '').localeCompare(a.number || '')
    );
  }, [invoices, activeTab]);

  const openInvoice = (inv: Invoice) => {
    openTab({ id: `tab-inv-${inv.id}`, title: inv.number || 'Draft Invoice', url: `/${coSlug}/invoices/${inv.id}`, type: 'invoice' });
    navigate(`/${coSlug}/invoices/${inv.id}`);
  };

  const rowActions = (inv: Invoice) => {
    const st = paymentStatus(inv);
    const posted = inv.status === 'posted';
    const open = posted && amountDue(inv) > 0;
    const customer = contacts.find((c) => c.id === inv.contact_id)?.name || 'the customer';
    return [
      { label: 'Open', icon: Eye, shortcut: 'Enter', onClick: () => openInvoice(inv) },
      ...(open
        ? [{ label: 'Record payment', icon: CreditCard, onClick: () => navigate(`/${coSlug}/receipts/new?invoiceId=${inv.id}`) }]
        : []),
      ...(st === 'overdue'
        ? [{ label: 'Send reminder', icon: Bell, onClick: () => toast.success(`Reminder sent to ${customer}`) }]
        : []),
      {
        label: 'Duplicate',
        icon: Copy,
        onClick: async () => {
          const dup = await api.duplicateInvoice(inv.id);
          toast.success(`Draft copy created: ${dup.number}`);
          navigate(`/${coSlug}/invoices/${dup.id}`);
        },
      },
      { label: 'Download PDF', icon: Download, onClick: () => toast.success(`Preparing PDF for ${inv.number || 'draft invoice'}`) },
      {
        label: 'Reverse',
        icon: RotateCcw,
        destructive: true,
        disabled: !posted || inv.reversal_of_id != null || inv.status === 'reversed',
        disabledReason: !posted ? 'Only invoices already in the books can be reversed' : 'This invoice is already reversed',
        onClick: () => {
          toast.info('Review and confirm the reversal on the invoice page');
          openInvoice(inv);
        },
      },
    ];
  };

  const columns: ColumnDef<Invoice>[] = [
    {
      accessorKey: 'number',
      header: 'Invoice #',
      cell: ({ row }) => (
        <span
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/${coSlug}/invoices/${row.original.id}`);
          }}
          className={
            row.original.number
              ? 'font-mono text-accent hover:underline cursor-pointer font-medium'
              : 'font-mono text-text-muted'
          }
        >
          {row.original.number || 'DRAFT'}
        </span>
      ),
    },
    {
      accessorKey: 'contact_id',
      header: 'Customer',
      cell: ({ row }) => {
        const contact = contacts.find((c) => c.id === row.original.contact_id);
        return <span className="font-medium text-text-primary">{contact?.name || 'Customer'}</span>;
      },
    },
    {
      accessorKey: 'issue_date',
      header: 'Issue date',
      cell: ({ row }) => (
        <span className="text-text-secondary">{formatDate(row.original.issue_date)}</span>
      ),
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
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusPill status={paymentStatus(row.original)} />,
    },
    {
      accessorKey: 'total',
      header: () => <div className="text-right">Total</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono text-num text-text-primary">
          {formatMoney(row.original.total, row.original.currency)}
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
            {formatMoney(due, row.original.currency)}
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
        title="Invoices"
        subtitle="Bill customers and track what's owed"
        icon={<FileText />}
        actions={
          <button
            type="button"
            onClick={() => navigate(`/${coSlug}/invoices/new`)}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 bg-accent hover:bg-accent-hover text-white rounded-lg text-[13px] font-semibold shadow-xs transition-colors"
          >
            <Plus className="size-4" />
            <span>New invoice</span>
            <Kbd className="ml-1 bg-white/20 text-white border-transparent">N</Kbd>
          </button>
        }
      />

      <StatusSummaryStrip
        buckets={buckets}
        active={activeTab}
        onChange={setActiveTab}
        totalCount={invoices.length}
        currency={currentCompany.base_currency}
      />

      {/* 3-Step Guided Coach Panel */}
      <CoachPanel
        moduleId="invoices"
        moduleName="Invoices"
        steps={[
          {
            title: '1. Create an invoice',
            desc: 'Pick a customer, add what you sold and the VAT rate. The invoice number is assigned for you.',
            actionLabel: 'New invoice',
            onAction: () => navigate(`/${coSlug}/invoices/new`),
          },
          {
            title: '2. Get it approved',
            desc: 'Submit the draft. A second person checks it before it is recorded and sent.',
            actionLabel: 'View approvals',
            onAction: () => navigate(`/${coSlug}/approvals`),
          },
          {
            title: '3. Follow up on payment',
            desc: 'See who owes you, what is overdue, and send customer statements.',
            actionLabel: 'Customers',
            onAction: () => navigate(`/${coSlug}/customers`),
          },
        ]}
      />

      {/* Main SplitPane Layout */}
      <SplitPane
        storageKey="ledgerly_invoices_split_width"
        isOpen={Boolean(selectedInvoice)}
        onClose={() => setSelectedInvoice(null)}
        title={selectedInvoice?.number || 'Draft Invoice'}
        subtitle={
          selectedInvoice
            ? `Customer: ${contacts.find((c) => c.id === selectedInvoice.contact_id)?.name || 'Customer'} • Issued ${formatDate(selectedInvoice.issue_date)}`
            : undefined
        }
        icon={<FileSpreadsheet className="w-4 h-4" />}
        onOpenFull={() => {
          if (!selectedInvoice) return;
          const invId = selectedInvoice.id;
          openTab({
            id: `tab-inv-${invId}`,
            title: selectedInvoice.number || 'Draft Invoice',
            url: `/${coSlug}/invoices/${invId}`,
            type: 'invoice',
          });
          navigate(`/${coSlug}/invoices/${invId}`);
        }}
        openFullLabel="Open Invoice"
        badge={selectedInvoice ? <StatusPill status={paymentStatus(selectedInvoice)} size="sm" /> : undefined}
        detailContent={
          selectedInvoice && (
            <div className="flex flex-col gap-4 text-xs">
              <div className="flex items-center justify-between border-b border-border pb-3">
                <div>
                  <h3 className="font-semibold text-text-primary text-sm">
                    {contacts.find((c) => c.id === selectedInvoice.contact_id)?.name || 'Customer'}
                  </h3>
                  <p className="text-[11px] text-text-muted mt-0.5">
                    Issued {formatDate(selectedInvoice.issue_date)} • Due {formatDate(selectedInvoice.due_date)} • Ref: {selectedInvoice.reference || 'N/A'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 h-7 px-2.5 rounded border border-border text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-neutral transition"
                  title="Print or export PDF"
                >
                  <Printer className="w-3.5 h-3.5 text-text-muted" />
                  <span>Print</span>
                </button>
              </div>

              {/* View Tabs */}
              <div className="flex items-center gap-2 border-b border-border">
                <button
                  type="button"
                  onClick={() => setDrawerTab('details')}
                  className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition ${
                    drawerTab === 'details'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-muted hover:text-text-primary'
                  }`}
                >
                  Details
                </button>
                <button
                  type="button"
                  onClick={() => setDrawerTab('audit')}
                  className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition flex items-center gap-1.5 ${
                    drawerTab === 'audit'
                      ? 'border-accent text-accent'
                      : 'border-transparent text-text-muted hover:text-text-primary'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>History</span>
                </button>
              </div>

              {drawerTab === 'details' ? (
                <div className="flex flex-col gap-4">
                  {/* Financial Snapshot */}
                  <div className="grid grid-cols-3 gap-2 p-3 rounded-md bg-surface-neutral/60 border border-border text-xs">
                    <div>
                      <span className="text-[10px] text-text-muted uppercase tracking-wider block">Total</span>
                      <span className="font-mono font-bold text-text-primary text-sm mt-0.5 block">
                        {formatMoney(selectedInvoice.total, selectedInvoice.currency)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-text-muted uppercase tracking-wider block">Paid</span>
                      <span className="font-mono font-semibold text-text-muted text-sm mt-0.5 block">
                        {formatMoney(selectedInvoice.settled, selectedInvoice.currency)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-text-muted uppercase tracking-wider block">Amount due</span>
                      <span className="font-mono font-bold text-accent text-sm mt-0.5 block">
                        {formatMoney(selectedInvoice.total - selectedInvoice.settled, selectedInvoice.currency)}
                      </span>
                    </div>
                  </div>

                  {/* Line Items */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                      <Layers className="w-3.5 h-3.5 text-text-muted" />
                      Line Items ({selectedInvoice.lines.length})
                    </span>
                    <div className="border border-border rounded-md overflow-hidden bg-surface">
                      <table className="w-full text-left text-xs table-dense">
                        <thead className="bg-surface-neutral border-b border-border text-[11px] font-semibold text-text-muted uppercase">
                          <tr>
                            <th className="px-2.5 py-1.5">Description</th>
                            <th className="px-2 py-1.5 text-right w-12">Qty</th>
                            <th className="px-2.5 py-1.5 text-right w-20">Unit</th>
                            <th className="px-2.5 py-1.5 text-right w-24">Amount</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {selectedInvoice.lines.map((line, idx) => (
                            <tr key={idx} className="hover:bg-surface-neutral/40">
                              <td className="px-2.5 py-1.5 truncate max-w-[180px] text-text-primary">
                                {line.description}
                              </td>
                              <td className="px-2 py-1.5 text-right font-mono text-text-muted">
                                {line.quantity}
                              </td>
                              <td className="px-2.5 py-1.5 text-right font-mono text-text-muted">
                                {formatMoney(line.unit_price_fc, selectedInvoice.currency)}
                              </td>
                              <td className="px-2.5 py-1.5 text-right font-mono font-medium text-text-primary">
                                {formatMoney(line.line_total_fc, selectedInvoice.currency)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* How it is recorded */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-success" />
                      How it is recorded
                    </span>
                    <div className="border border-border rounded-md p-2.5 bg-surface-neutral/40 flex flex-col gap-1.5 font-mono text-[11px]">
                      <div className="flex items-center justify-between text-text-secondary">
                        <span>Dr 1200 Accounts Receivable Control</span>
                        <span className="font-semibold text-text-primary">
                          {formatMoney(selectedInvoice.total, selectedInvoice.currency)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-text-secondary pl-3">
                        <span>Cr 4000 Sales Revenue</span>
                        <span className="font-semibold text-text-primary">
                          {formatMoney(selectedInvoice.subtotal, selectedInvoice.currency)}
                        </span>
                      </div>
                      {selectedInvoice.tax_total > 0 && (
                        <div className="flex items-center justify-between text-text-secondary pl-3">
                          <span>Cr 2200 Output Tax Liability</span>
                          <span className="font-semibold text-text-primary">
                            {formatMoney(selectedInvoice.tax_total, selectedInvoice.currency)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <DocumentAuditTimeline
                  documentId={selectedInvoice.id}
                  documentNumber={selectedInvoice.number}
                  documentType="invoice"
                  documentStatus={selectedInvoice.status}
                  createdAt={selectedInvoice.created_at}
                  createdBy={selectedInvoice.created_by}
                  submittedBy={selectedInvoice.submitted_by}
                  postedAt={selectedInvoice.posted_at}
                  approvedBy={selectedInvoice.approved_by}
                  signedAt={selectedInvoice.signed_at}
                  signatureHash={selectedInvoice.signature_hash}
                  memo={selectedInvoice.memo}
                  total={selectedInvoice.total}
                  currency={selectedInvoice.currency}
                  linesCount={selectedInvoice.lines.length}
                  contactName={contacts.find((c) => c.id === selectedInvoice.contact_id)?.name || 'Customer'}
                  settledAmount={selectedInvoice.settled}
                  journalId={selectedInvoice.journal_id}
                />
              )}

              {/* Action Buttons */}
              <div className="pt-3 border-t border-border flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const invId = selectedInvoice.id;
                    openTab({
                      id: `tab-inv-${invId}`,
                      title: selectedInvoice.number || 'Draft Invoice',
                      url: `/${coSlug}/invoices/${invId}`,
                      type: 'invoice',
                    });
                    navigate(`/${coSlug}/invoices/${invId}`);
                  }}
                  className="w-full h-8 bg-accent hover:bg-accent-hover text-white rounded-sm text-xs font-semibold shadow-xs transition flex items-center justify-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open invoice (Enter)</span>
                </button>
              </div>
            </div>
          )
        }
      >
        {/* TanStack Data Table */}
        <DataTable
          columns={columns}
          data={filteredInvoices}
          activeRowId={selectedInvoice?.id}
          searchPlaceholder="Filter invoices by customer or reference..."
          rowDensity={uiDensity}
          rowActions={rowActions}
          contextMenuTitle={(r) => r.number || 'Draft invoice'}
          onRowClick={(row) => setSelectedInvoice(row)}
          onRowDoubleClick={(row) => {
            openTab({
              id: `tab-inv-${row.id}`,
              title: row.number || 'Draft Invoice',
              url: `/${coSlug}/invoices/${row.id}`,
              type: 'invoice',
            });
            navigate(`/${coSlug}/invoices/${row.id}`);
          }}
        />
      </SplitPane>
    </div>
  );
};
