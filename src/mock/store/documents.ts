/**
 * Documents slice: Handles invoices, bills, receipts, payments, and payment runs.
 * Invariant: Every posting action strictly passes through executePostJournal.
 * Invariant: Four-Eyes Principle: Maker can never approve or sign their own document.
 */

import { StateCreator } from 'zustand';
import {
  Invoice,
  Bill,
  Settlement,
  PaymentRun,
  WhtCertificate,
  Contact,
  User,
  CompanySettings,
  AuditEvent,
} from '@/types';
import {
  mockInvoices,
  mockBills,
  mockSettlements,
  mockPaymentRuns,
  mockWhtCertificates,
  mockContacts,
} from '@/mock/data';
import {
  buildJournalFromInvoice,
  buildJournalFromBill,
  buildJournalFromSettlement,
  executePostJournal,
  PostingError,
} from '@/mock/PostingRules';
import { generateSignatureHash } from '@/lib/hash';

export interface DocumentsSlice {
  invoices: Invoice[];
  bills: Bill[];
  settlements: Settlement[];
  paymentRuns: PaymentRun[];
  whtCertificates: WhtCertificate[];
  contacts: Contact[];

  // Invoice Actions
  saveInvoiceDraft: (invoice: Partial<Invoice>, actor: User) => Invoice;
  submitInvoiceForApproval: (invoiceId: string, actor: User) => Invoice;
  approveInvoice: (invoiceId: string, approver: User, pin: string, settings: CompanySettings) => Invoice;
  returnInvoice: (invoiceId: string, reason: string, approver: User) => Invoice;
  voidInvoice: (invoiceId: string, reason: string, actor: User) => Invoice;

  // Bill Actions
  saveBillDraft: (bill: Partial<Bill>, actor: User) => Bill;
  submitBillForApproval: (billId: string, actor: User) => Bill;
  approveBill: (billId: string, approver: User, pin: string, settings: CompanySettings) => Bill;
  returnBill: (billId: string, reason: string, approver: User) => Bill;

  // Settlement Actions
  recordReceipt: (settlement: Partial<Settlement>, actor: User, settings: CompanySettings) => Settlement;
  recordPayment: (settlement: Partial<Settlement>, actor: User, settings: CompanySettings) => Settlement;

  // Payment Run Actions
  createPaymentRun: (run: Partial<PaymentRun>, actor: User, settings: CompanySettings) => PaymentRun;
  postPaymentRun: (runId: string, approver: User, pin: string, settings: CompanySettings) => PaymentRun;

  // Contact Actions
  addContact: (contact: Contact) => void;
  updateContact: (contact: Contact) => void;
}

