import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { Contact } from '@/types';
import { formatMoney } from '@/lib/format';
import { SplitPane } from '@/components/domain/SplitPane';
import {
  Building,
  Plus,
  Search,
  FileText,
  CreditCard,
  ExternalLink,
  Mail,
  Phone,
  Coins,
  ArrowRight,
  Printer,
  Calendar,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

export const SuppliersList: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, contacts, bills, settlements, contactBalance, addContact } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [searchQuery, setSearchQuery] = useState('');
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
    return contacts.filter((c) => c.kind === 'supplier');
  }, [contacts]);

  const filteredSuppliers = useMemo(() => {
    if (!searchQuery) return suppliers;
    const q = searchQuery.toLowerCase();
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.tax_id || '').toLowerCase().includes(q)
    );
  }, [suppliers, searchQuery]);

  const selectedSupplier = useMemo(() => {
    return suppliers.find((s) => s.id === selectedSupplierId) || null;
  }, [suppliers, selectedSupplierId]);

  // Supplier's bills
  const supplierBills = useMemo(() => {
    if (!selectedSupplier) return [];
    return bills.filter((b) => b.contact_id === selectedSupplier.id);
  }, [bills, selectedSupplier]);

  // Supplier's settlements
  const supplierPayments = useMemo(() => {
    if (!selectedSupplier) return [];
    return settlements.filter((s) => s.contact_id === selectedSupplier.id);
  }, [settlements, selectedSupplier]);

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
      id: `cnt-supp-${Date.now()}`,
      tenant_id: 'tenant-default',
      company_id: currentCompany.id,
      kind: 'supplier',
      name: formData.name.trim(),
      code: formData.code.trim() || `SUPP-${Date.now()}`,
      email: formData.email.trim() || 'billing@supplier.com',
      phone: formData.phone.trim() || undefined,
      tax_id: formData.tax_id.trim() || undefined,
      default_currency: formData.currency,
      payment_terms_days: Number(formData.payment_terms_days) || 30,
      is_active: true,
    };
    addContact(newContact);
    toast.success(`Supplier ${newContact.name} added successfully`);
    setIsAddModalOpen(false);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-surface-canvas">
      {/* Top Header */}
      <div className="h-12 border-b border-line-border px-4 flex items-center justify-between shrink-0 bg-surface-elevated">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Building className="w-4 h-4 text-accent" />
            <h1 className="text-sm font-bold text-text-primary">Suppliers Register</h1>
            <span className="text-[11px] text-text-muted">Vendors, Contractors & AP Accounts</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-text-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search suppliers by name, code..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-3 text-xs rounded-sm border border-border bg-surface hover:border-border-strong focus:outline-none focus:border-accent w-60 text-text-primary"
            />
          </div>

          <button
            type="button"
            onClick={handleOpenAddModal}
            className="flex items-center gap-1.5 h-8 px-3 rounded-sm border border-border hover:border-border-strong bg-surface text-text-primary text-xs font-semibold hover:bg-surface-neutral transition"
          >
            <Plus className="w-3.5 h-3.5 text-accent" />
            <span>New Supplier</span>
          </button>

          <button
            type="button"
            onClick={() => navigate(`/${coSlug}/bills/new`)}
            className="flex items-center gap-1.5 h-8 px-3 rounded-sm bg-accent text-white text-xs font-semibold hover:bg-accent-hover transition shadow-2xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Record Bill from Supplier</span>
          </button>
        </div>
      </div>

      {/* SplitPane view */}
      <SplitPane
        storageKey="ledgerly_suppliers_split_width"
        isOpen={Boolean(selectedSupplier)}
        onClose={() => setSelectedSupplierId(null)}
        title={selectedSupplier?.name}
        badge={
          selectedSupplier && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-neutral font-semibold text-ink-muted">
              {selectedSupplier.code}
            </span>
          )
        }
        detailContent={
          selectedSupplier && (
            <div className="flex flex-col gap-4 text-xs">
              {/* AP Balance summary */}
              <div className="p-3 bg-surface-subtle border border-line-border rounded-sm flex items-center justify-between">
                <div>
                  <span className="text-[10px] uppercase font-bold text-ink-muted block">
                    Outstanding AP Balance
                  </span>
                  <span className="text-lg font-bold font-mono text-num text-danger">
                    {formatMoney(contactBalance(selectedSupplier.id))}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] text-ink-muted block">Currency</span>
                  <span className="font-mono text-xs font-semibold text-ink-900">
                    {selectedSupplier.default_currency}
                  </span>
                </div>
              </div>

              {/* Vendor details */}
              <div className="p-3 bg-surface-neutral border border-line-border rounded-sm flex flex-col gap-1.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-ink-muted">Tax / VAT ID:</span>
                  <span className="font-mono text-ink-900 font-medium">
                    {selectedSupplier.tax_id || 'SO-VAT-EXEMPT'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-muted">Payment Terms:</span>
                  <span className="font-medium text-ink-900">
                    Net {selectedSupplier.payment_terms_days} Days
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-muted">Phone:</span>
                  <span className="font-medium text-ink-900">
                    {selectedSupplier.phone || '+252 61 5000000'}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-ink-muted">Email:</span>
                  <span className="font-mono text-ink-900">{selectedSupplier.email}</span>
                </div>
              </div>

              {/* Recent Bills */}
              <div className="flex flex-col gap-1.5">
                <span className="font-semibold text-ink-900 uppercase tracking-wide text-[10px] flex items-center justify-between">
                  <span>Recent Bills ({supplierBills.length})</span>
                  <button
                    type="button"
                    onClick={() => navigate(`/${coSlug}/bills`)}
                    className="text-brand-teal hover:underline font-normal text-[10px]"
                  >
                    View All
                  </button>
                </span>
                <div className="border border-line-border rounded-sm divide-y divide-line-border overflow-hidden">
                  {supplierBills.length === 0 ? (
                    <div className="p-3 text-center text-ink-muted text-[11px]">No bills recorded</div>
                  ) : (
                    supplierBills.slice(0, 4).map((bill) => (
                      <div key={bill.id} className="p-2 flex items-center justify-between bg-surface-subtle text-[11px]">
                        <div className="flex flex-col">
                          <span className="font-mono font-medium text-ink-900">{bill.number || 'DRAFT'}</span>
                          <span className="text-[10px] text-ink-muted font-mono">{bill.issue_date}</span>
                        </div>
                        <div className="flex flex-col text-right">
                          <span className="font-mono text-num font-semibold text-ink-900">
                            {formatMoney(bill.total)}
                          </span>
                          <span className="text-[10px] text-danger font-mono font-medium">
                            Due {bill.due_date}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Quick Actions */}
              <div className="pt-2 border-t border-line-border flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => navigate(`/${coSlug}/payment-run`)}
                  className="w-full h-8 bg-brand-teal text-white rounded-sm font-semibold hover:bg-brand-teal-hover transition flex items-center justify-center gap-1.5 shadow-2xs"
                >
                  <Coins className="w-3.5 h-3.5" />
                  <span>Schedule Payment in Payment Run</span>
                </button>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="w-full h-8 border border-line-border bg-surface-subtle hover:bg-surface-neutral text-ink-900 rounded-sm font-medium transition flex items-center justify-center gap-1.5"
                >
                  <Printer className="w-3.5 h-3.5 text-ink-muted" />
                  <span>Print Supplier Statement</span>
                </button>
              </div>
            </div>
          )
        }
      >
        {/* Table Content */}
        <div className="p-4 flex flex-col gap-3">
          <div className="border border-line-border rounded-md overflow-hidden bg-surface-elevated shadow-2xs">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="h-9 bg-surface-neutral border-b border-line-border text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                  <th className="px-3">Code</th>
                  <th className="px-3">Supplier Name</th>
                  <th className="px-3">Currency</th>
                  <th className="px-3">Tax ID</th>
                  <th className="px-3">Terms</th>
                  <th className="px-3 text-right">AP Balance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-border">
                {filteredSuppliers.map((supplier) => {
                  const isSelected = selectedSupplierId === supplier.id;
                  const balance = contactBalance(supplier.id);

                  return (
                    <tr
                      key={supplier.id}
                      onClick={() => setSelectedSupplierId(supplier.id)}
                      className={`h-9 cursor-pointer transition select-none ${
                        isSelected ? 'bg-brand-teal/10 font-medium' : 'hover:bg-surface-neutral'
                      }`}
                    >
                      <td className="px-3 font-mono font-medium text-brand-teal">
                        {supplier.code}
                      </td>
                      <td className="px-3 font-medium text-ink-900">
                        {supplier.name}
                      </td>
                      <td className="px-3 font-mono text-[11px] text-ink-muted">
                        {supplier.default_currency}
                      </td>
                      <td className="px-3 font-mono text-[11px] text-ink-muted">
                        {supplier.tax_id || '—'}
                      </td>
                      <td className="px-3 text-[11px] text-ink-muted">
                        Net {supplier.payment_terms_days}d
                      </td>
                      <td className="px-3 text-right font-mono text-num font-semibold">
                        <span className={balance > 0 ? 'text-danger' : 'text-ink-muted'}>
                          {formatMoney(balance)}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-[11px] text-text-muted px-1">
            <span>Showing {filteredSuppliers.length} suppliers</span>
            <span>Balances dynamically reduced over posted AP journal lines</span>
          </div>
        </div>
      </SplitPane>

      {/* New Supplier Dialog Modal */}
      <Dialog open={isAddModalOpen} onOpenChange={setIsAddModalOpen}>
        <DialogContent className="max-w-[480px] p-5">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary flex items-center gap-2">
              <Building className="w-4 h-4 text-accent" />
              Add New Supplier
            </DialogTitle>
            <DialogDescription className="text-xs text-text-muted">
              Register a vendor or contractor counterparty in the accounts payable subledger.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateSupplier} className="flex flex-col gap-3 py-2 text-xs">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">
                  Supplier Code <span className="text-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={formData.code}
                  onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                  placeholder="e.g. SUPP-005"
                  className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary font-mono focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">
                  Currency
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
                Company / Vendor Name <span className="text-danger">*</span>
              </label>
              <input
                type="text"
                required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. Somali Petroleum Ltd"
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
                  placeholder="accounts@supplier.com"
                  className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">Phone Number</label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  placeholder="+252 61 777 9999"
                  className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">Tax ID / PIN</label>
                <input
                  type="text"
                  value={formData.tax_id}
                  onChange={(e) => setFormData({ ...formData, tax_id: e.target.value })}
                  placeholder="A012938475B"
                  className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary font-mono focus:outline-none focus:border-accent"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[11px] font-medium text-text-secondary">Payment Terms (Days)</label>
                <input
                  type="number"
                  min="0"
                  max="180"
                  value={formData.payment_terms_days}
                  onChange={(e) => setFormData({ ...formData, payment_terms_days: Number(e.target.value) })}
                  className="h-8 px-2.5 rounded-sm border border-border bg-surface text-text-primary font-mono focus:outline-none focus:border-accent"
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
                Create Supplier
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
