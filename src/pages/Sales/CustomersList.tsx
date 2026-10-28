import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { Contact, Invoice } from '@/types';
import { formatMoney, formatDate } from '@/lib/format';
import { StatusPill } from '@/components/domain/StatusPill';
import {
  Building,
  Plus,
  Mail,
  Phone,
  ShieldCheck,
  FileSpreadsheet,
  Receipt,
  ExternalLink,
  Search,
  DollarSign,
  Calendar,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { toast } from 'sonner';

export const CustomersList: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, contacts, invoices, contactBalance, contactOverdueBalance, addContact } =
    useLedgerStore();
  const coSlug = currentCompany.slug;

  const [searchQuery, setSearchQuery] = useState('');
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
    credit_limit: 5000000, // $50,000.00
  });

  const customers = contacts.filter((c) => c.kind === 'customer' || c.kind === 'both');

  const filteredCustomers = customers.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.tax_id || '').toLowerCase().includes(q)
    );
  });

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId) || null;

  // Invoices for selected customer
  const customerInvoices = selectedCustomer
    ? invoices.filter((i: Invoice) => i.contact_id === selectedCustomer.id)
    : [];

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
      tenant_id: 'tenant-default',
      company_id: currentCompany.id,
      kind: 'customer',
      name: formData.name.trim(),
      code: formData.code.trim() || `CUST-${Date.now()}`,
      email: formData.email.trim() || 'info@customer.com',
      phone: formData.phone.trim() || undefined,
      tax_id: formData.tax_id.trim() || undefined,
      default_currency: formData.currency,
      payment_terms_days: Number(formData.payment_terms_days) || 30,
      credit_limit: Number(formData.credit_limit) || undefined,
      is_active: true,
    };

    addContact(newContact);
    toast.success(`Customer ${newContact.name} created successfully`);
    setIsAddModalOpen(false);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Page Header */}
      <div className="flex items-center justify-between pb-2 border-b border-border">
        <div>
          <h1 className="text-xl font-semibold text-text-primary flex items-center gap-2">
            <Building className="w-5 h-5 text-accent" />
            Customers & Debtors
          </h1>
          <p className="text-xs text-text-muted mt-0.5">
            Accounts receivable counterparties • Credit limits, aging & statement tracking
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search customers..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-3 text-xs rounded-sm border border-border bg-surface hover:border-border-strong focus:outline-none focus:border-accent w-56 text-text-primary placeholder:text-text-muted"
            />
          </div>

          <button
            type="button"
            onClick={handleOpenAddModal}
            className="flex items-center gap-1.5 h-8 px-3.5 bg-accent hover:bg-accent-hover text-white rounded-sm text-xs font-semibold shadow-xs transition"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Customer</span>
          </button>
        </div>
      </div>

      {/* Customers Data Table */}
      <div className="bg-surface border border-border rounded-md overflow-hidden">
        <table className="w-full border-collapse table-dense text-left text-xs">
          <thead>
            <tr className="bg-surface-neutral border-b border-border text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              <th className="w-28 px-3 py-2">Code</th>
              <th className="px-3 py-2">Customer Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="w-28 px-3 py-2">Payment Terms</th>
              <th className="w-32 px-3 py-2 text-right">Credit Limit</th>
              <th className="w-32 px-3 py-2 text-right">Overdue</th>
              <th className="w-36 px-3 py-2 text-right pr-4">Total Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {filteredCustomers.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-8 text-center text-text-muted">
                  No customers found.
                </td>
              </tr>
            ) : (
              filteredCustomers.map((c) => {
                const overdue = contactOverdueBalance(c.id);
                const balance = contactBalance(c.id);

                return (
                  <tr
                    key={c.id}
                    onClick={() => setSelectedCustomerId(c.id)}
                    className="hover:bg-surface-neutral/60 cursor-pointer transition-colors"
                  >
                    <td className="px-3 py-2 font-mono font-medium text-accent">{c.code}</td>
                    <td className="px-3 py-2 font-medium text-text-primary">{c.name}</td>
                    <td className="px-3 py-2 text-text-secondary">{c.email || '—'}</td>
                    <td className="px-3 py-2 font-mono text-text-secondary">{c.payment_terms_days} days</td>
                    <td className="px-3 py-2 text-right font-mono text-text-muted">
                      {c.credit_limit ? formatMoney(c.credit_limit, c.default_currency) : 'Unlimited'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-danger font-semibold">
                      {overdue > 0 ? formatMoney(overdue, c.default_currency) : '—'}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-text-primary pr-4">
                      {formatMoney(balance, c.default_currency)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Customer Quick Detail Drawer */}
      <Sheet open={Boolean(selectedCustomer)} onOpenChange={(open) => !open && setSelectedCustomerId(null)}>
        {selectedCustomer && (
          <SheetContent className="w-full sm:max-w-xl overflow-y-auto flex flex-col justify-between">
            <div className="flex flex-col gap-5">
              <SheetHeader className="border-b border-border pb-4">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-accent bg-accent-soft px-2 py-0.5 rounded">
                    {selectedCustomer.code}
                  </span>
                  <span className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                    Customer Profile
                  </span>
                </div>
                <SheetTitle className="text-xl font-bold text-text-primary mt-1">
                  {selectedCustomer.name}
                </SheetTitle>
                <SheetDescription className="text-xs text-text-muted flex items-center gap-4 mt-1">
                  {selectedCustomer.email && (
                    <span className="flex items-center gap-1">
                      <Mail className="w-3 h-3" />
                      {selectedCustomer.email}
                    </span>
                  )}
                  {selectedCustomer.phone && (
                    <span className="flex items-center gap-1">
                      <Phone className="w-3 h-3" />
                      {selectedCustomer.phone}
                    </span>
                  )}
                  {selectedCustomer.tax_id && (
                    <span className="font-mono">PIN: {selectedCustomer.tax_id}</span>
                  )}
                </SheetDescription>
              </SheetHeader>

              {/* Financial Summary */}
              <div className="grid grid-cols-3 gap-2.5 p-3 rounded-md bg-surface-neutral/60 border border-border text-xs">
                <div>
                  <span className="text-[10px] text-text-muted uppercase tracking-wider block">Outstanding AR</span>
                  <span className="font-mono font-bold text-text-primary text-sm mt-0.5 block">
                    {formatMoney(contactBalance(selectedCustomer.id), selectedCustomer.default_currency)}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-text-muted uppercase tracking-wider block">Overdue</span>
                  <span className="font-mono font-bold text-danger text-sm mt-0.5 block">
                    {contactOverdueBalance(selectedCustomer.id) > 0
                      ? formatMoney(contactOverdueBalance(selectedCustomer.id), selectedCustomer.default_currency)
                      : '—'}
                  </span>
                </div>
                <div>
                  <span className="text-[10px] text-text-muted uppercase tracking-wider block">Credit Limit</span>
                  <span className="font-mono font-semibold text-text-secondary text-sm mt-0.5 block">
                    {selectedCustomer.credit_limit
                      ? formatMoney(selectedCustomer.credit_limit, selectedCustomer.default_currency)
                      : 'Unlimited'}
                  </span>
                </div>
              </div>

              {/* Recent Invoices */}
              <div className="flex flex-col gap-2">
                <span className="text-xs font-semibold text-text-primary flex items-center justify-between">
                  <span>Invoices & Billing History ({customerInvoices.length})</span>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedCustomerId(null);
                      navigate(`/${coSlug}/invoices/new?contactId=${selectedCustomer.id}`);
                    }}
                    className="text-[11px] text-accent hover:underline flex items-center gap-1 font-medium"
                  >
                    <Plus className="w-3 h-3" />
                    Create Invoice
                  </button>
                </span>

                <div className="border border-border rounded-md overflow-hidden bg-surface">
                  <table className="w-full text-left text-xs table-dense">
                    <thead className="bg-surface-neutral border-b border-border text-[11px] font-semibold text-text-muted uppercase">
                      <tr>
                        <th className="px-2.5 py-1.5">Invoice #</th>
                        <th className="px-2 py-1.5">Date</th>
                        <th className="px-2 py-1.5">Status</th>
                        <th className="px-2.5 py-1.5 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {customerInvoices.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-text-muted">
                            No invoices recorded for this customer yet.
                          </td>
                        </tr>
                      ) : (
                        customerInvoices.map((inv) => (
                          <tr
                            key={inv.id}
                            onClick={() => {
                              setSelectedCustomerId(null);
                              navigate(`/${coSlug}/invoices/${inv.id}`);
                            }}
                            className="hover:bg-surface-neutral/40 cursor-pointer"
                          >
                            <td className="px-2.5 py-1.5 font-mono text-accent font-medium">
                              {inv.number || 'DRAFT'}
                            </td>
                            <td className="px-2 py-1.5 text-text-secondary">
                              {formatDate(inv.issue_date)}
                            </td>
                            <td className="px-2 py-1.5">
                              <StatusPill status={inv.status} />
                            </td>
                            <td className="px-2.5 py-1.5 text-right font-mono font-medium text-text-primary">
                              {formatMoney(inv.total, inv.currency)}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            <SheetFooter className="mt-6 flex items-center justify-between sm:justify-between w-full">
              <button
                type="button"
                onClick={() => setSelectedCustomerId(null)}
                className="h-8 px-3 rounded-sm border border-border text-text-muted hover:text-text-primary text-xs font-medium hover:bg-surface-neutral transition"
              >
                Close
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const custId = selectedCustomer.id;
                    setSelectedCustomerId(null);
                    navigate(`/${coSlug}/receipts/new?contactId=${custId}`);
                  }}
                  className="flex items-center gap-1.5 h-8 px-3 bg-surface border border-border hover:bg-surface-neutral text-text-primary rounded-sm text-xs font-semibold transition"
                >
                  <Receipt className="w-3.5 h-3.5 text-accent" />
                  <span>Receive Money</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const custId = selectedCustomer.id;
                    setSelectedCustomerId(null);
                    navigate(`/${coSlug}/invoices/new?contactId=${custId}`);
                  }}
                  className="flex items-center gap-1.5 h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded-sm text-xs font-semibold shadow-xs transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>New Invoice</span>
                </button>
              </div>
            </SheetFooter>
          </SheetContent>
        )}
      </Sheet>

      {/* New Customer Dialog */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-[480px] p-5">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary flex items-center gap-2">
              <Building className="w-4 h-4 text-accent" />
              Add New Customer
            </DialogTitle>
            <DialogDescription className="text-xs text-text-muted">
              Add a customer counterparty to the accounts receivable subledger.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateCustomer} className="flex flex-col gap-3 py-2 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">
                  Customer Code <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="e.g. CUST-005"
                  className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary font-mono focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">
                  Billing Currency
                </label>
                <select
                  value={formData.currency}
                  onChange={(e) => setFormData({ ...formData, currency: e.target.value })}
                  className="h-8 px-2 rounded-sm border border-border bg-surface text-text-primary font-mono focus:outline-none focus:border-accent"
                >
                  <option value="USD">USD — US Dollar</option>
                  <option value="SOS">SOS — Somali Shilling</option>
                  <option value="KES">KES — Kenyan Shilling</option>
                  <option value="EUR">EUR — Euro</option>
                  <option value="GBP">GBP — British Pound</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-medium text-text-secondary">
                Company / Customer Name <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Mogadishu Port Logistics"
                className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary focus:outline-none focus:border-accent"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">Email Address</label>
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="billing@customer.com"
                  className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">Phone Number</label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+252 61 555 1234"
                  className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">Tax ID / PIN</label>
                <input
                  type="text"
                  value={formData.tax_id}
                  onChange={(e) => setFormData({ ...formData, tax_id: e.target.value })}
                  placeholder="P051234567Z"
                  className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary font-mono focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">Terms (Days)</label>
                <input
                  type="number"
                  min="0"
                  max="180"
                  value={formData.payment_terms_days}
                  onChange={(e) => setFormData({ ...formData, payment_terms_days: Number(e.target.value) })}
                  className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary font-mono focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">Credit Limit ($)</label>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  value={formData.credit_limit / 100}
                  onChange={(e) => setFormData({ ...formData, credit_limit: Number(e.target.value) * 100 })}
                  className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary font-mono text-right focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <DialogFooter className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddModalOpen(false)}
                className="h-8 px-3 rounded-sm border border-border text-text-muted hover:text-text-primary text-xs font-medium hover:bg-surface-neutral transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-8 px-3.5 bg-accent hover:bg-accent-hover text-white rounded-sm text-xs font-semibold shadow-xs transition"
              >
                Create Customer
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
