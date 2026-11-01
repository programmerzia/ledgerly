/**
 * Documents slice: Handles invoices, bills, receipts, payments, and payment runs.
 * Invariant: Every posting action strictly passes through executePostJournal.
 * Invariant: Four-Eyes Principle: Maker can never approve or sign their own document.
 */

import { BUSINESS_TODAY } from '@/lib/docStatus';
import { seedJournalIdByDocument } from '@/mock/seedLedger';
import { StateCreator } from 'zustand';
import {
  Invoice,
  InvoiceLine,
  Bill,
  Journal,
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
  buildJournalFromCreditNote,
  buildJournalFromDebitNote,
  buildJournalFromSettlement,
  executePostJournal,
  PostingError,
  realisedFx,
} from '@/mock/PostingRules';
import { roundHalfUp } from '@/lib/format';
import { generateSignatureHash } from '@/lib/hash';


/** Link seeded documents to the journal that backs them (see mock/seedLedger.ts). */
function withSeedJournal<T extends { id: string; journal_id?: string }>(doc: T): T {
  const journalId = seedJournalIdByDocument[doc.id];
  return journalId && !doc.journal_id ? { ...doc, journal_id: journalId } : { ...doc };
}

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
  reverseInvoice: (invoiceId: string, reason: string, actor: User, settings: CompanySettings, pin?: string) => { original: Invoice; reversal: Invoice };
  duplicateInvoice: (invoiceId: string, actor: User) => Invoice;
  createCreditNoteFromInvoice: (invoiceId: string, actor: User) => Invoice;

  // Bill Actions
  saveBillDraft: (bill: Partial<Bill>, actor: User) => Bill;
  submitBillForApproval: (billId: string, actor: User) => Bill;
  approveBill: (billId: string, approver: User, pin: string, settings: CompanySettings) => Bill;
  returnBill: (billId: string, reason: string, approver: User) => Bill;
  reverseBill: (billId: string, reason: string, actor: User, settings: CompanySettings, pin?: string) => { original: Bill; reversal: Bill };
  duplicateBill: (billId: string, actor: User) => Bill;
  createDebitNoteFromBill: (billId: string, actor: User) => Bill;

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
  invoices: mockInvoices.map((d) => withSeedJournal(d)),
  bills: mockBills.map((d) => withSeedJournal(d)),
  settlements: mockSettlements.map((d) => withSeedJournal(d)),
  paymentRuns: [...mockPaymentRuns],
  whtCertificates: [...mockWhtCertificates],
  contacts: [...mockContacts],

  saveInvoiceDraft: (data, actor) => {
    const state = get();
    const id = data.id || `inv-${Date.now()}`;
    const existing = state.invoices.find((i: Invoice) => i.id === id);

    // 0.11 Optimistic locking
    if (
      existing &&
      data.version !== undefined &&
      existing.version !== undefined &&
      data.version < existing.version
    ) {
      throw new PostingError(
        'Version conflict: invoice draft was modified in another tab.',
        'version_conflict',
        409,
        [{ code: 'version_conflict', message: 'Version conflict: invoice draft was modified in another tab.' }]
      );
    }

    const nextVersion = (existing?.version || 0) + 1;
    // 0.10: Drafts have no number
    const num = data.status === 'draft' || !data.number ? null : data.number;

    const newInv: Invoice = {
      id,
      tenant_id: 'ten-acme',
      company_id: state.currentCompany?.id || 'co-1',
      kind: data.kind || 'sales_invoice',
      number: num,
      status: data.status || 'draft',
      contact_id: data.contact_id || '',
      issue_date: data.issue_date || BUSINESS_TODAY,
      due_date: data.due_date || BUSINESS_TODAY,
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
      created_by: existing?.created_by || actor.id,
      version: nextVersion,
      created_at: existing?.created_at || new Date().toISOString(),
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

    // Assign final gapless number (0.10: INV-FY2026-00001)
    const seq = state.sequences.invoice || 1;
    const padding = settings.numbering?.padding || 5;
    const finalNumber = `INV-FY2026-${String(seq).padStart(padding, '0')}`;

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
      version: (inv.version || 0) + 1,
      updated_at: now,
    };

    // Build and post journal directly through central PostingRules
    const journalDraft = (readyInvoice.kind === 'credit_note' ? buildJournalFromCreditNote : buildJournalFromInvoice)(readyInvoice, settings, state.currentPeriod?.id || 'per-2026-10', approver);
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

  reverseInvoice: (invoiceId, reason, actorOrPin, maybeSettings, maybePin) => {
    const state = get();
    const inv = state.invoices.find((i: Invoice) => i.id === invoiceId);
    if (!inv) throw new PostingError('Invoice not found');
    if (inv.status !== 'posted') throw new PostingError(`Cannot reverse invoice in status '${inv.status}'`);
    if (inv.reversed_by_id) throw new PostingError('Invoice has already been reversed');

    const actor =
      actorOrPin && typeof actorOrPin === 'object' && 'signingPin' in actorOrPin
        ? actorOrPin
        : state.currentUser;
    const settings =
      maybeSettings && typeof maybeSettings === 'object' && 'numbering' in maybeSettings
        ? maybeSettings
        : state.companySettings;
    const pin = typeof actorOrPin === 'string' ? actorOrPin : maybePin;

    if (pin && actor.signingPin && actor.signingPin !== pin) {
      throw new PostingError('Invalid signing PIN', 'INVALID_PIN');
    }

    // Reverse associated journal in general ledger to restore Trial Balance
    let targetJournal = inv.journal_id ? state.journals.find((j: Journal) => j.id === inv.journal_id) : null;
    if (!targetJournal) {
      targetJournal = state.journals.find(
        (j: Journal) =>
          (j.reference?.includes(inv.number || '') || j.memo?.includes(inv.number || '')) &&
          j.status === 'posted' &&
          !j.reversed_by_id
      );
    }

    if (targetJournal && targetJournal.status === 'posted' && !targetJournal.reversed_by_id) {
      state.reverseJournal(targetJournal.id, reason, actor, settings, state.auditEvents?.[0]);
    } else {
      const revLines = [
        {
          id: `jl-rev-ar-${Date.now()}`,
          line_no: 1,
          account_id: 'acc-1200',
          description: `Reversal of ${inv.number}`,
          debit: 0,
          credit: inv.total,
        },
        {
          id: `jl-rev-rev-${Date.now()}`,
          line_no: 2,
          account_id: 'acc-4000',
          description: `Reversal of ${inv.number}`,
          debit: inv.subtotal,
          credit: 0,
        },
        ...(inv.tax_total > 0
          ? [
              {
                id: `jl-rev-vat-${Date.now()}`,
                line_no: 3,
                account_id: 'acc-2100',
                description: `Reversal of ${inv.number}`,
                debit: inv.tax_total,
                credit: 0,
              },
            ]
          : []),
      ];
      const jDraft = {
        journal_date: BUSINESS_TODAY,
        fiscal_period_id: state.currentPeriod?.id || 'per-2026-10',
        source_type: 'sales_invoice',
        reference: `REV-${inv.number}`,
        memo: `Reversal of ${inv.number}: ${reason}`,
        lines: revLines,
      };
      state.postJournalDirect(jDraft, actor, settings, state.auditEvents?.[0]);
    }

    const seq = state.sequences.invoice || 44;
    const padding = settings.numbering?.padding || 4;
    const revNumber = `REV-INV-2026-${String(seq).padStart(padding, '0')}`;
    const now = new Date().toISOString();

    const revInvoice: Invoice = {
      ...inv,
      id: `inv-rev-${Date.now()}`,
      number: revNumber,
      status: 'posted',
      reversal_of_id: inv.id,
      reference: `Reversal of ${inv.number}: ${reason}`,
      memo: `Reversal of ${inv.number}. Reason: ${reason}`,
      created_by: actor.id,
      approved_by: actor.id,
      created_at: now,
      updated_at: now,
      total: -inv.total,
      total_fc: -inv.total_fc,
      subtotal: -inv.subtotal,
      subtotal_fc: -inv.subtotal_fc,
      tax_total: -inv.tax_total,
      tax_total_fc: -inv.tax_total_fc,
      lines: inv.lines.map((l: InvoiceLine) => ({
        ...l,
        id: `line-rev-${Date.now()}-${l.line_no}`,
        line_total_fc: -l.line_total_fc,
        tax_amount_fc: -l.tax_amount_fc,
        quantity: -l.quantity,
      })),
    };

    const updatedTarget: Invoice = {
      ...inv,
      status: 'reversed',
      reversed_by_id: revInvoice.id,
      updated_at: now,
    };

    set((s: any) => ({
      invoices: [revInvoice, ...s.invoices.map((i: Invoice) => (i.id === inv.id ? updatedTarget : i))],
      sequences: { ...s.sequences, invoice: seq + 1 },
      linesVersion: (s.linesVersion || 1) + 1,
    }));

    return { original: updatedTarget, reversal: revInvoice };
  },

  duplicateInvoice: (invoiceId, actor) => {
    const state = get();
    const inv = state.invoices.find((i: Invoice) => i.id === invoiceId);
    if (!inv) throw new PostingError('Invoice not found');
    const seq = state.sequences.invoice || 44;
    const newInv: Invoice = {
      ...inv,
      id: `inv-dup-${Date.now()}`,
      number: `DRAFT-${String(seq).padStart(4, '0')}`,
      status: 'draft',
      issue_date: BUSINESS_TODAY,
      due_date: new Date(new Date(BUSINESS_TODAY).getTime() + 30 * 86400000).toISOString().split('T')[0],
      reference: `Copy of ${inv.number || 'Draft'}`,
      created_by: actor.id,
      submitted_by: undefined,
      approved_by: undefined,
      signed_by: undefined,
      signed_at: undefined,
      signature_hash: undefined,
      posted_at: undefined,
      reversed_by_id: undefined,
      reversal_of_id: undefined,
      journal_id: undefined,
      settled: 0,
      settled_fc: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    set((s: any) => ({
      invoices: [newInv, ...s.invoices],
      sequences: { ...s.sequences, invoice: seq + 1 },
    }));
    return newInv;
  },

  createCreditNoteFromInvoice: (invoiceId, actor) => {
    const state = get();
    const inv = state.invoices.find((i: Invoice) => i.id === invoiceId);
    if (!inv) throw new PostingError('Invoice not found');
    const seq = state.sequences.invoice || 44;
    const cn: Invoice = {
      ...inv,
      id: `cn-${Date.now()}`,
      kind: 'credit_note',
      number: `CN-DRAFT-${String(seq).padStart(4, '0')}`,
      status: 'draft',
      related_invoice_id: inv.id,
      issue_date: BUSINESS_TODAY,
      due_date: BUSINESS_TODAY,
      reference: `Credit Note against ${inv.number || 'Invoice'}`,
      memo: `Credit Note referencing ${inv.number || 'Invoice'}`,
      created_by: actor.id,
      submitted_by: undefined,
      approved_by: undefined,
      signed_by: undefined,
      signed_at: undefined,
      signature_hash: undefined,
      posted_at: undefined,
      reversed_by_id: undefined,
      reversal_of_id: undefined,
      journal_id: undefined,
      settled: 0,
      settled_fc: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    set((s: any) => ({
      invoices: [cn, ...s.invoices],
      sequences: { ...s.sequences, invoice: seq + 1 },
    }));
    return cn;
  },

  saveBillDraft: (data, actor) => {
    const state = get();
    const id = data.id || `bill-${Date.now()}`;
    const existing = state.bills.find((b: Bill) => b.id === id);

    // 0.11 Optimistic locking
    if (
      existing &&
      data.version !== undefined &&
      existing.version !== undefined &&
      data.version < existing.version
    ) {
      throw new PostingError(
        'Version conflict: bill draft was modified in another tab.',
        'version_conflict',
        409,
        [{ code: 'version_conflict', message: 'Version conflict: bill draft was modified in another tab.' }]
      );
    }

    const nextVersion = (existing?.version || 0) + 1;
    // 0.10: Drafts have no number
    const num = data.status === 'draft' || !data.number ? null : data.number;

    const newBill: Bill = {
      id,
      tenant_id: 'ten-acme',
      company_id: state.currentCompany?.id || 'co-1',
      kind: data.kind || 'purchase_bill',
      number: num,
      status: data.status || 'draft',
      contact_id: data.contact_id || '',
      issue_date: data.issue_date || BUSINESS_TODAY,
      due_date: data.due_date || BUSINESS_TODAY,
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
      created_by: existing?.created_by || actor.id,
      version: nextVersion,
      created_at: existing?.created_at || new Date().toISOString(),
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

    // Assign final gapless number (0.10: BILL-FY2026-00001)
    const seq = state.sequences.bill || 1;
    const padding = settings.numbering?.padding || 5;
    const finalNumber = `BILL-FY2026-${String(seq).padStart(padding, '0')}`;

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
      version: (bill.version || 0) + 1,
      updated_at: now,
    };

    const journalDraft = (readyBill.kind === 'debit_note' ? buildJournalFromDebitNote : buildJournalFromBill)(readyBill, settings, state.currentPeriod?.id || 'per-2026-10', approver);
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

  reverseBill: (billId, reason, actorOrPin, maybeSettings, maybePin) => {
    const state = get();
    const bill = state.bills.find((b: Bill) => b.id === billId);
    if (!bill) throw new PostingError('Bill not found');
    if (bill.status !== 'posted') throw new PostingError(`Cannot reverse bill in status '${bill.status}'`);
    if (bill.reversed_by_id) throw new PostingError('Bill has already been reversed');

    const actor =
      actorOrPin && typeof actorOrPin === 'object' && 'signingPin' in actorOrPin
        ? actorOrPin
        : state.currentUser;
    const settings =
      maybeSettings && typeof maybeSettings === 'object' && 'numbering' in maybeSettings
        ? maybeSettings
        : state.companySettings;
    const pin = typeof actorOrPin === 'string' ? actorOrPin : maybePin;

    if (pin && actor.signingPin && actor.signingPin !== pin) {
      throw new PostingError('Invalid signing PIN', 'INVALID_PIN');
    }

    let targetJournal = bill.journal_id ? state.journals.find((j: Journal) => j.id === bill.journal_id) : null;
    if (!targetJournal) {
      targetJournal = state.journals.find(
        (j: Journal) =>
          (j.reference?.includes(bill.number || '') || j.memo?.includes(bill.number || '')) &&
          j.status === 'posted' &&
          !j.reversed_by_id
      );
    }

    if (targetJournal && targetJournal.status === 'posted' && !targetJournal.reversed_by_id) {
      state.reverseJournal(targetJournal.id, reason, actor, settings, state.auditEvents?.[0]);
    } else {
      const revLines = [
        {
          id: `jl-rev-ap-${Date.now()}`,
          line_no: 1,
          account_id: 'acc-2000',
          description: `Reversal of ${bill.number}`,
          debit: bill.total,
          credit: 0,
        },
        {
          id: `jl-rev-exp-${Date.now()}`,
          line_no: 2,
          account_id: 'acc-5000',
          description: `Reversal of ${bill.number}`,
          debit: 0,
          credit: bill.subtotal,
        },
        ...(bill.tax_total > 0
          ? [
              {
                id: `jl-rev-vat-in-${Date.now()}`,
                line_no: 3,
                account_id: 'acc-1300',
                description: `Reversal of ${bill.number}`,
                debit: 0,
                credit: bill.tax_total,
              },
            ]
          : []),
      ];
      const jDraft = {
        journal_date: BUSINESS_TODAY,
        fiscal_period_id: state.currentPeriod?.id || 'per-2026-10',
        source_type: 'purchase_bill',
        reference: `REV-${bill.number}`,
        memo: `Reversal of ${bill.number}: ${reason}`,
        lines: revLines,
      };
      state.postJournalDirect(jDraft, actor, settings, state.auditEvents?.[0]);
    }

    const seq = state.sequences.bill || 16;
    const padding = settings.numbering?.padding || 4;
    const revNumber = `REV-BILL-2026-${String(seq).padStart(padding, '0')}`;
    const now = new Date().toISOString();

    const revBill: Bill = {
      ...bill,
      id: `bill-rev-${Date.now()}`,
      number: revNumber,
      status: 'posted',
      reversal_of_id: bill.id,
      reference: `Reversal of ${bill.number}: ${reason}`,
      memo: `Reversal of ${bill.number}. Reason: ${reason}`,
      created_by: actor.id,
      approved_by: actor.id,
      created_at: now,
      updated_at: now,
      total: -bill.total,
      total_fc: -bill.total_fc,
      subtotal: -bill.subtotal,
      subtotal_fc: -bill.subtotal_fc,
      tax_total: -bill.tax_total,
      tax_total_fc: -bill.tax_total_fc,
      lines: bill.lines.map((l: InvoiceLine) => ({
        ...l,
        id: `line-rev-${Date.now()}-${l.line_no}`,
        line_total_fc: -l.line_total_fc,
        tax_amount_fc: -l.tax_amount_fc,
        quantity: -l.quantity,
      })),
    };

    const updatedTarget: Bill = {
      ...bill,
      status: 'reversed',
      reversed_by_id: revBill.id,
      updated_at: now,
    };

    set((s: any) => ({
      bills: [revBill, ...s.bills.map((b: Bill) => (b.id === bill.id ? updatedTarget : b))],
      sequences: { ...s.sequences, bill: seq + 1 },
      linesVersion: (s.linesVersion || 1) + 1,
    }));

    return { original: updatedTarget, reversal: revBill };
  },

  duplicateBill: (billId, actor) => {
    const state = get();
    const bill = state.bills.find((b: Bill) => b.id === billId);
    if (!bill) throw new PostingError('Bill not found');
    const seq = state.sequences.bill || 16;
    const newBill: Bill = {
      ...bill,
      id: `bill-dup-${Date.now()}`,
      number: `DRAFT-BILL-${String(seq).padStart(4, '0')}`,
      status: 'draft',
      issue_date: BUSINESS_TODAY,
      due_date: new Date(new Date(BUSINESS_TODAY).getTime() + 30 * 86400000).toISOString().split('T')[0],
      reference: `Copy of ${bill.number || 'Draft'}`,
      created_by: actor.id,
      submitted_by: undefined,
      approved_by: undefined,
      signed_by: undefined,
      signed_at: undefined,
      signature_hash: undefined,
      posted_at: undefined,
      reversed_by_id: undefined,
      reversal_of_id: undefined,
      journal_id: undefined,
      settled: 0,
      settled_fc: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    set((s: any) => ({
      bills: [newBill, ...s.bills],
      sequences: { ...s.sequences, bill: seq + 1 },
    }));
    return newBill;
  },

  createDebitNoteFromBill: (billId, actor) => {
    const state = get();
    const bill = state.bills.find((b: Bill) => b.id === billId);
    if (!bill) throw new PostingError('Bill not found');
    const seq = state.sequences.bill || 16;
    const dn: Bill = {
      ...bill,
      id: `dn-${Date.now()}`,
      kind: 'debit_note',
      number: `DN-DRAFT-${String(seq).padStart(4, '0')}`,
      status: 'draft',
      related_invoice_id: bill.id,
      issue_date: BUSINESS_TODAY,
      due_date: BUSINESS_TODAY,
      reference: `Debit Note against ${bill.number || 'Bill'}`,
      memo: `Debit Note referencing ${bill.number || 'Bill'}`,
      created_by: actor.id,
      submitted_by: undefined,
      approved_by: undefined,
      signed_by: undefined,
      signed_at: undefined,
      signature_hash: undefined,
      posted_at: undefined,
      reversed_by_id: undefined,
      reversal_of_id: undefined,
      journal_id: undefined,
      settled: 0,
      settled_fc: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    set((s: any) => ({
      bills: [dn, ...s.bills],
      sequences: { ...s.sequences, bill: seq + 1 },
    }));
    return dn;
  },

  recordReceipt: (data, actor, settings) => {
    const state = get();
    const seq = state.sequences.receipt || 1;
    const padding = settings.numbering?.padding || 5;
    const num = `RCT-FY2026-${String(seq).padStart(padding, '0')}`;

    // 0.8 Currency check: Receipt currency must equal invoice currency
    for (const alloc of data.allocations || []) {
      const inv = state.invoices.find((i: Invoice) => i.id === alloc.invoice_id);
      if (inv && data.currency && inv.currency && data.currency !== inv.currency) {
        throw new PostingError(
          `Allocation currency mismatch: receipt is in ${data.currency} but invoice ${inv.number} is in ${inv.currency}.`,
          'allocation_currency_mismatch',
          422,
          [
            {
              code: 'allocation_currency_mismatch',
              message: `Allocation currency mismatch: receipt is in ${data.currency} but invoice ${inv.number} is in ${inv.currency}.`,
            },
          ]
        );
      }
    }

    // Process allocations with Realised FX (0.8, D4)
    const processedAllocations = (data.allocations || []).map((alloc) => {
      const inv = state.invoices.find((i: Invoice) => i.id === alloc.invoice_id);
      const invoiceRate = inv?.fx_rate || 1.0;
      const settlementRate = data.fx_rate || 1.0;
      const allocFc = alloc.allocated_amount_fc || 0;

      const fx = realisedFx({
        cash_in: true, allocated_fc: allocFc, settlement_rate: settlementRate, invoice_rate: invoiceRate,
        document_total_fc: inv?.total_fc ?? Number.POSITIVE_INFINITY, document_total_base: inv?.total ?? 0,
        settled_fc: inv?.settled_fc ?? 0, settled_base: inv?.settled ?? 0,
      });
      return { ...alloc, allocated_amount_base: fx.carried_base, fx_gain_loss: fx.fx_gain_loss, invoice_fx_rate: invoiceRate };
    });

    const settlement: Settlement = {
      id: `rct-${Date.now()}`,
      tenant_id: 'ten-acme',
      company_id: state.currentCompany?.id || 'co-1',
      kind: 'receipt',
      number: num,
      status: 'posted',
      contact_id: data.contact_id || '',
      bank_account_id: data.bank_account_id || 'bnk-1',
      settlement_date: data.settlement_date || BUSINESS_TODAY,
      currency: data.currency || 'USD',
      fx_rate: data.fx_rate || 1.0,
      amount_fc: data.amount_fc || 0,
      amount: data.amount || 0,
      unallocated_fc: data.unallocated_fc || 0,
      reference: data.reference || '',
      memo: data.memo || '',
      allocations: processedAllocations,
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

    const jDraft = buildJournalFromSettlement(
      settlement,
      bankGlAccountId,
      settings,
      state.currentPeriod?.id || 'per-2026-10',
      actor
    );
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
    const seq = state.sequences.payment || 1;
    const padding = settings.numbering?.padding || 5;
    const num = `PMT-FY2026-${String(seq).padStart(padding, '0')}`;

    // 0.8 Currency check: Payment currency must equal bill currency
    for (const alloc of data.allocations || []) {
      const bill = state.bills.find((b: Bill) => b.id === alloc.invoice_id);
      if (bill && data.currency && bill.currency && data.currency !== bill.currency) {
        throw new PostingError(
          `Allocation currency mismatch: payment is in ${data.currency} but bill ${bill.number} is in ${bill.currency}.`,
          'allocation_currency_mismatch',
          422,
          [
            {
              code: 'allocation_currency_mismatch',
              message: `Allocation currency mismatch: payment is in ${data.currency} but bill ${bill.number} is in ${bill.currency}.`,
            },
          ]
        );
      }
    }

    // Process allocations with Realised FX (0.8, D4)
    const processedAllocations = (data.allocations || []).map((alloc) => {
      const bill = state.bills.find((b: Bill) => b.id === alloc.invoice_id);
      const billRate = bill?.fx_rate || 1.0;
      const settlementRate = data.fx_rate || 1.0;
      const allocFc = alloc.allocated_amount_fc || 0;

      const fx = realisedFx({
        cash_in: false, allocated_fc: allocFc, settlement_rate: settlementRate, invoice_rate: billRate,
        document_total_fc: bill?.total_fc ?? Number.POSITIVE_INFINITY, document_total_base: bill?.total ?? 0,
        settled_fc: bill?.settled_fc ?? 0, settled_base: bill?.settled ?? 0,
      });
      return { ...alloc, allocated_amount_base: fx.carried_base, fx_gain_loss: fx.fx_gain_loss, invoice_fx_rate: billRate };
    });

    const settlement: Settlement = {
      id: `pmt-${Date.now()}`,
      tenant_id: 'ten-acme',
      company_id: state.currentCompany?.id || 'co-1',
      kind: 'payment',
      number: num,
      status: 'posted',
      contact_id: data.contact_id || '',
      bank_account_id: data.bank_account_id || 'bnk-1',
      settlement_date: data.settlement_date || BUSINESS_TODAY,
      currency: data.currency || 'USD',
      fx_rate: data.fx_rate || 1.0,
      amount_fc: data.amount_fc || 0,
      amount: data.amount || 0,
      unallocated_fc: data.unallocated_fc || 0,
      reference: data.reference || '',
      memo: data.memo || '',
      allocations: processedAllocations,
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

    const jDraft = buildJournalFromSettlement(
      settlement,
      bankGlAccountId,
      settings,
      state.currentPeriod?.id || 'per-2026-10',
      actor
    );
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
      run_date: data.run_date || BUSINESS_TODAY,
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
