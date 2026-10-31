/**
 * Efficiency round (docs/14_Efficiency_Round.md): items catalogue, bank rules, bank transactions
 * from statement lines, journal approval, bulk approval and recurring invoices.
 *
 * Controls kept intact:
 *   - bank rules only suggest; a person confirms every bank transaction
 *   - bank transactions above the journal threshold wait for an approver (maker ≠ checker)
 *   - bulk approval checks the PIN once, then approves each document on its own rules
 *   - recurring schedules create invoices awaiting approval; nothing posts by itself
 */
import { StateCreator } from 'zustand';
import type {
  BankRule,
  BankStatementLine,
  BankTransactionInput,
  BankTransactionResult,
  BulkApprovalResult,
  BulkApprovalTarget,
  CompanySettings,
  Invoice,
  Item,
  Journal,
  RecurringSchedule,
  User,
} from '@/types';
import { mockBankRules, mockItems, mockRecurringSchedules } from '@/mock/data';
import { buildBankTransaction, matchBankRule } from '@/mock/BankTransactions';
import { executePostJournal, PostingContext, PostingError } from '@/mock/PostingRules';

export interface AutomationSlice {
  items: Item[];
  bankRules: BankRule[];
  recurringSchedules: RecurringSchedule[];

  addItem: (item: Item) => void;
  updateItem: (id: string, patch: Partial<Item>) => void;

  addBankRule: (rule: Omit<BankRule, 'id' | 'times_applied'>) => BankRule;
  updateBankRule: (id: string, patch: Partial<BankRule>) => void;
  deleteBankRule: (id: string) => void;
  /** The bank rule that would code this line, if any (suggestion only). */
  ruleSuggestionFor: (lineId: string) => BankRule | undefined;

  createBankTransaction: (input: BankTransactionInput, actor: User, settings: CompanySettings) => BankTransactionResult;

  submitJournalForApproval: (journalId: string, actor: User) => Journal;
  approveJournal: (journalId: string, approver: User, pin: string, settings: CompanySettings) => Journal;
  returnJournal: (journalId: string, reason: string, approver: User) => Journal;

  bulkApprove: (targets: BulkApprovalTarget[], approver: User, pin: string, settings: CompanySettings) => BulkApprovalResult[];

  addRecurringSchedule: (schedule: Omit<RecurringSchedule, 'id' | 'generated_invoice_ids' | 'created_at'>) => RecurringSchedule;
  setRecurringActive: (id: string, active: boolean) => void;
  /** Creates every invoice due up to `asOf` and submits each for approval. */
  runRecurringSchedules: (asOf: string) => Invoice[];
}

const addMonths = (date: string, months: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};
const addDays = (date: string, days: number) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

