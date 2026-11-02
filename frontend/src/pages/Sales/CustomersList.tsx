import { selectByMode } from '@/data/select';
import { CustomersListLive } from './live/CustomersListLive';
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { Contact, Invoice } from '@/types';
import { formatMoney, formatDate } from '@/lib/format';
import { DataTable } from '@/components/domain/DataTable';
import { SplitPane } from '@/components/domain/SplitPane';
import { PageHeader } from '@/components/domain/PageHeader';
import { NameAvatar } from '@/components/domain/NameAvatar';
import { ContactKpiStrip } from './ContactKpiStrip';
import { BUSINESS_TODAY, amountDue } from '@/lib/docStatus';
import { ColumnDef } from '@tanstack/react-table';
import { Building, Plus, Mail, Phone, Receipt, ExternalLink } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { toast } from 'sonner';

const MockCustomersList: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, contacts, invoices, contactBalance, contactOverdueBalance, addContact, openTab, uiDensity } =
    useLedgerStore();
  const coSlug = currentCompany.slug;

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // New Customer Form State
  const [formData, setFormData] = useState({
    name: '',
    code: '',
    email: '',
    phone: '',
    tax_id: '',
    currency: currentCompany.base_currency,
    payment_terms_days: 30,
    credit_limit: 5000000,
  });

  const customers = useMemo(() => {
    return contacts.filter((c) => c.kind === 'customer' || c.kind === 'both');
  }, [contacts]);

  const selectedCustomer = useMemo(() => {
    return customers.find((c) => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  const customerInvoices = useMemo(() => {
    return selectedCustomer
      ? invoices.filter((i: Invoice) => i.contact_id === selectedCustomer.id)
      : [];
  }, [invoices, selectedCustomer]);

  const handleOpenCustomerCard = (customer: Contact) => {
    openTab({
      id: `customer-${customer.id}`,
      title: customer.name,
      url: `/${coSlug}/customers/${customer.id}`,
      type: 'customer',
    });
    navigate(`/${coSlug}/customers/${customer.id}`);
  };

  const handleOpenAddModal = () => {
    setFormData({
      name: '',
      code: `CUST-${String(customers.length + 1).padStart(3, '0')}`,
      email: '',
      phone: '',
      tax_id: '',
      currency: currentCompany.base_currency,
      payment_terms_days: 30,
      credit_limit: 5000000,
    });
    setIsAddModalOpen(true);
  };

  const handleCreateCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Customer name is required');
      return;
    }

    const newContact: Contact = {
      id: `cnt-${Date.now()}`,
      tenant_id: currentCompany.tenant_id || 'ten-mock',
      company_id: currentCompany.id,
      kind: 'customer',
      code: formData.code.trim() || `CUST-${Date.now().toString().slice(-4)}`,
      name: formData.name.trim(),
      legal_name: formData.name.trim(),
      tax_id: formData.tax_id.trim() || undefined,
      email: formData.email.trim() || 'billing@example.com',
      phone: formData.phone.trim() || undefined,
      default_currency: formData.currency,
      payment_terms_days: Number(formData.payment_terms_days) || 30,
      credit_limit: Number(formData.credit_limit) || 0,
      is_active: true,
    };

    addContact(newContact);
    toast.success(`Customer ${newContact.name} created successfully`);
    setIsAddModalOpen(false);
  };

  const lastActivity = useMemo(() => {
    const m = new Map<string, string>();
    for (const inv of invoices as Invoice[]) {
      const prev = m.get(inv.contact_id);
      if (!prev || inv.issue_date > prev) m.set(inv.contact_id, inv.issue_date);
    }
    return m;
  }, [invoices]);

  /** Open receivables per customer, from posted invoices (matches the invoices list). */
  const owedBy = useMemo(() => {
    const m = new Map<string, number>();
    for (const inv of invoices as Invoice[]) {
      if (inv.status !== 'posted') continue;
      m.set(inv.contact_id, (m.get(inv.contact_id) ?? 0) + amountDue(inv));
    }
    return m;
  }, [invoices]);

  const kpis = useMemo(() => {
    let owed = 0;
    let overdue = 0;
    let overdueCount = 0;
    for (const c of customers) {
      owed += owedBy.get(c.id) ?? 0;
      const o = contactOverdueBalance(c.id, BUSINESS_TODAY);
      overdue += o;
      if (o > 0) overdueCount += 1;
    }
    return { owed, overdue, overdueCount, active: customers.filter((c) => c.is_active).length };
  }, [customers, owedBy, contactOverdueBalance, invoices]);

  const columns: ColumnDef<Contact>[] = [
    {
      accessorKey: 'name',
      header: 'Customer',
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
        const o = contactOverdueBalance(row.original.id, BUSINESS_TODAY);
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
        const d = lastActivity.get(row.original.id);
        return <span className="text-text-secondary">{d ? formatDate(d) : '—'}</span>;
      },
    },
    {
      id: 'balance',
      header: () => <div className="text-right">Balance owed</div>,
      cell: ({ row }) => {
        const bal = owedBy.get(row.original.id) ?? 0;
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
        title="Customers"
        subtitle="Who owes you money, and since when"
        actions={
          <button
            type="button"
            onClick={handleOpenAddModal}
            className="inline-flex items-center gap-1.5 h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded-md text-[13px] font-medium transition cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>New customer</span>
            <kbd className="ml-1 text-[10px] bg-white/20 px-1 rounded text-white/90">N</kbd>
          </button>
        }
      />

      <ContactKpiStrip
        items={[
          { label: 'Total owed to you', value: formatMoney(kpis.owed, currentCompany.base_currency), sub: `across ${customers.length} customers`, tone: 'accent' },
          { label: 'Overdue', value: formatMoney(kpis.overdue, currentCompany.base_currency), sub: kpis.overdueCount > 0 ? `${kpis.overdueCount} ${kpis.overdueCount === 1 ? 'customer' : 'customers'} late` : 'Nobody is late', tone: kpis.overdue > 0 ? 'danger' : 'success' },
          { label: 'Active customers', value: kpis.active, sub: 'with an open account', tone: 'success' },
        ]}
      />

      {/* Main SplitPane Layout with Resizable Master-Detail */}
      <SplitPane
        storageKey="ledgerly_customers_split_width"
        isOpen={Boolean(selectedCustomer)}
        onClose={() => setSelectedCustomerId(null)}
        title={selectedCustomer?.name || 'Customer Preview'}
        subtitle={selectedCustomer ? `Code: ${selectedCustomer.code} • ${selectedCustomer.default_currency} Base` : undefined}
        onOpenFull={() => selectedCustomer && handleOpenCustomerCard(selectedCustomer)}
        openFullLabel="Open Card"
        badge={
          selectedCustomer ? (
            <span className="font-mono text-[10px] bg-surface-neutral text-text-secondary px-1.5 py-0.5 rounded-[3px] font-semibold">
              {selectedCustomer.code}
            </span>
          ) : undefined
        }
        detailContent={
          selectedCustomer && (() => {
            const balance = contactBalance(selectedCustomer.id);
            const overdue = contactOverdueBalance(selectedCustomer.id);
            const creditLimit = selectedCustomer.credit_limit || 0;
            const utilizationPct = creditLimit > 0 ? Math.min(Math.round((balance / creditLimit) * 100), 100) : 0;

            return (
              <div className="flex flex-col gap-4 text-xs">
                {/* Financial KPI summary */}
                <div className="grid grid-cols-2 gap-2.5 p-3.5 rounded-lg bg-surface border border-border">
                  <div>
                    <span className="text-xs text-text-muted font-semibold block">Outstanding AR</span>
                    <span className="font-mono font-medium text-text-primary text-lg mt-0.5 block">
                      {formatMoney(balance, selectedCustomer.default_currency)}
                    </span>
                  </div>
                  <div>
                    <span className="text-xs text-text-muted font-semibold block">Overdue</span>
                    <span className={`font-mono font-medium text-lg mt-0.5 block ${overdue > 0 ? 'text-danger' : 'text-success'}`}>
                      {overdue > 0 ? formatMoney(overdue, selectedCustomer.default_currency) : '$0.00'}
                    </span>
                  </div>
                </div>

                {/* Credit Limit Utilization Bar */}
                {creditLimit > 0 && (
                  <div className="p-3 bg-surface border border-border rounded-lg flex flex-col gap-1.5">
                    <div className="flex items-center justify-between text-[11px]">
                      <span className="font-medium text-text-secondary">Credit line used</span>
                      <span className="font-mono font-semibold text-text-primary">
                        {utilizationPct}% <span className="font-normal text-text-muted">of {formatMoney(creditLimit, selectedCustomer.default_currency)}</span>
                      </span>
                    </div>
                    <div className="w-full h-2 bg-surface-neutral rounded-[2px] overflow-hidden">
                      <div
                        className={`h-full rounded-[2px] transition-all duration-150 ${
                          utilizationPct > 85 ? 'bg-danger' : utilizationPct > 60 ? 'bg-warning' : 'bg-success'
                        }`}
                        style={{ width: `${utilizationPct}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Contact info */}
                <div className="p-3.5 bg-surface border border-border rounded-lg flex flex-col gap-2">
                  <span className="text-xs font-medium text-text-muted">
                    Contact & Trade Terms
                  </span>
                  <div className="flex flex-col gap-1.5 text-[11px]">
                    {selectedCustomer.email && (
                      <div className="flex items-center gap-2 text-text-secondary">
                        <Mail className="w-3.5 h-3.5 text-text-muted shrink-0" />
                        <span className="truncate">{selectedCustomer.email}</span>
                      </div>
                    )}
                    {selectedCustomer.phone && (
                      <div className="flex items-center gap-2 text-text-secondary">
                        <Phone className="w-3.5 h-3.5 text-text-muted shrink-0" />
                        <span>{selectedCustomer.phone}</span>
                      </div>
                    )}
                    <div className="text-text-muted font-mono text-[10px] pt-1.5 border-t border-border/60 flex items-center justify-between">
                      <span>Tax PIN: <strong className="text-text-primary font-semibold">{selectedCustomer.tax_id || 'N/A'}</strong></span>
                      <span>Terms: <strong className="text-text-primary font-semibold">{selectedCustomer.payment_terms_days} days</strong></span>
                    </div>
                  </div>
                </div>

                {/* Quick Action Toolbar */}
                <div className="flex flex-col gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => handleOpenCustomerCard(selectedCustomer)}
                    className="w-full h-8.5 bg-accent hover:bg-accent-hover text-white rounded-md font-medium transition flex items-center justify-center gap-1.5 cursor-pointer text-[13px]"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open customer card (Enter)</span>
                  </button>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => navigate(`/${coSlug}/invoices/new?contactId=${selectedCustomer.id}`)}
                      className="h-8 border border-border bg-surface hover:bg-surface-neutral text-text-primary rounded-md font-medium transition flex items-center justify-center gap-1.5 cursor-pointer text-xs"
                    >
                      <Plus className="w-3.5 h-3.5 text-accent" />
                      <span>Create invoice</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => navigate(`/${coSlug}/receipts/new?contactId=${selectedCustomer.id}`)}
                      className="h-8 border border-border bg-surface hover:bg-surface-neutral text-text-primary rounded-md font-medium transition flex items-center justify-center gap-1.5 cursor-pointer text-xs"
                    >
                      <Receipt className="w-3.5 h-3.5 text-accent" />
                      <span>Record receipt</span>
                    </button>
                  </div>
                </div>

                {/* Invoices List */}
                <div className="flex flex-col gap-2 mt-1">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-text-muted">
                      Recent invoices ({customerInvoices.length})
                    </span>
                    {customerInvoices.length > 0 && (
                      <span className="text-[10px] text-text-muted">Click row to open</span>
                    )}
                  </div>
                  <div className="border border-border rounded-lg overflow-hidden bg-surface max-h-56 overflow-y-auto">
                    {customerInvoices.length === 0 ? (
                      <div className="p-5 text-center text-text-muted text-[11px]">
                        No invoices recorded for this customer yet.
                      </div>
                    ) : (
                      <div className="divide-y divide-border/60">
                        {customerInvoices.map((inv) => (
                          <div
                            key={inv.id}
                            onClick={() => navigate(`/${coSlug}/invoices/${inv.id}`)}
                            className="p-2.5 flex items-center justify-between hover:bg-surface-neutral/60 cursor-pointer text-xs transition-colors"
                          >
                            <div className="flex flex-col">
                              <span className="font-mono text-accent font-semibold">{inv.number || 'DRAFT'}</span>
                              <span className="text-[10px] text-text-muted">{formatDate(inv.issue_date)}</span>
                            </div>
                            <div className="text-right">
                              <span className="font-mono font-semibold text-text-primary block">
                                {formatMoney(inv.total, inv.currency)}
                              </span>
                              <span className="text-xs font-mono text-text-muted">
                                {inv.status.replace('_', ' ')}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })()
        }
      >
        <div className="flex-1 overflow-hidden">
          <DataTable
            columns={columns}
            data={customers}
            activeRowId={selectedCustomerId}
            searchPlaceholder="Search customers..."
            rowDensity={uiDensity}
            onRowClick={(row) => setSelectedCustomerId(row.id)}
            onRowDoubleClick={(row) => handleOpenCustomerCard(row)}
            amountAccessor={(row) => contactBalance(row.id)}
          />
        </div>
      </SplitPane>

      {/* New Customer Modal */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-lg p-6 bg-surface border border-border rounded-lg shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary flex items-center gap-2">
              <Building className="w-5 h-5 text-accent" />
              <span>Create customer</span>
            </DialogTitle>
          </DialogHeader>

          <form onSubmit={handleCreateCustomer} className="flex flex-col gap-4 text-xs mt-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-semibold text-text-primary mb-1">
                  Customer Code <span className="text-danger">*</span>
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
                Customer Name <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Hormuud Telecom Inc."
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
                  placeholder="billing@customer.com"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary focus:border-accent outline-hidden"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-text-primary mb-1">Tax ID / PIN</label>
                <input
                  type="text"
                  placeholder="e.g. SOM-TAX-98210"
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
                Save customer
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

/** The demo keeps its store-backed screen; live mode reads the API (docs/15). */
export const CustomersList: React.FC = selectByMode({ mock: MockCustomersList, live: CustomersListLive });
