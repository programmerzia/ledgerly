import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { Contact, Bill } from '@/types';
import { formatMoney, formatDate } from '@/lib/format';
import { DataTable } from '@/components/domain/DataTable';
import { SplitPane } from '@/components/domain/SplitPane';
import { PageHeader } from '@/components/domain/PageHeader';
import { NameAvatar } from '@/components/domain/NameAvatar';
import { ContactKpiStrip } from '@/pages/Sales/ContactKpiStrip';
import { BUSINESS_TODAY, amountDue } from '@/lib/docStatus';
import { ColumnDef } from '@tanstack/react-table';
import { Building, Plus, Mail, Phone, CreditCard, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

export const SuppliersList: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, contacts, bills, contactBalance, addContact, openTab, uiDensity } =
    useLedgerStore();
  const coSlug = currentCompany.slug;

  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    code: '',
    email: '',
    phone: '',
    tax_id: '',
    currency: currentCompany.base_currency,
    payment_terms_days: 30,
  });

  const suppliers = useMemo(() => {
    return contacts.filter((c) => c.kind === 'supplier' || c.kind === 'both');
  }, [contacts]);

  const selectedSupplier = useMemo(() => {
    return suppliers.find((s) => s.id === selectedSupplierId) || null;
  }, [suppliers, selectedSupplierId]);

  const supplierBills = useMemo(() => {
    return selectedSupplier
      ? bills.filter((b: Bill) => b.contact_id === selectedSupplier.id)
      : [];
  }, [bills, selectedSupplier]);

  const handleOpenSupplierCard = (supplier: Contact) => {
    openTab({
      id: `supplier-${supplier.id}`,
      title: supplier.name,
      url: `/${coSlug}/suppliers/${supplier.id}`,
      type: 'supplier',
    });
    navigate(`/${coSlug}/suppliers/${supplier.id}`);
  };

  const handleOpenAddModal = () => {
    setFormData({
      name: '',
      code: `SUPP-${String(suppliers.length + 1).padStart(3, '0')}`,
      email: '',
      phone: '',
      tax_id: '',
      currency: currentCompany.base_currency,
      payment_terms_days: 30,
    });
    setIsAddModalOpen(true);
  };

  const handleCreateSupplier = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Supplier name is required');
      return;
    }

    const newContact: Contact = {
      id: `cnt-${Date.now()}`,
      tenant_id: currentCompany.tenant_id || 'ten-mock',
      company_id: currentCompany.id,
      kind: 'supplier',
      code: formData.code.trim() || `SUPP-${Date.now().toString().slice(-4)}`,
      name: formData.name.trim(),
      legal_name: formData.name.trim(),
      tax_id: formData.tax_id.trim() || undefined,
      email: formData.email.trim() || 'finance@supplier.com',
      phone: formData.phone.trim() || undefined,
      default_currency: formData.currency,
      payment_terms_days: Number(formData.payment_terms_days) || 30,
      is_active: true,
    };

    addContact(newContact);
    toast.success(`Supplier ${newContact.name} created successfully`);
    setIsAddModalOpen(false);
  };

  const supplierStats = useMemo(() => {
    const m = new Map<string, { overdue: number; owed: number; last?: string }>();
    for (const b of bills as Bill[]) {
      const e = m.get(b.contact_id) ?? { overdue: 0, owed: 0 };
      if (b.status === 'posted') e.owed += amountDue(b);
      if (!e.last || b.issue_date > e.last) e.last = b.issue_date;
      if (b.status === 'posted' && b.due_date < BUSINESS_TODAY && b.settled < b.total) e.overdue += b.total - b.settled;
      m.set(b.contact_id, e);
    }
    return m;
  }, [bills]);

  const kpis = useMemo(() => {
    let owed = 0;
    let overdue = 0;
    let overdueCount = 0;
    for (const s of suppliers) {
      owed += supplierStats.get(s.id)?.owed ?? 0;
      const o = supplierStats.get(s.id)?.overdue ?? 0;
      overdue += o;
      if (o > 0) overdueCount += 1;
    }
    return { owed, overdue, overdueCount, active: suppliers.filter((s) => s.is_active).length };
  }, [suppliers, supplierStats]);

  const columns: ColumnDef<Contact>[] = [
    {
      accessorKey: 'name',
      header: 'Supplier',
      cell: ({ row }) => (
        <div className="flex items-center gap-3 min-w-0">
          <NameAvatar name={row.original.name} />
          <div className="flex flex-col min-w-0 leading-tight">
            <span className="font-medium text-text-primary truncate">{row.original.name}</span>
            <span className="text-xs text-text-muted truncate">{row.original.email}</span>
          </div>
        </div>
      ),
    },
    {
      accessorKey: 'payment_terms_days',
      header: 'Terms',
      cell: ({ row }) => <span className="text-text-secondary">Net {row.original.payment_terms_days}</span>,
    },
    {
      id: 'overdue',
      header: 'Overdue',
      cell: ({ row }) => {
        const o = supplierStats.get(row.original.id)?.overdue ?? 0;
        return o > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-[3px] bg-danger-soft px-2 py-0.5 text-xs font-medium text-danger tabular-nums">
            <span className="size-1.5 rounded-full bg-danger" />
            {formatMoney(o, row.original.default_currency)}
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        );
      },
    },
    {
      id: 'last_activity',
      header: 'Last activity',
      cell: ({ row }) => {
        const d = supplierStats.get(row.original.id)?.last;
        return <span className="text-text-secondary">{d ? formatDate(d) : '—'}</span>;
      },
    },
    {
      id: 'balance',
      header: () => <div className="text-right">Balance you owe</div>,
      cell: ({ row }) => {
        const bal = supplierStats.get(row.original.id)?.owed ?? 0;
        return (
          <div className="text-right font-semibold tabular-nums text-text-primary">
            {formatMoney(bal, row.original.default_currency)}
          </div>
        );
      },
    },
  ];

  return (
    <div className="flex flex-col h-full gap-4">
      <PageHeader
        title="Suppliers"
        subtitle="Who you owe money to, and when it's due"
        actions={
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="inline-flex items-center gap-1.5 h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded-md text-[13px] font-medium transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New supplier</span>
            <kbd className="ml-1 text-[10px] bg-white/20 px-1 rounded text-white/90">N</kbd>
          </button>
        }
      />

      <ContactKpiStrip
        items={[
          { label: 'Total you owe', value: formatMoney(kpis.owed, currentCompany.base_currency), sub: `across ${suppliers.length} suppliers`, tone: 'accent' },
          { label: 'Overdue', value: formatMoney(kpis.overdue, currentCompany.base_currency), sub: kpis.overdueCount > 0 ? `${kpis.overdueCount} ${kpis.overdueCount === 1 ? 'supplier' : 'suppliers'} waiting` : 'Nothing overdue', tone: kpis.overdue > 0 ? 'danger' : 'success' },
          { label: 'Active suppliers', value: kpis.active, sub: 'with an open account', tone: 'success' },
        ]}
      />

      {/* Main SplitPane Layout */}
      <SplitPane
        storageKey="ledgerly_suppliers_split_width"
        isOpen={Boolean(selectedSupplier)}
        onClose={() => setSelectedSupplierId(null)}
        title={selectedSupplier?.name || 'Supplier Preview'}
        subtitle={selectedSupplier ? `Code: ${selectedSupplier.code} • ${selectedSupplier.default_currency} Base` : undefined}
        onOpenFull={() => selectedSupplier && handleOpenSupplierCard(selectedSupplier)}
        openFullLabel="Open Card"
        badge={
          selectedSupplier ? (
            <span className="font-mono text-[10px] bg-surface-neutral text-text-secondary px-1.5 py-0.5 rounded-[3px] font-semibold">
              {selectedSupplier.code}
            </span>
          ) : undefined
        }
        detailContent={
          selectedSupplier && (
            <div className="flex flex-col gap-4 text-xs">
              {/* Financial KPI */}
              <div className="p-3 bg-surface border border-border rounded-md">
                <span className="text-xs text-text-muted block">Total open payable</span>
                <span className="font-mono font-semibold text-text-primary text-base mt-0.5 block">
                  {formatMoney(contactBalance(selectedSupplier.id), selectedSupplier.default_currency)}
                </span>
              </div>

              {/* Contact info */}
              <div className="p-3 bg-surface border border-border rounded-md flex flex-col gap-2">
                <span className="text-xs font-medium text-text-muted">
                  Contact & Terms
                </span>
                <div className="flex flex-col gap-1 text-[11px]">
                  {selectedSupplier.email && (
                    <div className="flex items-center gap-1.5 text-text-secondary">
                      <Mail className="w-3.5 h-3.5 text-text-muted" />
                      <span>{selectedSupplier.email}</span>
                    </div>
                  )}
                  {selectedSupplier.phone && (
                    <div className="flex items-center gap-1.5 text-text-secondary">
                      <Phone className="w-3.5 h-3.5 text-text-muted" />
                      <span>{selectedSupplier.phone}</span>
                    </div>
                  )}
                  <div className="text-text-muted font-mono mt-1">
                    Tax PIN: {selectedSupplier.tax_id || 'N/A'} • Terms: {selectedSupplier.payment_terms_days} days
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => handleOpenSupplierCard(selectedSupplier)}
                  className="w-full h-8 bg-accent hover:bg-accent-hover text-white rounded-md font-medium transition flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open supplier card (Enter)</span>
                </button>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => navigate(`/${coSlug}/bills/new?contactId=${selectedSupplier.id}`)}
                    className="h-8 border border-border bg-surface hover:bg-surface-neutral text-text-primary rounded-sm font-medium transition flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Record bill</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/${coSlug}/payment-run`)}
                    className="h-8 border border-border bg-surface hover:bg-surface-neutral text-text-primary rounded-sm font-medium transition flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <CreditCard className="w-3.5 h-3.5" />
                    <span>Disburse</span>
                  </button>
                </div>
              </div>

              {/* Bills List */}
              <div className="flex flex-col gap-2 mt-2">
                <span className="text-xs font-semibold text-text-muted">
                  Recent bills ({supplierBills.length})
                </span>
                <div className="border border-border rounded-md overflow-hidden bg-surface max-h-48 overflow-y-auto">
                  {supplierBills.length === 0 ? (
                    <div className="p-4 text-center text-text-muted text-[11px]">No purchase bills recorded yet</div>
                  ) : (
                    <div className="divide-y divide-border/60">
                      {supplierBills.map((b) => (
                        <div
                          key={b.id}
                          onClick={() => navigate(`/${coSlug}/bills/${b.id}`)}
                          className="p-2 flex items-center justify-between hover:bg-surface-neutral/60 cursor-pointer text-xs"
                        >
                          <div>
                            <span className="font-mono text-accent font-semibold">{b.number || b.reference}</span>
                            <span className="text-[10px] text-text-muted ml-2">{formatDate(b.issue_date)}</span>
                          </div>
                          <span className="font-mono font-semibold text-text-primary">
                            {formatMoney(b.total, b.currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        }
      >
        <div className="flex-1 overflow-hidden">
          <DataTable
            columns={columns}
            data={suppliers}
            activeRowId={selectedSupplierId}
            searchPlaceholder="Search suppliers..."
            rowDensity={uiDensity}
            onRowClick={(row) => setSelectedSupplierId(row.id)}
            onRowDoubleClick={(row) => handleOpenSupplierCard(row)}
            amountAccessor={(row) => contactBalance(row.id)}
          />
        </div>
      </SplitPane>

      {/* New Supplier Modal */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-lg p-6 bg-surface border border-border rounded-lg shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary flex items-center gap-2">
              <Building className="w-5 h-5 text-accent" />
              <span>Create supplier</span>
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateSupplier} className="flex flex-col gap-4 text-xs mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-text-primary mb-1">
                  Supplier Code <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  className="w-full h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary font-mono focus:border-accent outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-text-primary mb-1">
                  Currency <span className="text-danger">*</span>
                </label>
                <select
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                  className="w-full h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary focus:border-accent outline-hidden"
                >
                  <option value="USD">USD - US Dollar</option>
                  <option value="KES">KES - Kenyan Shilling</option>
                  <option value="SOS">SOS - Somali Shilling</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-semibold text-text-primary mb-1">
                Supplier Name <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Dahabshiil Telecom"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                className="w-full h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary focus:border-accent outline-hidden"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-text-primary mb-1">Email address</label>
                <input
                  type="email"
                  placeholder="accounts@supplier.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary focus:border-accent outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-text-primary mb-1">Tax ID / PIN</label>
                <input
                  type="text"
                  placeholder="e.g. SOM-TAX-77412"
                  value={formData.tax_id}
                  onChange={(e) => setFormData({ ...formData, tax_id: e.target.value })}
                  className="w-full h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary font-mono focus:border-accent outline-hidden"
                />
              </div>
            </div>

            <DialogFooter className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="h-8 px-3 rounded-sm border border-border bg-surface text-text-primary text-xs hover:bg-surface-neutral cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium cursor-pointer"
              >
                Save supplier
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