export const createAutomationSlice: StateCreator<any, [], [], AutomationSlice> = (set, get) => ({
  items: [...mockItems],
  bankRules: [...mockBankRules],
  recurringSchedules: [...mockRecurringSchedules],

  addItem: (item) => set((s: any) => ({ items: [item, ...s.items] })),
  updateItem: (id, patch) =>
    set((s: any) => ({ items: s.items.map((i: Item) => (i.id === id ? { ...i, ...patch } : i)) })),

  addBankRule: (rule) => {
    const created: BankRule = { ...rule, id: `rule-${Date.now()}`, times_applied: 0 };
    set((s: any) => ({ bankRules: [...s.bankRules, created] }));
    return created;
  },
  updateBankRule: (id, patch) =>
    set((s: any) => ({ bankRules: s.bankRules.map((r: BankRule) => (r.id === id ? { ...r, ...patch } : r)) })),
  deleteBankRule: (id) => set((s: any) => ({ bankRules: s.bankRules.filter((r: BankRule) => r.id !== id) })),

  ruleSuggestionFor: (lineId) => {
    const { bankStatementLines, bankRules } = get();
    const line = bankStatementLines.find((l: BankStatementLine) => l.id === lineId);
    return line && line.status === 'unmatched' ? matchBankRule(line, bankRules) : undefined;
  },

  createBankTransaction: (input, actor, settings) => {
    const state = get();
    const line: BankStatementLine | undefined = state.bankStatementLines.find((l: BankStatementLine) => l.id === input.lineId);
    if (!line) throw new PostingError('Bank line not found.', 'line_not_found', 'lineId');

    const draft = buildBankTransaction(line, input, {
      accounts: state.accounts,
      bankAccounts: state.bankAccounts,
      taxCodes: state.taxCodes,
      periods: state.periods,
    });
    const id = `jrn-bt-${line.id}-${Date.now()}`;
    const bumpRule = () =>
      input.ruleId &&
      set((s: any) => ({
        bankRules: s.bankRules.map((r: BankRule) => (r.id === input.ruleId ? { ...r, times_applied: r.times_applied + 1 } : r)),
      }));

    const threshold = settings.approval_workflows?.journal_threshold ?? Number.POSITIVE_INFINITY;
    if (draft.gross > threshold) {
      const now = new Date().toISOString();
      const pending: Journal = {
        id,
        tenant_id: 'ten-acme',
        company_id: state.currentCompany?.id || 'co-1',
        fiscal_period_id: draft.fiscal_period_id,
        journal_type: draft.journal_type,
        number: null,
        status: 'pending_approval',
        journal_date: draft.journal_date,
        reference: draft.reference,
        memo: draft.memo,
        source_type: draft.source_type,
        source_id: draft.source_id,
        total_debit: draft.gross,
        total_credit: draft.gross,
        lines: draft.lines,
        created_by: actor.id,
        submitted_by: actor.id,
        version: 1,
        created_at: now,
        updated_at: now,
      };
      set((s: any) => ({
        journals: [pending, ...s.journals],
        bankStatementLines: s.bankStatementLines.map((l: BankStatementLine) =>
          l.id === line.id ? { ...l, pending_journal_id: id } : l,
        ),
      }));
      bumpRule();
      return { journal: pending, outcome: 'pending_approval' };
    }

    const { journal } = state.postJournalDirect(
      { ...draft, id, created_by: actor.id },
      actor,
      settings,
      state.auditEvents?.[0],
    );
    const bankAccountId = state.bankAccounts.find((b: any) => b.id === line.bank_account_id)?.account_id;
    const bankLine = journal.lines.find((l: any) => l.account_id === bankAccountId);
    state.matchLine(line.id, journal.id, 'journal', bankLine?.id);
    bumpRule();
    return { journal, outcome: 'posted' };
  },

  submitJournalForApproval: (journalId, actor) => {
    const j: Journal | undefined = get().journals.find((x: Journal) => x.id === journalId);
    if (!j) throw new PostingError('Journal not found.', 'journal_not_found', 'journalId');
    if (j.status !== 'draft') throw new PostingError('Only drafts can be submitted.', 'invalid_state', 'journalId');
    const updated: Journal = { ...j, status: 'pending_approval', submitted_by: actor.id, updated_at: new Date().toISOString() };
    set((s: any) => ({ journals: s.journals.map((x: Journal) => (x.id === journalId ? updated : x)) }));
    return updated;
  },

  approveJournal: (journalId, approver, pin, settings) => {
    const state = get();
    const j: Journal | undefined = state.journals.find((x: Journal) => x.id === journalId);
    if (!j) throw new PostingError('Journal not found.', 'journal_not_found', 'journalId');
    if (j.status !== 'pending_approval') {
      throw new PostingError('This journal is not waiting for approval.', 'invalid_state', 'journalId');
    }
    if (j.created_by === approver.id || j.submitted_by === approver.id) {
      throw new PostingError(
        'Segregation of Duties violation: The creator of a document cannot approve it (Four-Eyes Principle).',
        'MAKER_CANNOT_APPROVE',
      );
    }
    if (approver.signingPin !== pin) {
      state.recordFailedPin(approver.id);
      throw new PostingError('Invalid 6-digit signing PIN.', 'INVALID_PIN');
    }
    state.resetFailedPin(approver.id);

    const context: PostingContext = {
      periods: state.periods,
      accounts: state.accounts,
      settings,
      sequences: state.sequences,
      lastAuditEvent: state.auditEvents?.[0],
      currentUser: approver,
    };
    const { journal, auditEvent, nextSequence } = executePostJournal({ ...j, approved_by: approver.id }, context);
    const posted: Journal = { ...journal, approved_by: approver.id };

    set((s: any) => ({
      journals: s.journals.map((x: Journal) => (x.id === journalId ? posted : x)),
      sequences: { ...s.sequences, journal: nextSequence },
      linesVersion: (s.linesVersion || 0) + 1,
      auditEvents: [auditEvent, ...(s.auditEvents || [])],
    }));

    // A bank transaction waiting on this journal is matched once it posts.
    const waiting = get().bankStatementLines.find((l: BankStatementLine) => l.pending_journal_id === journalId);
    if (waiting) {
      const bankAccountId = state.bankAccounts.find((b: any) => b.id === waiting.bank_account_id)?.account_id;
      const bankLine = posted.lines.find((l) => l.account_id === bankAccountId);
      set((s: any) => ({
        bankStatementLines: s.bankStatementLines.map((l: BankStatementLine) =>
          l.id === waiting.id ? { ...l, pending_journal_id: undefined } : l,
        ),
      }));
      get().matchLine(waiting.id, posted.id, 'journal', bankLine?.id);
    }
    return posted;
  },

  returnJournal: (journalId, reason, approver) => {
    const j: Journal | undefined = get().journals.find((x: Journal) => x.id === journalId);
    if (!j) throw new PostingError('Journal not found.', 'journal_not_found', 'journalId');
    if (j.status !== 'pending_approval') {
      throw new PostingError('This journal is not waiting for approval.', 'invalid_state', 'journalId');
    }
    const updated: Journal = {
      ...j,
      status: 'draft',
      memo: reason ? `${j.memo} (returned by ${approver.name}: ${reason})` : j.memo,
      updated_at: new Date().toISOString(),
    };
    set((s: any) => ({
      journals: s.journals.map((x: Journal) => (x.id === journalId ? updated : x)),
      // A returned bank transaction frees its bank line again.
      bankStatementLines: s.bankStatementLines.map((l: BankStatementLine) =>
        l.pending_journal_id === journalId ? { ...l, pending_journal_id: undefined } : l,
      ),
    }));
    return updated;
  },

  bulkApprove: (targets, approver, pin, settings) => {
    const state = get();
    const current: User = state.users?.find((u: User) => u.id === approver.id) ?? approver;
    if (current.signingLockoutUntil && new Date(current.signingLockoutUntil).getTime() > Date.now()) {
      throw new PostingError('Signing is paused after too many wrong PINs. Try again shortly.', 'PIN_LOCKED', 423);
    }
    if (current.signingPin !== pin) {
      state.recordFailedPin(current.id);
      throw new PostingError('Invalid 6-digit signing PIN.', 'INVALID_PIN');
    }

    return targets.map((target): BulkApprovalResult => {
      try {
        const s = get();
        const doc =
          target.type === 'invoice'
            ? s.approveInvoice(target.id, current, pin, settings)
            : target.type === 'bill'
            ? s.approveBill(target.id, current, pin, settings)
            : s.approveJournal(target.id, current, pin, settings);
        return { target, ok: true, number: doc.number };
      } catch (e) {
        return { target, ok: false, reason: e instanceof Error ? e.message : String(e) };
      }
    });
  },

  addRecurringSchedule: (schedule) => {
    const created: RecurringSchedule = {
      ...schedule,
      id: `rec-${Date.now()}`,
      generated_invoice_ids: [],
      created_at: new Date().toISOString(),
    };
    set((s: any) => ({ recurringSchedules: [...s.recurringSchedules, created] }));
    return created;
  },
  setRecurringActive: (id, active) =>
    set((s: any) => ({
      recurringSchedules: s.recurringSchedules.map((r: RecurringSchedule) => (r.id === id ? { ...r, is_active: active } : r)),
    })),

  runRecurringSchedules: (asOf) => {
    const created: Invoice[] = [];
    for (const schedule of get().recurringSchedules as RecurringSchedule[]) {
      if (!schedule.is_active) continue;
      let next = schedule.next_date;
      const ids: string[] = [];
      while (next <= asOf && (!schedule.end_date || next <= schedule.end_date)) {
        const s = get();
        const template: Invoice | undefined = s.invoices.find((i: Invoice) => i.id === schedule.template_invoice_id);
        const owner: User | undefined = s.users?.find((u: User) => u.id === schedule.owner_id);
        const contact = s.contacts?.find((c: any) => c.id === schedule.contact_id);
        if (!template || !owner) break;
        const stamp = `${schedule.id}-${next}`;
        const draft = s.saveInvoiceDraft(
          {
            id: `inv-${stamp}`,
            kind: 'sales_invoice',
            status: 'draft',
            contact_id: schedule.contact_id,
            issue_date: next,
            due_date: addDays(next, contact?.payment_terms_days ?? 30),
            currency: template.currency,
            fx_rate: template.fx_rate,
            reference: template.reference,
            memo: template.memo,
            lines: template.lines.map((l, i) => ({ ...l, id: `ln-${stamp}-${i + 1}` })),
            subtotal_fc: template.subtotal_fc,
            tax_total_fc: template.tax_total_fc,
            total_fc: template.total_fc,
            subtotal: template.subtotal,
            tax_total: template.tax_total,
            total: template.total,
          },
          owner,
        );
        created.push(s.submitInvoiceForApproval(draft.id, owner));
        ids.push(draft.id);
        next = addMonths(next, schedule.frequency === 'quarterly' ? 3 : 1);
      }
      if (ids.length) {
        set((st: any) => ({
          recurringSchedules: st.recurringSchedules.map((r: RecurringSchedule) =>
            r.id === schedule.id ? { ...r, next_date: next, generated_invoice_ids: [...r.generated_invoice_ids, ...ids] } : r,
          ),
        }));
      }
    }
    return created;
  },
});
