import { selectByMode } from '@/data/select';
import { PaymentRunsLive } from './live/PaymentRunsLive';
import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { Bill } from '@/types';
import { formatMoney, formatDate } from '@/lib/format';
import { SignDialog } from '@/components/domain/SignDialog';
import { PageHeader } from '@/components/domain/PageHeader';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

import { CheckCircle2, ArrowRight, ArrowLeft, Calendar, CreditCard, Download, ShieldCheck } from 'lucide-react';

const MockPaymentRunWizard: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, currentUser, companySettings, bankAccounts, bills, contacts, recordPayment } = useLedgerStore();
  const coSlug = currentCompany.slug;

  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [selectedBankId, setSelectedBankId] = useState('bnk-1'); // Premier Bank USD
  const [paymentDate, setPaymentDate] = useState('2026-10-28');
  const [selectedBillIds, setSelectedBillIds] = useState<Set<string>>(new Set());
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [isCompleted, setIsCompleted] = useState(false);
  const [csvDownloaded, setCsvDownloaded] = useState(false);

  const suppliersMap = useMemo(() => {
    return new Map(contacts.map((c) => [c.id, c]));
  }, [contacts]);

  // Open payable bills
  const payableBills = useMemo(() => {
    return bills.filter((b) => b.status === 'posted' && b.total > b.settled);
  }, [bills]);

  // Selected bills breakdown
  const selectedBills = useMemo(() => {
    return payableBills.filter((b) => selectedBillIds.has(b.id));
  }, [payableBills, selectedBillIds]);

  // Calculation summaries
  const totals = useMemo(() => {
    let gross = 0;
    let wht = 0;
    for (const b of selectedBills) {
      const open = b.total - b.settled;
      const bWht = b.wht_amount_fc || Math.round(open * 0.05);
      gross += open;
      wht += bWht;
    }
    const net = gross - wht;
    return { gross, wht, net };
  }, [selectedBills]);

  const handleToggleSelectAll = () => {
    if (selectedBillIds.size === payableBills.length) {
      setSelectedBillIds(new Set());
    } else {
      setSelectedBillIds(new Set(payableBills.map((b) => b.id)));
    }
  };

  const handleToggleBill = (id: string) => {
    const next = new Set(selectedBillIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedBillIds(next);
  };

  const handleExecutePaymentRun = async (pin: string) => {
    // Post settlements for each selected bill
    for (const bill of selectedBills) {
      const supplier = suppliersMap.get(bill.contact_id);
      const openAmount = bill.total - bill.settled;
      const wht = bill.wht_amount_fc || Math.round(openAmount * 0.05);
      const net = openAmount - wht;

      recordPayment(
        {
          id: `stl-pay-${bill.id}-${Date.now()}`,
          tenant_id: currentCompany.tenant_id,
          company_id: currentCompany.id,
          kind: 'payment',
          number: `PAY-2026-${Math.floor(1000 + Math.random() * 9000)}`,
          status: 'posted',
          contact_id: bill.contact_id,
          bank_account_id: selectedBankId,
          settlement_date: paymentDate,
          currency: bill.currency,
          fx_rate: bill.fx_rate,
          amount_fc: net,
          amount: Math.round(net * bill.fx_rate),
          unallocated_fc: 0,
          allocations: [
            {
              id: `alloc-pay-${bill.id}`,
              invoice_id: bill.id,
              invoice_number: bill.number || '',
              invoice_total_fc: bill.total,
              invoice_open_fc: openAmount,
              allocated_amount_fc: net,
              allocated_amount_base: Math.round(net * bill.fx_rate),
              fx_gain_loss: 0,
            },
          ],
          reference: `WIRE-${bill.number || 'BILL'}`,
          memo: `Supplier payment run disbursement to ${supplier?.name || 'vendor'} (WHT deducted)`,
          created_by: currentUser.id,
          approved_by: currentUser.id,
          signed_by: currentUser.name,
          posted_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        currentUser,
        companySettings
      );
    }

    setSignDialogOpen(false);
    setIsCompleted(true);
    setCurrentStep(3);
  };

  const handleDownloadCsv = () => {
    const headers = 'Supplier,Account,Currency,GrossAmount,WHT,NetDisbursement,Reference,Date\n';
    const rows = selectedBills
      .map((b) => {
        const supplier = suppliersMap.get(b.contact_id);
        const open = b.total - b.settled;
        const wht = b.wht_amount_fc || Math.round(open * 0.05);
        const net = open - wht;
        return `"${supplier?.name || b.contact_id}","${supplier?.tax_id || 'ACC-998'}","${b.currency}",${(open / 100).toFixed(2)},${(wht / 100).toFixed(2)},${(net / 100).toFixed(2)},"PAY-${b.number}","${paymentDate}"`;
      })
      .join('\n');

    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `Bank_Payment_Run_${paymentDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setCsvDownloaded(true);
  };

  const STEPS = ['Choose bills', 'Review withholding', 'Done'];
  const CARD = 'rounded-lg border border-border bg-surface';
  const FIELD =
    'h-9 px-3 rounded-lg border border-border bg-surface text-[13px] text-text-primary focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition';
  const LABEL = 'flex items-center gap-1.5 text-xs font-medium text-text-secondary';
  const BTN1 =
    'inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition-colors disabled:opacity-50 cursor-pointer';
  const BTN2 =
    'inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border hover:border-border-strong bg-surface hover:bg-surface-neutral text-text-primary text-[13px] font-medium transition-colors cursor-pointer';
  const TH = 'px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-text-muted';

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        breadcrumb={[{ label: 'Bills', to: `/${coSlug}/bills` }, { label: 'Payment run' }]}
        title="Pay several suppliers at once"
        subtitle="Pick the bills to pay. Withholding tax is worked out for you."
      />

      {/* Stepper */}
      <ol className={cn(CARD, 'flex items-center gap-2 px-5 py-4')} aria-label="Progress">
        {STEPS.map((label, i) => {
          const n = i + 1;
          const done = currentStep > n;
          const active = currentStep === n;
          return (
            <React.Fragment key={label}>
              <li className="flex items-center gap-2.5" aria-current={active ? 'step' : undefined}>
                <span
                  className={cn(
                    'flex size-7 items-center justify-center rounded-md text-xs font-semibold transition-colors',
                    done && 'bg-success text-white',
                    active && 'bg-accent text-white',
                    !done && !active && 'bg-surface-neutral text-text-muted'
                  )}
                >
                  {done ? <Check className="size-4" /> : n}
                </span>
                <span className={cn('text-[13px] font-medium', active ? 'text-text-primary' : 'text-text-muted')}>{label}</span>
              </li>
              {i < STEPS.length - 1 && (
                <span className={cn('mx-2 h-px flex-1 transition-colors', done ? 'bg-success' : 'bg-border')} />
              )}
            </React.Fragment>
          );
        })}
      </ol>

      {currentStep === 1 && (
        <div className="flex flex-col gap-5">
          <div className={cn(CARD, 'p-5 grid grid-cols-1 md:grid-cols-2 gap-4')}>
            <div className="flex flex-col gap-1.5">
              <label className={LABEL}>
                <CreditCard className="size-3.5 text-text-muted" /> Pay from
              </label>
              <select value={selectedBankId} onChange={(e) => setSelectedBankId(e.target.value)} className={FIELD}>
                {bankAccounts.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.bank_name} - {b.name} ({b.currency})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className={LABEL}>
                <Calendar className="size-3.5 text-text-muted" /> Payment date
              </label>
              <input type="date" value={paymentDate} onChange={(e) => setPaymentDate(e.target.value)} className={cn(FIELD, 'tabular-nums')} />
            </div>
          </div>

          <div className={cn(CARD, 'overflow-hidden')}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary">Bills ready to pay ({payableBills.length})</h2>
              <button type="button" onClick={handleToggleSelectAll} className="text-[13px] text-accent hover:underline font-medium">
                {selectedBillIds.size === payableBills.length ? 'Clear selection' : 'Select all'}
              </button>
            </div>
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="bg-surface-neutral/60 border-b border-border">
                  <th className="px-4 w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all bills"
                      checked={payableBills.length > 0 && selectedBillIds.size === payableBills.length}
                      onChange={handleToggleSelectAll}
                      className="rounded border-border accent-[var(--color-accent)]"
                    />
                  </th>
                  <th className={TH}>Bill</th>
                  <th className={TH}>Supplier</th>
                  <th className={TH}>Due</th>
                  <th className={cn(TH, 'text-right')}>Total</th>
                  <th className={cn(TH, 'text-right')}>Left to pay</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {payableBills.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-text-muted">
                      No bills are waiting to be paid.
                    </td>
                  </tr>
                ) : (
                  payableBills.map((b) => {
                    const isChecked = selectedBillIds.has(b.id);
                    const supplier = suppliersMap.get(b.contact_id);
                    const open = b.total - b.settled;
                    return (
                      <tr
                        key={b.id}
                        onClick={() => handleToggleBill(b.id)}
                        className={cn('h-11 cursor-pointer transition-colors select-none', isChecked ? 'bg-accent-soft/50' : 'hover:bg-accent-soft/30')}
                      >
                        <td className="px-4">
                          <input
                            type="checkbox"
                            aria-label={`Select ${b.number || 'draft bill'}`}
                            checked={isChecked}
                            onChange={() => handleToggleBill(b.id)}
                            onClick={(e) => e.stopPropagation()}
                            className="rounded border-border accent-[var(--color-accent)]"
                          />
                        </td>
                        <td className="px-3 font-mono font-medium text-text-primary">{b.number || 'Draft'}</td>
                        <td className="px-3 text-text-primary">{supplier?.name || b.contact_id}</td>
                        <td className="px-3 text-text-muted tabular-nums">{formatDate(b.due_date)}</td>
                        <td className="px-3 text-right font-mono text-num text-text-muted">{formatMoney(b.total)}</td>
                        <td className="px-3 text-right font-mono text-num font-semibold text-text-primary">{formatMoney(open)}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
            <div className="flex items-center justify-between px-5 py-4 border-t border-border bg-surface-neutral/40">
              <span className="text-[13px] text-text-muted">
                <span className="font-semibold text-text-primary">{selectedBillIds.size}</span> selected, {formatMoney(totals.gross)}
              </span>
              <button type="button" onClick={() => setCurrentStep(2)} disabled={selectedBillIds.size === 0} className={BTN1}>
                Continue <ArrowRight className="size-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {currentStep === 2 && (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className={cn(CARD, 'p-5')}>
              <div className="text-xs font-medium text-text-muted">Bills selected</div>
              <div className="mt-1 text-[22px] leading-7 font-medium tabular-nums text-text-primary">{formatMoney(totals.gross)}</div>
              <div className="mt-1 text-xs text-text-muted">{selectedBills.length} bills to clear</div>
            </div>
            <div className={cn(CARD, 'p-5')}>
              <div className="flex items-center gap-1.5 text-xs font-medium text-text-muted">
                <ShieldCheck className="size-3.5" /> Withholding tax held back
              </div>
              <div className="mt-1 text-[22px] leading-7 font-medium tabular-nums text-danger">-{formatMoney(totals.wht)}</div>
              <div className="mt-1 text-xs text-text-muted">Certificates are created for you</div>
            </div>
            <div className="rounded-lg border border-border bg-surface-neutral p-5">
              <div className="text-xs font-medium text-text-muted">Leaves your bank</div>
              <div className="mt-1 text-[22px] leading-7 font-medium tabular-nums text-text-primary">{formatMoney(totals.net)}</div>
              <div className="mt-1 text-xs text-text-muted">
                From {bankAccounts.find((b) => b.id === selectedBankId)?.name || 'your bank account'}
              </div>
            </div>
          </div>

          <div className={cn(CARD, 'overflow-hidden')}>
            <div className="px-5 py-4 border-b border-border">
              <h2 className="text-sm font-semibold text-text-primary">What each supplier receives</h2>
            </div>
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="bg-surface-neutral/60 border-b border-border">
                  <th className={TH}>Supplier</th>
                  <th className={TH}>Bill</th>
                  <th className={cn(TH, 'text-right')}>Amount</th>
                  <th className={cn(TH, 'text-right')}>Tax held back</th>
                  <th className={cn(TH, 'text-right')}>They receive</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {selectedBills.map((b) => {
                  const supplier = suppliersMap.get(b.contact_id);
                  const open = b.total - b.settled;
                  const wht = b.wht_amount_fc || Math.round(open * 0.05);
                  const net = open - wht;
                  return (
                    <tr key={b.id} className="h-11 hover:bg-accent-soft/30 transition-colors">
                      <td className="px-3 font-medium text-text-primary">{supplier?.name || b.contact_id}</td>
                      <td className="px-3 font-mono text-text-muted">{b.number}</td>
                      <td className="px-3 text-right font-mono text-num text-text-primary">{formatMoney(open)}</td>
                      <td className="px-3 text-right font-mono text-num text-danger">-{formatMoney(wht)}</td>
                      <td className="px-3 text-right font-mono text-num font-semibold text-text-primary">{formatMoney(net)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex items-center justify-between px-5 py-4 border-t border-border bg-surface-neutral/40">
              <button type="button" onClick={() => setCurrentStep(1)} className={BTN2}>
                <ArrowLeft className="size-4" /> Back
              </button>
              <button type="button" onClick={() => setSignDialogOpen(true)} className={BTN1}>
                <ShieldCheck className="size-4" /> Confirm with PIN and pay
              </button>
            </div>
          </div>
        </div>
      )}

      {currentStep === 3 && (
        <div className={cn(CARD, 'p-10 flex flex-col items-center text-center gap-4')}>
          <CheckCircle2 className="size-6 text-success" />
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-text-primary">Payments are done</h2>
            <p className="text-[13px] text-text-muted max-w-md">
              The selected bills are marked as paid, what you owe suppliers went down, and withholding tax certificates were created.
            </p>
          </div>
          <dl className="w-full max-w-md divide-y divide-border rounded-lg border border-border text-[13px]">
            <div className="flex justify-between px-4 py-2.5">
              <dt className="text-text-muted">Bills paid</dt>
              <dd className="font-semibold text-text-primary tabular-nums">{selectedBills.length}</dd>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <dt className="text-text-muted">Total sent</dt>
              <dd className="font-semibold text-text-primary tabular-nums">{formatMoney(totals.net)}</dd>
            </div>
            <div className="flex justify-between px-4 py-2.5">
              <dt className="text-text-muted">Withholding certificates</dt>
              <dd className="font-semibold text-text-primary tabular-nums">{selectedBills.length}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
            <button type="button" onClick={handleDownloadCsv} className={BTN1}>
              <Download className="size-4" /> {csvDownloaded ? 'Download bank file again' : 'Download bank file (CSV)'}
            </button>
            <button type="button" onClick={() => navigate(`/${coSlug}/wht-certificates`)} className={BTN2}>
              <ShieldCheck className="size-4 text-text-muted" /> View certificates
            </button>
          </div>
        </div>
      )}

      <SignDialog
        isOpen={signDialogOpen}
        onClose={() => setSignDialogOpen(false)}
        onConfirm={handleExecutePaymentRun}
        documentTitle="Supplier Payment Run"
        documentNumber="PR-2026-OCT-01"
        periodName={currentCompany.base_currency}
        amount={totals.net}
        consequenceText={`This will disburse ${formatMoney(totals.net)} from ${
          bankAccounts.find((b) => b.id === selectedBankId)?.bank_name || 'Bank'
        }, settle ${selectedBills.length} supplier bills, and record ${formatMoney(totals.wht)} in Withholding Tax payable.`}
      />
    </div>
  );
};

/** The demo keeps its store-backed screen; live mode reads the API (docs/15). */
export const PaymentRunWizard: React.FC = selectByMode({ mock: MockPaymentRunWizard, live: PaymentRunsLive });
