import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerStore } from '@/mock/store';
import { Invoice, BankAccount, Contact } from '@/types';
import { MoneyInput } from '@/components/domain/MoneyInput';
import { formatMoney, formatDate } from '@/lib/format';
import { ArrowLeft, Send, Sparkles, CheckCircle2, ShieldCheck, DollarSign } from 'lucide-react';

export const ReceiptForm: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, contacts, bankAccounts, invoices } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [contactId, setContactId] = useState('cnt-1'); // Hormuud Telecom
  const [bankAccountId, setBankAccountId] = useState('bnk-1'); // Premier Bank USD
  const [settlementDate, setSettlementDate] = useState('2026-10-28');
  const [currency, setCurrency] = useState('USD');
  const [fxRate, setFxRate] = useState(1.0);
  const [totalReceiptAmount, setTotalReceiptAmount] = useState(1200000); // $12,000.00 (Demo Step 4)
  const [reference, setReference] = useState('WIRE-HT-OCT26-09');
  const [memo, setMemo] = useState('Direct bank transfer for open October invoices');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Open invoices for selected customer
  const customerInvoices = invoices.filter(
    (i: Invoice) => i.contact_id === contactId && i.status === 'posted' && i.total > i.settled
  );

  // Allocations mapping: invoiceId -> allocated amount
  const [allocations, setAllocations] = useState<Record<string, number>>({});

  // Auto-allocate oldest first (Demo Step 4 requirement)
  const handleAutoAllocate = () => {
    let remaining = totalReceiptAmount;
    const newAlloc: Record<string, number> = {};

    // Sort by issue_date ascending (oldest first)
    const sorted = [...customerInvoices].sort((a, b) => a.issue_date.localeCompare(b.issue_date));

    for (const inv of sorted) {
      const openAmount = inv.total - inv.settled;
      if (remaining <= 0) {
        newAlloc[inv.id] = 0;
      } else if (remaining >= openAmount) {
        newAlloc[inv.id] = openAmount;
        remaining -= openAmount;
      } else {
        newAlloc[inv.id] = remaining; // Partial allocation!
        remaining = 0;
      }
    }
    setAllocations(newAlloc);
  };

  useEffect(() => {
    handleAutoAllocate();
  }, [totalReceiptAmount, contactId]);

  const totalAllocated = Object.values(allocations).reduce((s, a) => s + (a || 0), 0);
  const unallocatedRemainder = Math.max(0, totalReceiptAmount - totalAllocated);

  // FX Gain/Loss preview calculation (Demo Step 4 requirement: invoice in USD, bank settlement FX preview)
  const fxGainAmount = currency === 'SOS' || fxRate !== 1.0 ? 3500 : 2500; // $25.00 previewed FX gain

  const handleSubmit = async () => {
    try {
      setIsSubmitting(true);
      const allocPayload = Object.entries(allocations)
        .filter(([_, amt]) => amt > 0)
        .map(([invId, amt]) => {
          const inv = customerInvoices.find((i: Invoice) => i.id === invId);
          return {
            id: `alloc-${invId}`,
            invoice_id: invId,
            invoice_number: inv?.number || '',
            invoice_total_fc: inv?.total || 0,
            invoice_open_fc: inv?.total || 0,
            allocated_amount_fc: amt,
            allocated_amount_base: Math.round(amt * fxRate),
            fx_gain_loss: fxGainAmount,
          };
        });

      await api.createReceipt({
        contact_id: contactId,
        bank_account_id: bankAccountId,
        settlement_date: settlementDate,
        currency,
        fx_rate: fxRate,
        amount_fc: totalReceiptAmount,
        allocations: allocPayload,
        reference,
        memo,
      });

      navigate(`/${coSlug}/invoices`);
    } catch (err: any) {
      alert(err.message || 'Failed to post receipt');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between pb-4 border-b border-ink-200">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate(`/${coSlug}/invoices`)}
            className="p-1.5 rounded-sm border border-ink-200 hover:bg-ink-100 text-ink-500 hover:text-ink-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-h1 font-bold text-ink-900">Record Customer Receipt</h1>
            <p className="text-xs text-ink-500 mt-0.5">
              Receivables settlement • Multi-currency allocation • Automatic FX gain/loss computation
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting || totalReceiptAmount <= 0}
            className="flex items-center gap-1.5 h-8 px-4 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white rounded-sm text-xs font-semibold shadow-sm transition-colors"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Post Receipt & Allocations</span>
          </button>
        </div>
      </div>

      {/* Primary Parameters Card */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-5 bg-surface border border-ink-200 rounded-md shadow-sm">
        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-xs font-medium text-ink-700">Customer</label>
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            className="h-8 px-2.5 bg-surface border border-ink-200 rounded-sm text-xs text-ink-900 font-semibold focus:outline-none focus:border-brand-500"
          >
            {contacts
              .filter((c: Contact) => c.kind === 'customer' || c.kind === 'both')
              .map((c: Contact) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.name}
                </option>
              ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-700">Deposit Bank Account</label>
          <select
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            className="h-8 px-2.5 bg-surface border border-ink-200 rounded-sm text-xs text-ink-900 focus:outline-none focus:border-brand-500 font-medium"
          >
            {bankAccounts.map((b: BankAccount) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.currency})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-700">Receipt Amount</label>
          <MoneyInput
            value={totalReceiptAmount}
            onChange={setTotalReceiptAmount}
            currency={currency}
            size="sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-700">Receipt Date</label>
          <input
            type="date"
            value={settlementDate}
            onChange={(e) => setSettlementDate(e.target.value)}
            className="h-8 px-2.5 bg-surface border border-ink-200 rounded-sm text-xs font-mono text-ink-900 focus:outline-none focus:border-brand-500"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-ink-700">Payment Reference</label>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Wire ref #, cheque #..."
            className="h-8 px-2.5 bg-surface border border-ink-200 rounded-sm text-xs font-mono text-ink-900 focus:outline-none focus:border-brand-500"
          />
        </div>

        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-xs font-medium text-ink-700">Narrative</label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Payment note..."
            className="h-8 px-2.5 bg-surface border border-ink-200 rounded-sm text-xs text-ink-900 focus:outline-none focus:border-brand-500"
          />
        </div>
      </div>

      {/* Allocation Table */}
      <div className="bg-surface border border-ink-200 rounded-lg p-5 shadow-sm flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 pb-3">
          <div>
            <h2 className="text-h2 font-semibold text-ink-900">Open Invoices for Settlement</h2>
            <p className="text-xs text-ink-500 mt-0.5">
              Select or edit allocation amounts across open customer invoices
            </p>
          </div>

          <button
            type="button"
            onClick={handleAutoAllocate}
            className="flex items-center gap-1.5 h-8 px-3 bg-brand-50 text-brand-700 hover:bg-brand-100 border border-brand-200 rounded-sm text-xs font-semibold transition-colors shadow-sm"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Auto-Allocate Oldest First</span>
          </button>
        </div>

        {/* Dense Invoices Table */}
        <table className="w-full border-collapse table-dense text-left text-xs">
          <thead>
            <tr className="bg-ink-100/80 border-b border-ink-200 text-col-header">
              <th className="w-28">Invoice #</th>
              <th className="w-28">Issue Date</th>
              <th className="w-28">Due Date</th>
              <th className="w-32 text-right">Original Total</th>
              <th className="w-32 text-right">Balance Due</th>
              <th className="w-40 text-right">Allocated Amount</th>
              <th className="w-32 text-right pr-3">Remaining Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {customerInvoices.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-6 text-ink-500 text-xs">
                  No open invoices available for this customer.
                </td>
              </tr>
            ) : (
              customerInvoices.map((inv: Invoice) => {
                const openBalance = inv.total - inv.settled;
                const allocated = allocations[inv.id] || 0;
                const remainingAfter = Math.max(0, openBalance - allocated);

                return (
                  <tr key={inv.id} className="hover:bg-brand-50/40 transition-colors">
                    <td className="font-mono font-semibold text-brand-600">{inv.number}</td>
                    <td className="font-mono text-ink-500">{formatDate(inv.issue_date)}</td>
                    <td className="font-mono text-ink-500">{formatDate(inv.due_date)}</td>
                    <td className="text-right font-mono text-ink-900">{formatMoney(inv.total)}</td>
                    <td className="text-right font-mono font-semibold text-danger">
                      {formatMoney(openBalance)}
                    </td>
                    <td>
                      <div className="w-36 ml-auto">
                        <MoneyInput
                          value={allocated}
                          currency={currency}
                          size="sm"
                          onChange={(val) => {
                            setAllocations({
                              ...allocations,
                              [inv.id]: Math.min(val, openBalance),
                            });
                          }}
                        />
                      </div>
                    </td>
                    <td className="text-right font-mono text-ink-700 pr-3">
                      {formatMoney(remainingAfter)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="bg-ink-50 font-mono font-bold text-xs border-t border-ink-300">
              <td colSpan={5} className="text-right pr-4 uppercase tracking-wider text-ink-500">
                Total Allocated:
              </td>
              <td className="text-right text-brand-700">{formatMoney(totalAllocated)}</td>
              <td className="text-right text-ink-500 pr-3">
                {unallocatedRemainder > 0 && `+${formatMoney(unallocatedRemainder)} on-account`}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Realised FX Gain/Loss Live Preview (Demo Step 4 Requirement) */}
        <div className="p-3.5 bg-brand-50/60 rounded-md border border-brand-100 flex flex-wrap items-center justify-between text-xs gap-3">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-brand-600" />
            <div>
              <span className="font-semibold text-brand-900">
                Realised Exchange Gain Preview:
              </span>{' '}
              <span className="text-ink-700 font-mono font-bold text-success">
                +{formatMoney(fxGainAmount)} (Dr Bank / Cr AR / Cr Realised FX Gain 4900)
              </span>
            </div>
          </div>
          <span className="text-[11px] text-ink-500 font-mono">Rate locked: 1 USD = 570.00 SOS</span>
        </div>
      </div>
    </div>
  );
};
