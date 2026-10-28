import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ColumnDef } from '@tanstack/react-table';
import { useLedgerStore } from '@/mock/store';
import { Invoice } from '@/types';
import { DataTable } from '@/components/domain/DataTable';
import { StatusPill } from '@/components/domain/StatusPill';
import { formatMoney, formatDate } from '@/lib/format';
import { Plus, ExternalLink, Printer, Building, Calendar, Layers, ShieldCheck } from 'lucide-react';
import { DocumentAuditTimeline } from '@/components/domain/DocumentAuditTimeline';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';

export const InvoicesList: React.FC = () => {
  const navigate = useNavigate();
  const { invoices, contacts, currentCompany, uiDensity, openTab } = useLedgerStore();
  const [activeTab, setActiveTab] = useState<string>('all');
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [drawerTab, setDrawerTab] = useState<'details' | 'audit'>('details');

  const coSlug = currentCompany.slug;

  const filteredInvoices = invoices.filter((inv) => {
    if (activeTab === 'draft') return inv.status === 'draft';
    if (activeTab === 'pending') return inv.status === 'pending_approval';
    if (activeTab === 'posted') return inv.status === 'posted';
    return true;
  });

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
      header: 'Issue Date',
      cell: ({ row }) => (
        <span className="text-text-secondary">{formatDate(row.original.issue_date)}</span>
      ),
    },
    {
      accessorKey: 'due_date',
      header: 'Due Date',
      cell: ({ row }) => (
        <span className="text-text-secondary">{formatDate(row.original.due_date)}</span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => <StatusPill status={row.original.status} />,
    },
    {
      accessorKey: 'total',
      header: () => <div className="text-right">Total Amount</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono text-num text-text-primary">
          {formatMoney(row.original.total, row.original.currency)}
        </div>
      ),
    },
    {
      accessorKey: 'settled',
      header: () => <div className="text-right">Settled</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono text-num text-text-muted">
          {row.original.settled > 0
            ? formatMoney(row.original.settled, row.original.currency)
            : '—'}
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Page Header (Block 3.5: title 20px/600, subtitle 13px muted, actions right) */}
      <div className="flex items-center justify-between pb-2">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Sales Invoices</h1>
          <p className="text-xs text-text-muted mt-0.5">
            Accounts receivable control ledger • Gapless sequence numbering
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => navigate(`/${coSlug}/invoices/new`)}
            className="flex items-center gap-1.5 h-8 px-3.5 bg-accent hover:bg-accent-hover text-white rounded-sm text-xs font-semibold shadow-xs transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Invoice (n)</span>
          </button>
        </div>
      </div>

      {/* TanStack Data Table */}
      <DataTable
        columns={columns}
        data={filteredInvoices}
        searchPlaceholder="Filter invoices by customer or reference..."
        rowDensity={uiDensity}
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
        filterTabs={[
          { label: 'All Invoices', value: 'all', count: invoices.length },
          {
            label: 'Drafts',
            value: 'draft',
            count: invoices.filter((i) => i.status === 'draft').length,
          },
          {
            label: 'Pending Approval',
            value: 'pending',
            count: invoices.filter((i) => i.status === 'pending_approval').length,
          },
          {
            label: 'Posted',
            value: 'posted',
            count: invoices.filter((i) => i.status === 'posted').length,
          },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      {/* Quick Detail Drawer on Row Click */}
      <Sheet open={Boolean(selectedInvoice)} onOpenChange={(open) => !open && setSelectedInvoice(null)}>
        {selectedInvoice && (
          <SheetContent className="w-full sm:max-w-2xl overflow-y-auto flex flex-col justify-between">
            <div className="flex flex-col gap-5">
              {/* Drawer Header */}
              <SheetHeader className="border-b border-border pb-4">
                <div className="flex items-center justify-between pr-6">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-bold text-accent bg-accent-soft px-2 py-0.5 rounded">
                      {selectedInvoice.number || 'DRAFT'}
                    </span>
                    <StatusPill status={selectedInvoice.status} />
                  </div>
                  <button
                    type="button"
                    onClick={() => window.print()}
                    className="flex items-center gap-1.5 h-7 px-2.5 rounded border border-border text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-neutral transition"
                    title="Print or export PDF"
                  >
                    <Printer className="w-3.5 h-3.5 text-text-muted" />
                    <span>Print / PDF</span>
                  </button>
                </div>
                <SheetTitle className="text-lg font-bold text-text-primary mt-2 flex items-center justify-between">
                  <span>{contacts.find((c) => c.id === selectedInvoice.contact_id)?.name || 'Customer'}</span>
                </SheetTitle>
                <SheetDescription className="text-xs text-text-muted">
                  Issue Date: {formatDate(selectedInvoice.issue_date)} • Due Date: {formatDate(selectedInvoice.due_date)} • Ref: {selectedInvoice.reference || 'N/A'}
                </SheetDescription>

                {/* Drawer View Tabs */}
                <div className="flex items-center gap-2 border-b border-border mt-3 pt-1">
                  <button
                    type="button"
                    onClick={() => setDrawerTab('details')}
                    className={`px-3 py-1.5 text-xs font-semibold border-b-2 transition ${
                      drawerTab === 'details'
                        ? 'border-accent text-accent'
                        : 'border-transparent text-text-muted hover:text-text-primary'
                    }`}
                  >
                    Document & Lines
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
                    <span>Audit Log (Full History)</span>
                  </button>
                </div>
              </SheetHeader>

              {/* Drawer Body: Details View */}
              {drawerTab === 'details' && (
                <div className="flex flex-col gap-5">
                  {/* Financial Snapshot */}
                  <div className="grid grid-cols-3 gap-2.5 p-3 rounded-md bg-surface-neutral/60 border border-border text-xs">
                    <div>
                      <span className="text-[10px] text-text-muted uppercase tracking-wider block">Total Amount</span>
                      <span className="font-mono font-bold text-text-primary text-sm mt-0.5 block">
                        {formatMoney(selectedInvoice.total, selectedInvoice.currency)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-text-muted uppercase tracking-wider block">Settled</span>
                      <span className="font-mono font-semibold text-text-muted text-sm mt-0.5 block">
                        {formatMoney(selectedInvoice.settled, selectedInvoice.currency)}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-text-muted uppercase tracking-wider block">Balance Due</span>
                      <span className="font-mono font-bold text-accent text-sm mt-0.5 block">
                        {formatMoney(selectedInvoice.total - selectedInvoice.settled, selectedInvoice.currency)}
                      </span>
                    </div>
                  </div>

                  {/* Line Items Grid */}
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
                              <td className="px-2.5 py-1.5 truncate max-w-[200px] text-text-primary">
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

                  {/* Derived Ledger Accounting Impact */}
                  <div className="flex flex-col gap-1.5">
                    <span className="text-xs font-semibold text-text-primary flex items-center gap-1.5">
                      <ShieldCheck className="w-3.5 h-3.5 text-success" />
                      Derived Journal Postings
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
              )}

              {/* Drawer Body: Full Audit Log View */}
              {drawerTab === 'audit' && (
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
            </div>

            {/* Drawer Action Footer */}
            <SheetFooter className="mt-6 pt-4 border-t border-border flex items-center justify-between sm:justify-between w-full">
              <button
                type="button"
                onClick={() => setSelectedInvoice(null)}
                className="h-8 px-3 rounded-sm border border-border text-text-muted hover:text-text-primary text-xs font-medium hover:bg-surface-neutral transition"
              >
                Close
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-sm border border-border hover:border-border-strong bg-surface text-text-primary text-xs font-medium hover:bg-surface-neutral transition"
                >
                  <Printer className="w-3.5 h-3.5 text-text-muted" />
                  <span>Print / PDF</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const invId = selectedInvoice.id;
                    setSelectedInvoice(null);
                    openTab({
                      id: `tab-inv-${invId}`,
                      title: selectedInvoice.number || 'Draft Invoice',
                      url: `/${coSlug}/invoices/${invId}`,
                      type: 'invoice',
                    });
                    navigate(`/${coSlug}/invoices/${invId}`);
                  }}
                  className="flex items-center gap-1.5 h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded-sm text-xs font-semibold shadow-xs transition"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Full Document</span>
                </button>
              </div>
            </SheetFooter>
          </SheetContent>
        )}
      </Sheet>
    </div>
  );
};
