import { describe, it, expect, beforeEach } from 'vitest';
import { useLedgerStore } from '../src/mock/store';
import { PostingError, validateJournalDraft, executePostJournal } from '../src/mock/PostingRules';
import { mockUsers, mockAccounts, mockCompanySettings } from '../src/mock/data';
import { Journal } from '../src/types';

describe('Ledger Invariants & Controls (08_Mock_Refactor_Prompt Block A)', () => {
  beforeEach(() => {
    // Reset store to default initial state
    useLedgerStore.setState(useLedgerStore.getInitialState());
  });

  it('1. Journal balancing: Rejects unbalanced draft and accepts balanced draft', () => {
    const store = useLedgerStore.getState();

    const unbalancedDraft: Partial<Journal> = {
      fiscal_period_id: 'per-2026-10',
      lines: [
        {
          id: '1',
          line_no: 1,
          account_id: 'acc-1010',
          debit: 100000,
          credit: 0,
          currency: 'USD',
          fx_rate: 1.0,
          amount_fc: 100000,
          dimensions: {},
          description: 'Debit side',
        },
        {
          id: '2',
          line_no: 2,
          account_id: 'acc-4000',
          debit: 0,
          credit: 80000, // Out of balance by $200.00
          currency: 'USD',
          fx_rate: 1.0,
          amount_fc: -80000,
          dimensions: { branch: 'MG' },
          description: 'Credit side',
        },
      ],
    };

    expect(() => {
      validateJournalDraft(unbalancedDraft, {
        periods: store.periods,
        accounts: store.accounts,
        settings: store.companySettings,
        sequences: store.sequences,
        currentUser: store.currentUser,
      });
    }).toThrowError(/Journal is out of balance/);

    const balancedDraft: Partial<Journal> = {
      fiscal_period_id: 'per-2026-10',
      lines: [
        {
          id: '1',
          line_no: 1,
          account_id: 'acc-1010',
          debit: 100000,
          credit: 0,
          currency: 'USD',
          fx_rate: 1.0,
          amount_fc: 100000,
          dimensions: {},
          description: 'Debit side',
        },
        {
          id: '2',
          line_no: 2,
          account_id: 'acc-4000',
          debit: 0,
          credit: 100000,
          currency: 'USD',
          fx_rate: 1.0,
          amount_fc: -100000,
          dimensions: { branch: 'MG' },
          description: 'Credit side',
        },
      ],
    };

    expect(() => {
      validateJournalDraft(balancedDraft, {
        periods: store.periods,
        accounts: store.accounts,
        settings: store.companySettings,
        sequences: store.sequences,
        currentUser: store.currentUser,
      });
    }).not.toThrow();
  });

  it('2. Gapless numbering: Allocates strictly sequential numbers under 50 posts', () => {
    const store = useLedgerStore.getState();
    const numbers: string[] = [];

    for (let i = 0; i < 50; i++) {
      const draft = {
        fiscal_period_id: 'per-2026-10',
        journal_type: 'manual' as const,
        journal_date: '2026-10-28',
        reference: `BATCH-${i + 1}`,
        memo: `Sequential post test #${i + 1}`,
        total_debit: 10000,
        total_credit: 10000,
        lines: [
          {
            id: `l-${i}-1`,
            line_no: 1,
            account_id: 'acc-1010',
            debit: 10000,
            credit: 0,
            currency: 'USD',
            fx_rate: 1.0,
            amount_fc: 10000,
            dimensions: {},
            description: 'Debit',
          },
          {
            id: `l-${i}-2`,
            line_no: 2,
            account_id: 'acc-6200',
            debit: 0,
            credit: 10000,
            currency: 'USD',
            fx_rate: 1.0,
            amount_fc: -10000,
            dimensions: { branch: 'MG' },
            description: 'Credit',
          },
        ],
      };

      const { journal } = useLedgerStore.getState().postJournalDirect(
        draft,
        mockUsers[0],
        mockCompanySettings,
        useLedgerStore.getState().auditEvents[0]
      );

      numbers.push(journal.number!);
    }

    expect(numbers).toHaveLength(50);
    // Verify each number incremented by exactly 1 without gaps or duplicates
    const sequenceIntegers = numbers.map((n) => parseInt(n.split('-')[2], 10));
    for (let i = 1; i < sequenceIntegers.length; i++) {
      expect(sequenceIntegers[i]).toBe(sequenceIntegers[i - 1] + 1);
    }
  });

  it('3. Closed period rejection: Blocks postings to closed or locked periods', () => {
    const store = useLedgerStore.getState();

    // Sep 2026 is closed in mock data
    const draftInClosedPeriod: Partial<Journal> = {
      fiscal_period_id: 'per-2026-09',
      lines: [
        {
          id: '1',
          line_no: 1,
          account_id: 'acc-1010',
          debit: 5000,
          credit: 0,
          currency: 'USD',
          fx_rate: 1.0,
          amount_fc: 5000,
          dimensions: {},
          description: 'Debit',
        },
        {
          id: '2',
          line_no: 2,
          account_id: 'acc-4000',
          debit: 0,
          credit: 5000,
          currency: 'USD',
          fx_rate: 1.0,
          amount_fc: -5000,
          dimensions: { branch: 'MG' },
          description: 'Credit',
        },
      ],
    };

    expect(() => {
      validateJournalDraft(draftInClosedPeriod, {
        periods: store.periods,
        accounts: store.accounts,
        settings: store.companySettings,
        sequences: store.sequences,
        currentUser: store.currentUser,
      });
    }).toThrowError(/Cannot post to period 'Sep 2026': period is closed/);
  });

  it('4. Maker != Checker: Maker cannot approve their own document', () => {
    const store = useLedgerStore.getState();
    const rahim = mockUsers[0]; // Maker
    const fatima = mockUsers[1]; // Checker

    // Rahim saves and submits an invoice
    const draft = store.saveInvoiceDraft(
      {
        contact_id: 'cnt-1',
        total: 50000,
        subtotal: 50000,
        tax_total: 0,
        total_fc: 50000,
        subtotal_fc: 50000,
        tax_total_fc: 0,
        lines: [
          {
            id: 'l1',
            line_no: 1,
            account_id: 'acc-4000',
            description: 'Item',
            quantity: 1,
            unit_price_fc: 50000,
            discount_pct: 0,
            line_total_fc: 50000,
            tax_amount_fc: 0,
            dimensions: { branch: 'MG' },
          },
        ],
      },
      rahim
    );

    store.submitInvoiceForApproval(draft.id, rahim);

    // Rahim attempts to approve his own invoice -> MUST FAIL
    expect(() => {
      useLedgerStore.getState().approveInvoice(draft.id, rahim, rahim.signingPin, store.companySettings);
    }).toThrowError(/Segregation of Duties violation: The creator of a document cannot approve it/);

    // Fatima approves -> SUCCEEDS
    const approved = useLedgerStore.getState().approveInvoice(draft.id, fatima, fatima.signingPin, store.companySettings);
    expect(approved.status).toBe('posted');
    expect(approved.approved_by).toBe(fatima.id);
  });

  it('5. Trial balance equals sum of posted lines: Debits === Credits', () => {
    const tb = useLedgerStore.getState().trialBalance();
    expect(tb.isBalanced).toBe(true);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    expect(tb.totalDebit).toBeGreaterThan(0);
  });

  it('6. Hash chain verifies: Detects any tampering in audit history', () => {
    const verification = useLedgerStore.getState().verifyAuditChain();
    expect(verification.isValid).toBe(true);
    expect(verification.totalEvents).toBeGreaterThanOrEqual(3);

    // Simulate tampering with an audit event's prev_hash
    const tampered = [...useLedgerStore.getState().auditEvents];
    tampered[1] = { ...tampered[1], prev_hash: 'TAMPERED_PREV_HASH_123456789' };
    useLedgerStore.setState({ auditEvents: tampered });

    const brokenVerification = useLedgerStore.getState().verifyAuditChain();
    expect(brokenVerification.isValid).toBe(false);
    expect(brokenVerification.reason).toContain('Chain breakage');
  });
});
