import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { Bill } from '@/types';
import { StatusPill } from '@/components/domain/StatusPill';
import { formatMoney } from '@/lib/format';
import { SplitPane } from '@/components/domain/SplitPane';
import { SignDialog } from '@/components/domain/SignDialog';
import {
  Plus,
  Search,
  FileText,
  Filter,
  ArrowRight,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Building,
  Calendar,
  Layers,
  Coins,
} from 'lucide-react';

export const BillsList: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, currentUser, companySettings, bills, contacts, approveBill, openTab } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [selectedStatus, setSelectedStatus] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [actionError, setActionError] = useState('');

  // Suppliers map
  const suppliersMap = useMemo(() => {
    return new Map(contacts.map((c) => [c.id, c]));
  }, [contacts]);

  // Filtered bills
  const filteredBills = useMemo(() => {
    return bills.filter((b) => {
      if (selectedStatus !== 'all' && b.status !== selectedStatus) return false;
      if (!searchQuery) return true;
      const q = searchQuery.toLowerCase();
      const supplierName = suppliersMap.get(b.contact_id)?.name?.toLowerCase() || '';
      return (
        (b.number || '').toLowerCase().includes(q) ||
        b.reference.toLowerCase().includes(q) ||
        supplierName.includes(q)
      );
    });
  }, [bills, selectedStatus, searchQuery, suppliersMap]);

  const selectedBill = useMemo(() => {
    return bills.find((b) => b.id === selectedBillId) || null;
  }, [bills, selectedBillId]);

  const handleRowClick = (bill: Bill) => {
    setSelectedBillId(bill.id);
  };

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

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-surface-canvas">
      {/* Top Action Bar */}
      <div className="h-12 border-b border-line-border px-4 flex items-center justify-between shrink-0 bg-surface-elevated">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-brand-teal" />
            <h1 className="text-sm font-bold text-ink-900">Purchase Bills</h1>
            <span className="text-[11px] text-ink-muted">Supplier Invoices & AP Control</span>
          </div>
          <span className="text-line-border">|</span>
          {/* Status Tabs */}
          <div className="flex items-center gap-1">
            {[
              { id: 'all', label: 'All Bills' },
              { id: 'draft', label: 'Draft' },
              { id: 'pending_approval', label: 'Pending Approval' },
              { id: 'posted', label: 'Posted' },
              { id: 'paid', label: 'Paid' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setSelectedStatus(tab.id)}
                className={`px-2.5 py-1 text-xs rounded-sm font-medium transition ${
                  selectedStatus === tab.id
                    ? 'bg-surface-neutral text-ink-900 font-semibold'
                    : 'text-ink-muted hover:text-ink-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Search Input */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-ink-muted absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search bills, suppliers (Ctrl+K)..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-3 text-xs rounded-sm border border-line-border bg-surface-subtle focus:bg-surface-elevated focus:outline-none focus:border-brand-teal w-60"
            />
          </div>

          <button
            type="button"
            onClick={() => navigate(`/${coSlug}/bills/new`)}
            className="flex items-center gap-1.5 h-8 px-3 rounded-sm bg-brand-teal text-white text-xs font-semibold hover:bg-brand-teal-hover transition shadow-2xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Record a Bill (n)</span>
          </button>
        </div>
      </div>

      {/* Main SplitPane View */}
      <SplitPane
        storageKey="ledgerly_bills_split_width"
        isOpen={Boolean(selectedBill)}
        onClose={() => setSelectedBillId(null)}
        title={selectedBill?.number || 'Draft Bill'}
        badge={selectedBill ? <StatusPill status={selectedBill.status} size="sm" /> : undefined}
        detailContent={
          selectedBill && (
            <div className="flex flex-col gap-4 text-xs">
              {/* Supplier info */}
              <div className="p-3 bg-surface-subtle border border-line-border rounded-sm flex flex-col gap-1.5">
                <div className="text-[10px] uppercase font-bold text-ink-muted flex items-center gap-1">
                  <Building className="w-3 h-3 text-brand-teal" />
                  Supplier
                </div>
                <div className="font-semibold text-ink-900 text-sm">
                  {suppliersMap.get(selectedBill.contact_id)?.name || 'Unknown Supplier'}
                </div>
                <div className="text-ink-muted font-mono text-[11px]">
                  Ref: {selectedBill.reference} • Terms: 30 days
                </div>
              </div>

              {/* Consequence Preview Banner */}
              <div className="p-2.5 bg-brand-teal/5 border border-brand-teal/20 rounded-sm text-ink-900 flex flex-col gap-1">
                <span className="font-semibold text-[11px] text-brand-teal uppercase tracking-wide flex items-center gap-1">
                  <Coins className="w-3.5 h-3.5" />
                  AP Accounting Effect
                </span>
                <p className="text-[11px] text-ink-muted leading-relaxed">
                  {selectedBill.status === 'posted' ? (
                    <>
                      Posted to Accounts Payable (2000). Total liability{' '}
                      <strong className="text-num font-mono text-ink-900">
                        {formatMoney(selectedBill.total)}
                      </strong>
                      {selectedBill.wht_amount_fc ? (
                        <>
                          {' '}with{' '}
                          <strong className="text-num font-mono text-ink-900">
                            {formatMoney(selectedBill.wht_amount_fc)}
                          </strong>{' '}
                          withholding tax withheld.
                        </>
                      ) : null}
                    </>
                  ) : (
                    <>
                      Posting will credit AP Control 2000 for{' '}
                      <strong className="text-num font-mono text-ink-900">
                        {formatMoney(selectedBill.total - (selectedBill.wht_amount_fc || 0))}
                      </strong>{' '}
                      and credit WHT Payable for{' '}
                      <strong className="text-num font-mono text-ink-900">
                        {formatMoney(selectedBill.wht_amount_fc || 0)}
                      </strong>.
                    </>
                  )}
                </p>
              </div>

              {/* Key Dates & Currency */}
              <div className="grid grid-cols-2 gap-2 p-2.5 bg-surface-neutral border border-line-border rounded-sm text-[11px]">
                <div>
                  <span className="text-ink-muted block">Issue Date</span>
                  <span className="font-mono text-ink-900 font-medium">{selectedBill.issue_date}</span>
                </div>
                <div>
                  <span className="text-ink-muted block">Due Date</span>
                  <span className="font-mono text-ink-900 font-medium">{selectedBill.due_date}</span>
                </div>
                <div>
                  <span className="text-ink-muted block">Currency / FX</span>
                  <span className="font-mono text-ink-900 font-medium">
                    {selectedBill.currency} @ {selectedBill.fx_rate.toFixed(4)}
                  </span>
                </div>
                <div>
                  <span className="text-ink-muted block">Open Payable</span>
                  <span className="font-mono text-num font-semibold text-danger">
                    {formatMoney(selectedBill.total - selectedBill.settled)}
                  </span>
                </div>
              </div>

              {/* Line items mini-table */}
              <div className="flex flex-col gap-1.5">
                <span className="font-semibold text-ink-900 uppercase tracking-wide text-[10px]">
                  Bill Line Items ({selectedBill.lines.length})
                </span>
                <div className="border border-line-border rounded-sm divide-y divide-line-border overflow-hidden">
                  {selectedBill.lines.map((line, idx) => (
                    <div key={line.id || idx} className="p-2 flex items-center justify-between bg-surface-subtle text-[11px]">
                      <div className="flex flex-col gap-0.5 truncate max-w-[200px]">
                        <span className="font-medium text-ink-900 truncate">{line.description}</span>
                        <span className="text-[10px] font-mono text-ink-muted">
                          Acc: {line.account_id} • {line.dimensions?.branch || 'HQ'}
                        </span>
                      </div>
                      <span className="font-mono text-num font-semibold text-ink-900">
                        {formatMoney(line.line_total_fc)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {actionError && (
                <div className="p-2 rounded bg-danger-bg text-danger text-[11px] flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-col gap-2 pt-2 border-t border-line-border">
                {selectedBill.status === 'pending_approval' && (
                  <button
                    type="button"
                    onClick={() => setSignDialogOpen(true)}
                    className="w-full h-8 bg-brand-teal text-white rounded-sm font-semibold hover:bg-brand-teal-hover transition flex items-center justify-center gap-1.5 shadow-2xs"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Approve & Post Bill</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => handleOpenTab(selectedBill)}
                  className="w-full h-8 border border-line-border bg-surface-subtle hover:bg-surface-neutral text-ink-900 rounded-sm font-medium transition flex items-center justify-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5 text-ink-muted" />
                  <span>Open Full Document Tab</span>
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
                  <th className="px-3">Bill Number</th>
                  <th className="px-3">Status</th>
                  <th className="px-3">Supplier</th>
                  <th className="px-3">Date</th>
                  <th className="px-3">Due Date</th>
                  <th className="px-3 text-right">WHT</th>
                  <th className="px-3 text-right">Total Amount</th>
                  <th className="px-3 text-right">Open Payable</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-border">
                {filteredBills.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-ink-muted">
                      <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
                      <p className="font-medium">No purchase bills found matching filters</p>
                      <p className="text-[11px] mt-0.5">Press 'n' to record a new supplier bill</p>
                    </td>
                  </tr>
                ) : (
                  filteredBills.map((bill) => {
                    const isSelected = selectedBillId === bill.id;
                    const supplier = suppliersMap.get(bill.contact_id);
                    const openAmount = bill.total - bill.settled;

                    return (
                      <tr
                        key={bill.id}
                        onClick={() => handleRowClick(bill)}
                        onDoubleClick={() => handleOpenTab(bill)}
                        className={`h-9 cursor-pointer transition select-none ${
                          isSelected
                            ? 'bg-brand-teal/10 font-medium'
                            : 'hover:bg-surface-neutral'
                        }`}
                      >
                        <td className="px-3 font-mono font-medium text-ink-900">
                          {bill.number || 'DRAFT-BILL'}
                        </td>
                        <td className="px-3">
                          <StatusPill status={bill.status} size="sm" />
                        </td>
                        <td className="px-3 truncate max-w-[180px]">
                          <span className="font-medium text-ink-900">{supplier?.name || bill.contact_id}</span>
                        </td>
                        <td className="px-3 font-mono text-[11px] text-ink-muted">
                          {bill.issue_date}
                        </td>
                        <td className="px-3 font-mono text-[11px] text-ink-muted">
                          {bill.due_date}
                        </td>
                        <td className="px-3 text-right font-mono text-num text-ink-muted">
                          {bill.wht_amount_fc ? formatMoney(bill.wht_amount_fc) : '—'}
                        </td>
                        <td className="px-3 text-right font-mono text-num font-semibold text-ink-900">
                          {formatMoney(bill.total)}
                        </td>
                        <td className="px-3 text-right font-mono text-num font-semibold">
                          <span className={openAmount > 0 ? 'text-danger' : 'text-success'}>
                            {formatMoney(openAmount)}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between text-[11px] text-ink-muted px-1">
            <span>Showing {filteredBills.length} of {bills.length} bills</span>
            <span>Click to preview • Double-click or Enter to open full document</span>
          </div>
        </div>
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
