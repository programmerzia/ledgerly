/**
 * Efficiency round invariants (docs/14_Efficiency_Round.md): bank transactions, bank rules,
 * journal approval, bulk approval and recurring invoices keep the ledger rules intact.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { useLedgerStore } from '@/mock/store';
import { matchBankRule, splitGross } from '@/mock/BankTransactions';
import type { BankStatementLine, User } from '@/types';

const state = () => useLedgerStore.getState();
const user = (id: string) => state().users.find((u: User) => u.id === id)!;
const rahim = () => user('usr-1'); // maker
const fatima = () => user('usr-2'); // approver
const line = (id: string) => state().bankStatementLines.find((l: BankStatementLine) => l.id === id)!;

describe('Efficiency round', () => {
  beforeEach(() => {
    useLedgerStore.setState(useLedgerStore.getInitialState());
  });

  it('E1: bank rules suggest by text and direction, first match by priority', () => {
    const fee = line('bsl-5');
    expect(matchBankRule(fee, state().bankRules)?.id).toBe('rule-1');
    expect(matchBankRule({ ...fee, amount: 1500 }, state().bankRules)).toBeUndefined(); // money in
    expect(state().ruleSuggestionFor('bsl-7')?.id).toBe('rule-2');
  });

  it('E1: tax-inclusive split rounds HALF_UP and always sums to gross', () => {
    expect(splitGross(105000, 0.05)).toEqual({ net: 100000, tax: 5000 });
    const { net, tax } = splitGross(1001, 0.05);
    expect(net + tax).toBe(1001);
    expect(splitGross(1500, 0)).toEqual({ net: 1500, tax: 0 });
  });

  it('E1: spend money posts a balanced journal and matches the line', () => {
    const feesBefore = state().balanceOf('acc-6300');
    const bankBefore = state().balanceOf('acc-1010');
    const { journal, outcome } = state().createBankTransaction(
      { lineId: 'bsl-5', kind: 'spend', accountId: 'acc-6300', taxCodeId: 'tax-exempt', ruleId: 'rule-1' },
      rahim(),
      state().companySettings,
    );
    expect(outcome).toBe('posted');
    expect(journal.status).toBe('posted');
    expect(journal.number).toMatch(/^JV-FY2026-\d{5}$/);
    expect(journal.total_debit).toBe(1500);
    expect(journal.total_credit).toBe(1500);
    expect(line('bsl-5').status).toBe('matched');
    expect(line('bsl-5').matched_doc_id).toBe(journal.id);
    expect(state().bankRules.find((r: any) => r.id === 'rule-1').times_applied).toBe(10);
    expect(state().trialBalance().isBalanced).toBe(true);
    expect(state().balanceOf('acc-6300') - feesBefore).toBe(1500);
    expect(bankBefore - state().balanceOf('acc-1010')).toBe(1500);
  });

  it('E1: VAT on spend money goes to VAT input', () => {
    state().addBankStatementLines([
      { ...line('bsl-5'), id: 'bsl-t1', amount: -105000, description: 'LAPTOP PURCHASE', status: 'unmatched' },
    ]);
    const vatInputBefore = state().balanceOf('acc-2110');
    const { journal } = state().createBankTransaction(
      { lineId: 'bsl-t1', kind: 'spend', accountId: 'acc-6400', taxCodeId: 'tax-vat5' },
      rahim(),
      { ...state().companySettings, approval_workflows: { ...state().companySettings.approval_workflows, journal_threshold: 10_000_000 } },
    );
    const vat = journal.lines.find((l) => l.account_id === 'acc-2110')!;
    expect(vat.debit).toBe(5000);
    expect(journal.lines.find((l) => l.account_id === 'acc-6400')!.debit).toBe(100000);
    expect(journal.lines.find((l) => l.account_id === 'acc-1010')!.credit).toBe(105000);
    expect(state().balanceOf('acc-2110') - vatInputBefore).toBe(5000);
  });

  it('E1: rejects control accounts, wrong direction and cross-currency transfers', () => {
    const settings = state().companySettings;
    expect(() =>
      state().createBankTransaction({ lineId: 'bsl-5', kind: 'spend', accountId: 'acc-1200' }, rahim(), settings),
    ).toThrow(expect.objectContaining({ code: 'control_account_not_allowed' }));
    expect(() =>
      state().createBankTransaction({ lineId: 'bsl-5', kind: 'receive', accountId: 'acc-4000' }, rahim(), settings),
    ).toThrow(expect.objectContaining({ code: 'direction_mismatch' }));
    expect(() =>
      state().createBankTransaction({ lineId: 'bsl-5', kind: 'transfer', toBankAccountId: 'bnk-2' }, rahim(), settings),
    ).toThrow(expect.objectContaining({ code: 'transfer_currency_mismatch' }));
    expect(line('bsl-5').status).toBe('unmatched');
  });

  it('E1: closed periods reject bank transactions', () => {
    state().addBankStatementLines([{ ...line('bsl-5'), id: 'bsl-t2', txn_date: '2026-03-15', value_date: '2026-03-15' }]);
    expect(() =>
      state().createBankTransaction({ lineId: 'bsl-t2', kind: 'spend', accountId: 'acc-6300' }, rahim(), state().companySettings),
    ).toThrow();
    expect(line('bsl-t2').status).toBe('unmatched');
  });

  it('E1: above the threshold waits for a second person, then posts and matches', () => {
    const settings = state().companySettings;
    const { journal, outcome } = state().createBankTransaction(
      { lineId: 'bsl-6', kind: 'receive', accountId: 'acc-4100', taxCodeId: 'tax-vat5' },
      rahim(),
      settings,
    );
    expect(outcome).toBe('pending_approval');
    expect(journal.number).toBeNull();
    expect(line('bsl-6').pending_journal_id).toBe(journal.id);
    expect(line('bsl-6').status).toBe('unmatched');
    // A pending line cannot be coded twice.
    expect(() =>
      state().createBankTransaction({ lineId: 'bsl-6', kind: 'receive', accountId: 'acc-4100' }, rahim(), settings),
    ).toThrow(expect.objectContaining({ code: 'line_not_open' }));

    expect(() => state().approveJournal(journal.id, rahim(), rahim().signingPin, settings)).toThrow(
      expect.objectContaining({ code: 'MAKER_CANNOT_APPROVE' }),
    );
    expect(() => state().approveJournal(journal.id, fatima(), '000000', settings)).toThrow(
      expect.objectContaining({ code: 'INVALID_PIN' }),
    );
    const posted = state().approveJournal(journal.id, fatima(), fatima().signingPin, settings);
    expect(posted.status).toBe('posted');
    expect(posted.approved_by).toBe('usr-2');
    expect(line('bsl-6').status).toBe('matched');
    expect(line('bsl-6').pending_journal_id).toBeUndefined();
    expect(state().trialBalance().isBalanced).toBe(true);
  });

  it('E1: returning a pending bank transaction frees the line', () => {
    const { journal } = state().createBankTransaction(
      { lineId: 'bsl-6', kind: 'receive', accountId: 'acc-4100' },
      rahim(),
      state().companySettings,
    );
    state().returnJournal(journal.id, 'Wrong account', fatima());
    expect(line('bsl-6').pending_journal_id).toBeUndefined();
    expect(state().journals.find((j: any) => j.id === journal.id).status).toBe('draft');
  });

  it('E5: bulk approve checks the PIN once and reports each document', () => {
    const settings = state().companySettings;
    const { journal } = state().createBankTransaction(
      { lineId: 'bsl-6', kind: 'receive', accountId: 'acc-4100' },
      fatima(),
      settings,
    );
    const targets = [
      { type: 'invoice' as const, id: 'inv-pending-1' }, // made by Rahim
      { type: 'journal' as const, id: journal.id }, // made by Fatima: she cannot approve it
    ];
    expect(() => state().bulkApprove(targets, fatima(), '000000', settings)).toThrow(
      expect.objectContaining({ code: 'INVALID_PIN' }),
    );
    const results = state().bulkApprove(targets, fatima(), fatima().signingPin, settings);
    expect(results[0]).toMatchObject({ ok: true });
    expect(results[0].number).toBeTruthy();
    expect(results[1].ok).toBe(false);
    expect(results[1].reason).toMatch(/creator of a document cannot approve/i);
    expect(state().trialBalance().isBalanced).toBe(true);
  });

  it('E2: recurring schedules create invoices awaiting approval and never post', () => {
    const journalsBefore = state().journals.length;
    const created = state().runRecurringSchedules('2026-12-31');
    expect(created.map((i) => i.issue_date)).toEqual(['2026-11-05', '2026-12-05']);
    expect(created.every((i) => i.status === 'pending_approval' && i.number === null)).toBe(true);
    expect(created[0].due_date).toBe('2026-12-05'); // Hormuud: Net 30
    expect(state().journals.length).toBe(journalsBefore);
    const schedule = state().recurringSchedules.find((r: any) => r.id === 'rec-1');
    expect(schedule.next_date).toBe('2027-01-05');
    expect(state().runRecurringSchedules('2026-12-31')).toHaveLength(0); // idempotent
  });
});
