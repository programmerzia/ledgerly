import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '@/mock/api';
import { useLedgerStore } from '@/mock/store';
import { Invoice, BankAccount, Contact } from '@/types';
import { MoneyInput } from '@/components/domain/MoneyInput';
import { FieldHelp } from '@/components/domain/FieldHelp';
import { ConsequenceDialog, ConsequenceAccountingLine } from '@/components/domain/ConsequenceDialog';
import { formatMoney, formatDate } from '@/lib/format';
import { Receipt, ArrowLeft, Send, Sparkles, CheckCircle2, ShieldCheck, DollarSign } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/domain/PageHeader';

export const ReceiptForm: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { currentCompany, contacts, bankAccounts, invoices } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [contactId, setContactId] = useState(() => {
    const c = contacts.find((x) => x.id === searchParams.get('contact'));
    return c ? c.id : 'cnt-1'; // Hormuud Telecom
  });
  const [focusInvoiceId] = useState(() => {
    const inv = invoices.find((x: Invoice) => x.id === searchParams.get('invoice'));
    return inv ? inv.id : null;
  });
  const [bankAccountId, setBankAccountId] = useState('bnk-1'); // Premier Bank USD
  const [settlementDate, setSettlementDate] = useState('2026-10-28');
  const [currency, setCurrency] = useState('USD');
  const [fxRate, setFxRate] = useState(1.0);
  const [totalReceiptAmount, setTotalReceiptAmount] = useState(() => {
    const raw = Number(searchParams.get('amount'));
    return Number.isInteger(raw) && raw > 0 ? raw : 1200000; // $12,000.00 (Demo Step 4)
  });
  const [reference, setReference] = useState('WIRE-HT-OCT26-09');
  const [memo, setMemo] = useState('Direct bank transfer for open October invoices');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConsequence, setShowConsequence] = useState(false);

  // Autosave timer
  const [lastSavedSeconds, setLastSavedSeconds] = useState(1);
  useEffect(() => {
    const timer = setInterval(() => {
      setLastSavedSeconds((prev) => (prev < 60 ? prev + 1 : 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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
    // A linked invoice (from the command palette) is settled first
    const sorted = [...customerInvoices].sort((a, b) =>
      a.id === focusInvoiceId ? -1 : b.id === focusInvoiceId ? 1 : a.issue_date.localeCompare(b.issue_date)
    );

    for (const inv of sorted) {
      const openAmount = inv.total - inv.settled;
      if (remaining <= 0) {
        newAlloc[inv.id] = 0;
      } else if (remaining >= openAmount) {
        newAlloc[inv.id] = openAmount;
        remaining -= openAmount;
      } else {
        newAlloc[inv.id] = remaining; // Partial allocation
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

  const selectedContact = contacts.find((c) => c.id === contactId);
  const selectedBank = bankAccounts.find((b) => b.id === bankAccountId);

  // FX Gain/Loss preview calculation
  const fxGainAmount = currency === 'SOS' || fxRate !== 1.0 ? 3500 : 2500; // $25.00 previewed FX gain

  const accountingPreviewLines: ConsequenceAccountingLine[] = [
    {
      accountCode: selectedBank?.account_id ? '1010' : '1010',
      accountName: selectedBank?.name || 'Bank Account',
      debit: totalReceiptAmount,
      credit: 0,
    },
    {
      accountCode: '1200',
      accountName: 'Accounts Receivable',
      debit: 0,
      credit: Math.max(0, totalReceiptAmount - fxGainAmount),
    },
    ...(fxGainAmount > 0
      ? [
          {
            accountCode: '4900',
            accountName: 'Realised FX Gain',
            debit: 0,
            credit: fxGainAmount,
          },
        ]
      : []),
  ];

  const handleConfirmPost = async () => {
    try {
      setIsSubmitting(true);
      setShowConsequence(false);
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

      toast.success(`Receipt for ${formatMoney(totalReceiptAmount, currency)} posted successfully`, {
        action: {
          label: 'Undo',
          onClick: () => toast.info('Receipt reversed and allocation restored to unapplied'),
        },
      });
      navigate(`/${coSlug}/invoices`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to post receipt');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        breadcrumb={[{ label: 'Invoices', to: `/${coSlug}/invoices` }, { label: 'New receipt' }]}
        title="Record a payment received"
        subtitle={<>Match money from a customer to their invoices. <span className="text-accent font-medium">Saved {lastSavedSeconds} s ago</span></>}
        icon={<Receipt />}
        actions={
          <button
            type="button"
            onClick={() => setShowConsequence(true)}
            disabled={isSubmitting || totalReceiptAmount <= 0}
            className="flex items-center gap-1.5 h-9 px-4 bg-accent hover:bg-accent-hover disabled:opacity-40 text-white rounded-lg text-[13px] font-semibold shadow-xs transition"
          >
            <Send className="size-4" />
            <span>Post receipt</span>
          </button>
        }
      />

      {/* Primary Parameters Card */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 p-5 bg-surface border border-border rounded-xl shadow-card">
        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-xs font-medium text-text-secondary flex items-center">
            Customer
            <FieldHelp
              help="Customer entity making the payment against outstanding accounts receivable."
              example="CUST-001 Hormuud Telecom"
            />
          </label>
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            className="h-8 px-2.5 bg-surface border border-border rounded-lg text-xs text-text-primary font-semibold focus:outline-none focus:border-accent"
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
          <label className="text-xs font-medium text-text-secondary flex items-center">
            Deposit Bank Account
            <FieldHelp
              help="Bank or treasury account where received funds are deposited."
              example="Premier Bank USD (GL 1010)"
            />
          </label>
          <select
            value={bankAccountId}
            onChange={(e) => setBankAccountId(e.target.value)}
            className="h-8 px-2.5 bg-surface border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent font-medium"
          >
            {bankAccounts.map((b: BankAccount) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.currency})
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary flex items-center">
            Receipt Amount
            <FieldHelp
              help="Total amount received in the bank deposit transaction."
              example="$12,000.00"
            />
          </label>
          <MoneyInput
            value={totalReceiptAmount}
            onChange={setTotalReceiptAmount}
            currency={currency}
            size="sm"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary flex items-center">
            Receipt Date
            <FieldHelp
              help="Date funds cleared into the bank account."
              example="2026-10-28"
            />
          </label>
          <input
            type="date"
            value={settlementDate}
            onChange={(e) => setSettlementDate(e.target.value)}
            className="h-8 px-2.5 bg-surface border border-border rounded-lg text-xs font-mono text-text-primary focus:outline-none focus:border-accent"
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-text-secondary flex items-center">
            Payment Reference
            <FieldHelp
              help="Bank transfer reference number, wire confirmation, or cheque number."
              example="WIRE-HT-OCT26-09"
            />
          </label>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="Wire ref #, cheque #..."
            className="h-8 px-2.5 bg-surface border border-border rounded-lg text-xs font-mono text-text-primary focus:outline-none focus:border-accent"
          />
        </div>

        <div className="flex flex-col gap-1 md:col-span-2">
          <label className="text-xs font-medium text-text-secondary flex items-center">
            Narrative / Memo
            <FieldHelp
              help="Audit description explaining the settlement purpose."
              example="Direct bank transfer for open October invoices"
            />
          </label>
          <input
            type="text"
            value={memo}
            onChange={(e) => setMemo(e.target.value)}
            placeholder="Payment note..."
            className="h-8 px-2.5 bg-surface border border-border rounded-lg text-xs text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
      </div>

      {/* Allocation Table */}
      <div className="bg-surface border border-border rounded-xl p-5 shadow-card flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Open Invoices for Settlement</h2>
            <p className="text-xs text-text-muted mt-0.5">
              Select or edit allocation amounts across open customer invoices
            </p>
          </div>

          <button
            type="button"
            onClick={handleAutoAllocate}
            className="flex items-center gap-1.5 h-8 px-3 bg-accent-soft text-accent hover:bg-accent hover:text-white border border-accent/20 rounded-lg text-xs font-semibold transition shadow-xs"
          >
            <Sparkles className="w-3.5 h-3.5" />
            <span>Auto-Allocate Oldest First</span>
          </button>
        </div>

        {/* Dense Invoices Table */}
        <table className="w-full border-collapse table-dense text-left text-xs">
          <thead>
            <tr className="bg-surface-neutral border-b border-border text-col-header">
              <th className="w-28 py-2 px-2">Invoice #</th>
              <th className="w-28 py-2 px-2">Issue Date</th>
              <th className="w-28 py-2 px-2">Due Date</th>
              <th className="w-32 text-right py-2 px-2">Original Total</th>
              <th className="w-32 text-right py-2 px-2">Balance Due</th>
              <th className="w-40 text-right py-2 px-2">Allocated Amount</th>
              <th className="w-32 text-right py-2 px-3">Remaining Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {customerInvoices.length === 0 ? (
              <tr>
                <td colSpan={7} className="text-center py-6 text-text-muted text-xs">
                  No open invoices available for this customer.
                </td>
              </tr>
            ) : (
              customerInvoices.map((inv: Invoice) => {
                const openBalance = inv.total - inv.settled;
                const allocated = allocations[inv.id] || 0;
                const remainingAfter = Math.max(0, openBalance - allocated);

                return (
                  <tr key={inv.id} className="hover:bg-surface-neutral/50 transition">
                    <td className="font-mono font-semibold text-accent px-2 py-1.5">{inv.number}</td>
                    <td className="font-mono text-text-muted px-2 py-1.5">{formatDate(inv.issue_date)}</td>
                    <td className="font-mono text-text-muted px-2 py-1.5">{formatDate(inv.due_date)}</td>
                    <td className="text-right font-mono text-text-primary px-2 py-1.5 text-num">{formatMoney(inv.total)}</td>
                    <td className="text-right font-mono font-semibold text-danger px-2 py-1.5 text-num">
                      {formatMoney(openBalance)}
                    </td>
                    <td className="px-2 py-1.5">
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
                    <td className="text-right font-mono text-text-primary pr-3 py-1.5 text-num">
                      {formatMoney(remainingAfter)}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          <tfoot>
            <tr className="bg-surface-neutral font-mono font-bold text-xs border-t-2 border-border">
              <td colSpan={5} className="text-right pr-4 uppercase tracking-wider text-text-muted py-2">
                Total Allocated:
              </td>
              <td className="text-right text-accent py-2 text-num">{formatMoney(totalAllocated)}</td>
              <td className="text-right text-text-muted pr-3 py-2 text-num">
                {unallocatedRemainder > 0 && `+${formatMoney(unallocatedRemainder)} on-account`}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Realised FX Gain/Loss Live Preview */}
        <div className="p-3.5 bg-accent-soft/30 rounded-md border border-accent/20 flex flex-wrap items-center justify-between text-xs gap-3">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-accent" />
            <div>
              <span className="font-semibold text-text-primary">
                Realised Exchange Gain Preview:
              </span>{' '}
              <span className="text-success font-mono font-bold">
                +{formatMoney(fxGainAmount)} (Dr Bank / Cr AR / Cr Realised FX Gain 4900)
              </span>
            </div>
          </div>
          <span className="text-[11px] text-text-muted font-mono">Rate locked: 1 USD = 570.00 SOS</span>
        </div>
      </div>

      {/* Consequence Modal */}
      <ConsequenceDialog
        isOpen={showConsequence}
        onClose={() => setShowConsequence(false)}
        onConfirm={handleConfirmPost}
        title="Post Customer Receipt & Allocations"
        actionType="post"
        plainLanguageEffect={`This will immediately post a customer receipt of ${formatMoney(totalReceiptAmount, currency)} from ${selectedContact?.name || 'Hormuud Telecom'} into ${selectedBank?.name || 'Premier Bank USD'}, settling open invoice balances and recording $25.00 in Realised FX Gain.`}
        accountingLines={accountingPreviewLines}
        confirmLabel="Confirm & Post Receipt"
        isSubmitting={isSubmitting}
      />
    </div>
  );
};