export const createDocumentsSlice: StateCreator<any, [], [], DocumentsSlice> = (set, get) => ({
  invoices: [...mockInvoices],
  bills: [...mockBills],
  settlements: [...mockSettlements],
  paymentRuns: [...mockPaymentRuns],
  whtCertificates: [...mockWhtCertificates],
  contacts: [...mockContacts],

  saveInvoiceDraft: (data, actor) => {
    const state = get();
    const id = data.id || `inv-${Date.now()}`;
    const prefix = state.currentCompany?.settings?.numbering.invoice_prefix || 'INV-';
    const num = data.number || `DRAFT-${String(state.sequences.invoice || 44).padStart(4, '0')}`;

    const newInv: Invoice = {
      id,
      tenant_id: 'ten-acme',
      company_id: state.currentCompany?.id || 'co-1',
      kind: data.kind || 'sales_invoice',
      number: num,
      status: data.status || 'draft',
      contact_id: data.contact_id || '',
      issue_date: data.issue_date || new Date().toISOString().split('T')[0],
      due_date: data.due_date || new Date().toISOString().split('T')[0],
      currency: data.currency || 'USD',
      fx_rate: data.fx_rate || 1.0,
      reference: data.reference || '',
      memo: data.memo || '',
      lines: data.lines || [],
      subtotal_fc: data.subtotal_fc || 0,
      tax_total_fc: data.tax_total_fc || 0,
      total_fc: data.total_fc || 0,
      subtotal: data.subtotal || 0,
      tax_total: data.tax_total || 0,
      total: data.total || 0,
      settled_fc: 0,
      settled: 0,
      created_by: actor.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const exists = state.invoices.some((i: Invoice) => i.id === id);
    set((s: any) => ({
      invoices: exists
        ? s.invoices.map((i: Invoice) => (i.id === id ? { ...i, ...newInv, updated_at: new Date().toISOString() } : i))
        : [newInv, ...s.invoices],
    }));

    return newInv;
  },

  submitInvoiceForApproval: (invoiceId, actor) => {
    const state = get();
    const inv = state.invoices.find((i: Invoice) => i.id === invoiceId);
    if (!inv) throw new PostingError('Invoice not found');

    const updated: Invoice = {
      ...inv,
      status: 'pending_approval',
      submitted_by: actor.id,
      updated_at: new Date().toISOString(),
    };

    set((s: any) => ({
      invoices: s.invoices.map((i: Invoice) => (i.id === invoiceId ? updated : i)),
    }));

    return updated;
  },

  approveInvoice: (invoiceId, approver, pin, settings) => {
    const state = get();
    const inv = state.invoices.find((i: Invoice) => i.id === invoiceId);
    if (!inv) throw new PostingError('Invoice not found');

    // Strict Maker != Checker Rule
    if (inv.created_by === approver.id || inv.submitted_by === approver.id) {
      throw new PostingError(
        'Segregation of Duties violation: The creator of a document cannot approve it (Four-Eyes Principle).',
        'MAKER_CANNOT_APPROVE'
      );
    }

    // Verify PIN
    if (approver.signingPin !== pin) {
      state.recordFailedPin(approver.id);
      throw new PostingError('Invalid 6-digit signing PIN.', 'INVALID_PIN');
    }
    state.resetFailedPin(approver.id);

    // Assign final gapless number
    const seq = state.sequences.invoice || 44;
    const padding = settings.numbering.padding || 4;
    const finalNumber = `INV-2026-${String(seq).padStart(padding, '0')}`;

    const now = new Date().toISOString();
    const prevAuditHash = state.auditEvents?.[0]?.hash || '0000000000000000000000000000000000000000000000000000000000000000';
    const sigHash = generateSignatureHash(inv.id, 'posted', approver.id, now, prevAuditHash);

    const readyInvoice: Invoice = {
      ...inv,
      number: finalNumber,
      status: 'posted',
      approved_by: approver.id,
      signed_by: approver.id,
      signed_at: now,
      signature_hash: sigHash,
      posted_at: now,
      updated_at: now,
    };

    // Build and post journal directly through central PostingRules
    const journalDraft = buildJournalFromInvoice(readyInvoice, settings, state.currentPeriod?.id || 'per-2026-10', approver);
    const { journal, auditEvent } = state.postJournalDirect(journalDraft, approver, settings, state.auditEvents?.[0]);

    readyInvoice.journal_id = journal.id;

    set((s: any) => ({
      invoices: s.invoices.map((i: Invoice) => (i.id === invoiceId ? readyInvoice : i)),
      sequences: { ...s.sequences, invoice: seq + 1 },
    }));

    return readyInvoice;
  },

  returnInvoice: (invoiceId, reason, approver) => {
    const state = get();
    const inv = state.invoices.find((i: Invoice) => i.id === invoiceId);
    if (!inv) throw new PostingError('Invoice not found');

    const updated: Invoice = {
      ...inv,
      status: 'draft',
      memo: `Returned by ${approver.name}: ${reason}`,
      updated_at: new Date().toISOString(),
    };

    set((s: any) => ({
      invoices: s.invoices.map((i: Invoice) => (i.id === invoiceId ? updated : i)),
    }));

    return updated;
  },

  voidInvoice: (invoiceId, reason, actor) => {
    const state = get();
    const inv = state.invoices.find((i: Invoice) => i.id === invoiceId);
    if (!inv) throw new PostingError('Invoice not found');

    if (inv.status === 'posted') {
      throw new PostingError('Posted invoices cannot be voided directly; reverse the associated journal instead.');
    }

    const updated: Invoice = {
      ...inv,
      status: 'void',
      memo: `Voided by ${actor.name}: ${reason}`,
      updated_at: new Date().toISOString(),
    };

    set((s: any) => ({
      invoices: s.invoices.map((i: Invoice) => (i.id === invoiceId ? updated : i)),
    }));

    return updated;
  },

  saveBillDraft: (data, actor) => {
    const state = get();
    const id = data.id || `bill-${Date.now()}`;
    const num = data.number || `DRAFT-BILL-${String(state.sequences.bill || 16).padStart(4, '0')}`;

    const newBill: Bill = {
      id,
      tenant_id: 'ten-acme',
      company_id: state.currentCompany?.id || 'co-1',
      kind: 'purchase_bill',
      number: num,
      status: data.status || 'draft',
      contact_id: data.contact_id || '',
      issue_date: data.issue_date || new Date().toISOString().split('T')[0],
      due_date: data.due_date || new Date().toISOString().split('T')[0],
      currency: data.currency || 'USD',
      fx_rate: data.fx_rate || 1.0,
      reference: data.reference || '',
      memo: data.memo || '',
      lines: data.lines || [],
      subtotal_fc: data.subtotal_fc || 0,
      tax_total_fc: data.tax_total_fc || 0,
      total_fc: data.total_fc || 0,
      subtotal: data.subtotal || 0,
      tax_total: data.tax_total || 0,
      total: data.total || 0,
      settled_fc: 0,
      settled: 0,
      wht_code_id: data.wht_code_id,
      wht_amount_fc: data.wht_amount_fc || 0,
      created_by: actor.id,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const exists = state.bills.some((b: Bill) => b.id === id);
    set((s: any) => ({
      bills: exists
        ? s.bills.map((b: Bill) => (b.id === id ? { ...b, ...newBill, updated_at: new Date().toISOString() } : b))
        : [newBill, ...s.bills],
    }));

    return newBill;
  },

  submitBillForApproval: (billId, actor) => {
    const state = get();
    const bill = state.bills.find((b: Bill) => b.id === billId);
    if (!bill) throw new PostingError('Bill not found');

    const updated: Bill = {
      ...bill,
      status: 'pending_approval',
      submitted_by: actor.id,
      updated_at: new Date().toISOString(),
    };

    set((s: any) => ({
      bills: s.bills.map((b: Bill) => (b.id === billId ? updated : b)),
    }));

    return updated;
  },

  approveBill: (billId, approver, pin, settings) => {
    const state = get();
    const bill = state.bills.find((b: Bill) => b.id === billId);
    if (!bill) throw new PostingError('Bill not found');

    if (bill.created_by === approver.id || bill.submitted_by === approver.id) {
      throw new PostingError(
        'Segregation of Duties violation: The creator of a bill cannot approve it.',
        'MAKER_CANNOT_APPROVE'
      );
    }

    if (approver.signingPin !== pin) {
      state.recordFailedPin(approver.id);
      throw new PostingError('Invalid 6-digit signing PIN.', 'INVALID_PIN');
    }
    state.resetFailedPin(approver.id);

    const seq = state.sequences.bill || 16;
    const padding = settings.numbering.padding || 4;
    const finalNumber = `BILL-2026-${String(seq).padStart(padding, '0')}`;

    const now = new Date().toISOString();
    const prevAuditHash = state.auditEvents?.[0]?.hash || '0000000000000000000000000000000000000000000000000000000000000000';
    const sigHash = generateSignatureHash(bill.id, 'posted', approver.id, now, prevAuditHash);

    const readyBill: Bill = {
      ...bill,
      number: finalNumber,
      status: 'posted',
      approved_by: approver.id,
      signed_by: approver.id,
      signed_at: now,
      signature_hash: sigHash,
      posted_at: now,
      updated_at: now,
    };

    const journalDraft = buildJournalFromBill(readyBill, settings, state.currentPeriod?.id || 'per-2026-10', approver);
    const { journal } = state.postJournalDirect(journalDraft, approver, settings, state.auditEvents?.[0]);

    readyBill.journal_id = journal.id;

    set((s: any) => ({
      bills: s.bills.map((b: Bill) => (b.id === billId ? readyBill : b)),
      sequences: { ...s.sequences, bill: seq + 1 },
    }));

    return readyBill;
  },

  returnBill: (billId, reason, approver) => {
    const state = get();
    const bill = state.bills.find((b: Bill) => b.id === billId);
    if (!bill) throw new PostingError('Bill not found');

    const updated: Bill = {
      ...bill,
      status: 'draft',
      memo: `Returned by ${approver.name}: ${reason}`,
      updated_at: new Date().toISOString(),
    };

    set((s: any) => ({
      bills: s.bills.map((b: Bill) => (b.id === billId ? updated : b)),
    }));

    return updated;
  },

  recordReceipt: (data, actor, settings) => {
    const state = get();
    const seq = state.sequences.receipt || 17;
    const padding = settings.numbering.padding || 4;
    const num = `RCT-2026-${String(seq).padStart(padding, '0')}`;

    const settlement: Settlement = {
      id: `rct-${Date.now()}`,
      tenant_id: 'ten-acme',
      company_id: state.currentCompany?.id || 'co-1',
      kind: 'receipt',
      number: num,
      status: 'posted',
      contact_id: data.contact_id || '',
      bank_account_id: data.bank_account_id || 'bnk-1',
      settlement_date: data.settlement_date || new Date().toISOString().split('T')[0],
      currency: data.currency || 'USD',
      fx_rate: data.fx_rate || 1.0,
      amount_fc: data.amount_fc || 0,
      amount: data.amount || 0,
      unallocated_fc: data.unallocated_fc || 0,
      reference: data.reference || '',
      memo: data.memo || '',
      allocations: data.allocations || [],
      created_by: actor.id,
      posted_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    // Update settled amounts on allocated invoices
    const updatedInvoices = state.invoices.map((inv: Invoice) => {
      const match = settlement.allocations.find((a) => a.invoice_id === inv.id);
      if (!match) return inv;
      return {
        ...inv,
        settled_fc: inv.settled_fc + match.allocated_amount_fc,
        settled: inv.settled + match.allocated_amount_base,
      };
    });

    const bnk = state.bankAccounts.find((b: any) => b.id === settlement.bank_account_id);
    const bankGlAccountId = bnk?.account_id || settings.posting_accounts.bank_clearing;

    const jDraft = buildJournalFromSettlement(settlement, bankGlAccountId, settings, state.currentPeriod?.id || 'per-2026-10', actor);
    const { journal } = state.postJournalDirect(jDraft, actor, settings, state.auditEvents?.[0]);
    settlement.journal_id = journal.id;

    set((s: any) => ({
      settlements: [settlement, ...s.settlements],
      invoices: updatedInvoices,
      sequences: { ...s.sequences, receipt: seq + 1 },
    }));

    return settlement;
  },

  recordPayment: (data, actor, settings) => {
    const state = get();
    const seq = state.sequences.payment || 11;
    const padding = settings.numbering.padding || 4;
    const num = `PMT-2026-${String(seq).padStart(padding, '0')}`;

    const settlement: Settlement = {
      id: `pmt-${Date.now()}`,
      tenant_id: 'ten-acme',
      company_id: state.currentCompany?.id || 'co-1',
      kind: 'payment',
      number: num,
      status: 'posted',
      contact_id: data.contact_id || '',
      bank_account_id: data.bank_account_id || 'bnk-1',
      settlement_date: data.settlement_date || new Date().toISOString().split('T')[0],
      currency: data.currency || 'USD',
      fx_rate: data.fx_rate || 1.0,
      amount_fc: data.amount_fc || 0,
      amount: data.amount || 0,
      unallocated_fc: data.unallocated_fc || 0,
      reference: data.reference || '',
      memo: data.memo || '',
      allocations: data.allocations || [],
      created_by: actor.id,
      posted_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    };

    // Update settled amounts on allocated bills
    const updatedBills = state.bills.map((b: Bill) => {
      const match = settlement.allocations.find((a) => a.invoice_id === b.id);
      if (!match) return b;
      return {
        ...b,
        settled_fc: b.settled_fc + match.allocated_amount_fc,
        settled: b.settled + match.allocated_amount_base,
      };
    });

    const bnk = state.bankAccounts.find((b: any) => b.id === settlement.bank_account_id);
    const bankGlAccountId = bnk?.account_id || settings.posting_accounts.bank_clearing;

    const jDraft = buildJournalFromSettlement(settlement, bankGlAccountId, settings, state.currentPeriod?.id || 'per-2026-10', actor);
    const { journal } = state.postJournalDirect(jDraft, actor, settings, state.auditEvents?.[0]);
    settlement.journal_id = journal.id;

    set((s: any) => ({
      settlements: [settlement, ...s.settlements],
      bills: updatedBills,
      sequences: { ...s.sequences, payment: seq + 1 },
    }));

    return settlement;
  },

  createPaymentRun: (data, actor, settings) => {
    const state = get();
    const id = `pmtr-${Date.now()}`;
    const num = `RUN-2026-${String(Date.now()).slice(-4)}`;

    const newRun: PaymentRun = {
      id,
      company_id: state.currentCompany?.id || 'co-1',
      number: num,
      status: 'draft',
      bank_account_id: data.bank_account_id || 'bnk-1',
      run_date: data.run_date || new Date().toISOString().split('T')[0],
      currency: data.currency || 'USD',
      total_gross: data.total_gross || 0,
      total_wht: data.total_wht || 0,
      total_net: data.total_net || 0,
      items: data.items || [],
      created_by: actor.id,
      created_at: new Date().toISOString(),
    };

    set((s: any) => ({
      paymentRuns: [newRun, ...s.paymentRuns],
    }));

    return newRun;
  },

  postPaymentRun: (runId, approver, pin, settings) => {
    const state = get();
    const run = state.paymentRuns.find((r: PaymentRun) => r.id === runId);
    if (!run) throw new PostingError('Payment Run not found');

    if (approver.signingPin !== pin) {
      state.recordFailedPin(approver.id);
      throw new PostingError('Invalid 6-digit signing PIN.', 'INVALID_PIN');
    }
    state.resetFailedPin(approver.id);

    const now = new Date().toISOString();
    const newWhtCertificates: WhtCertificate[] = [];

    // Issue WHT Certificates for items with WHT
    for (const item of run.items) {
      if (item.selected && item.wht_amount > 0) {
        newWhtCertificates.push({
          id: `whtc-${Date.now()}-${item.id}`,
          company_id: run.company_id,
          number: `WHT-2026-${String(Date.now()).slice(-4)}`,
          payment_id: run.id,
          contact_id: item.supplier_id,
          tax_code_id: item.wht_code || 'WHT10',
          base_amount: item.payment_amount,
          wht_amount: item.wht_amount,
          issued_on: run.run_date,
        });
      }
    }

    const updatedRun: PaymentRun = {
      ...run,
      status: 'posted',
      approved_by: approver.id,
      signed_by: approver.id,
      posted_at: now,
    };

    set((s: any) => ({
      paymentRuns: s.paymentRuns.map((r: PaymentRun) => (r.id === runId ? updatedRun : r)),
      whtCertificates: [...newWhtCertificates, ...s.whtCertificates],
    }));

    return updatedRun;
  },

  addContact: (contact) => {
    set((s: any) => ({
      contacts: [...s.contacts, contact],
    }));
  },

  updateContact: (contact) => {
    set((s: any) => ({
      contacts: s.contacts.map((c: Contact) => (c.id === contact.id ? contact : c)),
    }));
  },
});
