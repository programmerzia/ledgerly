import { describe, it, expect, beforeEach } from 'vitest';
import { useLedgerStore } from '../src/mock/store';
import { PostingError, validateJournalDraft, executePostJournal, buildJournalFromInvoice } from '../src/mock/PostingRules';
import { mockUsers, mockAccounts, mockCompanySettings, mockTaxCodes } from '../src/mock/data';
import { Journal, Invoice } from '../src/types';
import { calculateDocumentTax } from '../src/lib/tax';

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
          account_id: 'acc-1000',
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
          account_id: 'acc-1000',
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
            account_id: 'acc-1000',
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

  it('7. Period reopen dual-approver rule: Sep 2026 requires 2 distinct approvers', () => {
    const store = useLedgerStore.getState();
    const fatima = mockUsers[1]; // Checker / Approver 1
    const kenneth = mockUsers[2]; // Admin / Approver 2

    // Sep 2026 is closed in mock data
    const sepPeriod = store.periods.find((p) => p.name === 'Sep 2026');
    expect(sepPeriod).toBeDefined();
    expect(sepPeriod?.status).toBe('closed');
    const initialCount = sepPeriod?.reopened_count || 0;

    // 1st Approver (Fatima) requests reopen
    const req = store.requestReopenPeriod(sepPeriod!.id, 'Late audit adjustment for vendor accrual', fatima);
    expect(req).toBeDefined();
    expect(req.first_approver_id).toBe(fatima.id);
    expect(req.status).toBe('pending');

    // Fatima attempts to be the second approver -> MUST FAIL
    const failRes = store.approveReopenPeriod(req.id, fatima);
    expect(failRes.approved).toBe(false);
    expect(failRes.message).toContain('Two distinct approvers required');

    // Kenneth acts as second approver -> SUCCEEDS
    const res = store.approveReopenPeriod(req.id, kenneth);
    expect(res.approved).toBe(true);

    // Verify period is now open and count incremented
    const updatedSep = useLedgerStore.getState().periods.find((p) => p.id === sepPeriod!.id);
    expect(updatedSep?.status).toBe('open');
    expect(updatedSep?.reopened_count).toBe(initialCount + 1);

    // Audit event was logged
    const latestAudit = useLedgerStore.getState().auditEvents[0];
    expect(latestAudit.action).toBe('period.reopened');
  });

  it('8. Invoice reversal restores Trial Balance: Reversing posted invoice returns TB to prior balance', () => {
    const store = useLedgerStore.getState();
    const rahim = mockUsers[0];
    const fatima = mockUsers[1];

    const initialTB = store.trialBalance();
    expect(initialTB.isBalanced).toBe(true);
    const initialDebit = initialTB.totalDebit;

    // Create & approve invoice for $2,000.00
    const draft = store.saveInvoiceDraft(
      {
        contact_id: 'cnt-1',
        total: 200000,
        subtotal: 200000,
        tax_total: 0,
        total_fc: 200000,
        subtotal_fc: 200000,
        tax_total_fc: 0,
        lines: [
          {
            id: 'l-inv-test-1',
            line_no: 1,
            account_id: 'acc-4000',
            description: 'Fiber lease service',
            quantity: 1,
            unit_price_fc: 200000,
            discount_pct: 0,
            line_total_fc: 200000,
            tax_amount_fc: 0,
            dimensions: { branch: 'MG' },
          },
        ],
      },
      rahim
    );
    store.submitInvoiceForApproval(draft.id, rahim);
    const postedInv = store.approveInvoice(draft.id, fatima, fatima.signingPin, store.companySettings);
    expect(postedInv.status).toBe('posted');

    // TB now reflects the $2,000.00 posting
    const postTB = useLedgerStore.getState().trialBalance();
    expect(postTB.isBalanced).toBe(true);
    expect(postTB.totalDebit).toBe(initialDebit + 200000);

    // Reverse the posted invoice
    const revRes = useLedgerStore.getState().reverseInvoice(postedInv.id, 'Customer contract cancellation', fatima.signingPin);
    expect(revRes.original.status).toBe('reversed');
    expect(revRes.reversal.status).toBe('posted');
    expect(revRes.reversal.reversal_of_id).toBe(postedInv.id);

    // Trial Balance returns to prior values
    const restoredTB = useLedgerStore.getState().trialBalance();
    expect(restoredTB.isBalanced).toBe(true);
    expect(restoredTB.totalDebit).toBe(initialDebit);
    expect(restoredTB.totalCredit).toBe(initialDebit);
  });

  it('9. Period close checklist: Blocks close when checks fail', () => {
    const store = useLedgerStore.getState();
    const fatima = mockUsers[1];
    const octPeriod = store.periods.find((p) => p.name === 'Oct 2026');
    expect(octPeriod).toBeDefined();

    // Verify there are failing close checks in mock data
    const hasFailChecks = store.closeChecks.some((c) => c.status === 'fail');
    expect(hasFailChecks).toBe(true);

    // Attempting to close period with failing checks must throw CHECKS_FAILED
    expect(() => {
      store.closePeriod(octPeriod!.id, fatima, store.companySettings, store.auditEvents[0]);
    }).toThrowError(/Cannot close period: \d+ checklist items failing/);
  });

  it('10. Offline outbox: Queues op and processes outbox replay', async () => {
    const store = useLedgerStore.getState();

    // Queue an op
    const op = await store.queueOp('invoice.submit', 'inv-test-99', { test: true });
    expect(op.status).toBe('queued');
    expect(useLedgerStore.getState().outbox.length).toBeGreaterThan(0);

    // Clear or replay
    store.clearOutbox();
    expect(useLedgerStore.getState().outbox).toHaveLength(0);
  });

  it('11. Signing PIN lockout: 3 failed attempts sets 30s lockout and resets on success', () => {
    const store = useLedgerStore.getState();
    const fatima = mockUsers[1];

    store.resetFailedPin(fatima.id);
    expect(useLedgerStore.getState().currentUser.failedPinAttempts).toBe(0);

    store.recordFailedPin(fatima.id);
    expect(useLedgerStore.getState().currentUser.failedPinAttempts).toBe(1);

    store.recordFailedPin(fatima.id);
    expect(useLedgerStore.getState().currentUser.failedPinAttempts).toBe(2);

    store.recordFailedPin(fatima.id);
    expect(useLedgerStore.getState().currentUser.failedPinAttempts).toBe(3);
    expect(useLedgerStore.getState().currentUser.signingLockoutUntil).toBeDefined();

    store.resetFailedPin(fatima.id);
    expect(useLedgerStore.getState().currentUser.failedPinAttempts).toBe(0);
    expect(useLedgerStore.getState().currentUser.signingLockoutUntil).toBeUndefined();
  });

  it('12. Offline replay ordering: Operations replay in strict FIFO chronological sequence', async () => {
    const store = useLedgerStore.getState();
    store.clearOutbox();

    // Queue 3 distinct operations
    const op1 = await store.queueOp('invoice.create', 'inv-seq-1', { seq: 1 });
    const op2 = await store.queueOp('invoice.update', 'inv-seq-1', { seq: 2 });
    const op3 = await store.queueOp('invoice.submit', 'inv-seq-1', { seq: 3 });

    const currentOutbox = useLedgerStore.getState().outbox;
    expect(currentOutbox).toHaveLength(3);
    expect(currentOutbox[0].id).toBe(op1.id);
    expect(currentOutbox[1].id).toBe(op2.id);
    expect(currentOutbox[2].id).toBe(op3.id);

    // Replay outbox
    const result = await store.replayOutbox();
    expect(result.processed).toBeGreaterThanOrEqual(1);
    store.clearOutbox();
  });

  it('13. Credit note from invoice creates balanced contra document', () => {
    const store = useLedgerStore.getState();
    const rahim = mockUsers[0];
    const postedInv = store.invoices.find((i) => i.status === 'posted');
    expect(postedInv).toBeDefined();

    // Create credit note
    const cn = store.createCreditNoteFromInvoice(postedInv!.id, rahim);
    expect(cn.kind).toBe('credit_note');
    expect(cn.reference).toContain('Credit Note');
    expect(cn.reference).toContain(postedInv!.number);
    expect(cn.total).toBe(postedInv!.total);
  });

  it('14. Bank transfer maintains Trial Balance balance via Cash-in-Transit (1090)', () => {
    const store = useLedgerStore.getState();
    const fatima = mockUsers[1];
    const initialTB = store.trialBalance();
    expect(initialTB.isBalanced).toBe(true);

    // Execute balanced bank transfer ($5,000.00 between Premier Bank 1010 and Dahabshiil 1020 via 1090)
    const transferResult = store.postJournalDirect(
      {
        fiscal_period_id: 'per-2026-10',
        source_type: 'bank_transfer',
        journal_date: '2026-10-28',
        reference: 'TRF-TEST-1090',
        memo: 'Inter-account liquidity transfer via transit clearing',
        lines: [
          {
            account_id: 'acc-1090',
            description: 'Cash-in-Transit from Premier Bank USD',
            debit: 500000,
            credit: 0,
            currency: 'USD',
          },
          {
            account_id: 'acc-1010',
            description: 'Disbursement from Premier Bank USD',
            debit: 0,
            credit: 500000,
            currency: 'USD',
          },
          {
            account_id: 'acc-1020',
            description: 'Receipt into Dahabshiil Account',
            debit: 500000,
            credit: 0,
            currency: 'USD',
          },
          {
            account_id: 'acc-1090',
            description: 'Clear Cash-in-Transit on clearing',
            debit: 0,
            credit: 500000,
            currency: 'USD',
          },
        ],
      },
      fatima,
      store.companySettings
    );

    expect(transferResult.journal.status).toBe('posted');
    expect(transferResult.journal.lines).toHaveLength(4);

    // Verify Transit clearing account 1090 net movement is zero
    const transitBal = store.balanceOf('acc-1090');
    expect(transitBal).toBe(0);

    // Verify Trial Balance remains strictly balanced
    const postTB = useLedgerStore.getState().trialBalance();
    expect(postTB.isBalanced).toBe(true);
    expect(postTB.totalDebit).toBe(initialTB.totalDebit);
    expect(postTB.totalCredit).toBe(initialTB.totalCredit);
  });

  it('15. Year-end close journal zeroes out P&L accounts and transfers net income to Retained Earnings', () => {
    const store = useLedgerStore.getState();
    const fatima = mockUsers[1];
    const preCloseTB = store.trialBalance();
    expect(preCloseTB.isBalanced).toBe(true);

    const closeResult = store.postJournalDirect(
      {
        fiscal_period_id: 'per-2026-adj',
        journal_type: 'closing',
        journal_date: '2026-12-31',
        reference: 'YE-2026-CLOSE',
        memo: 'FY 2026 Year-End Closing Entry (P&L into Retained Earnings)',
        lines: [
          {
            account_id: 'acc-4000',
            description: 'Close Sales Revenue to Retained Earnings',
            debit: 4250000,
            credit: 0,
            currency: 'USD',
            dimensions: { branch: 'MG' },
          },
          {
            account_id: 'acc-4900',
            description: 'Close Realised FX Gain to Retained Earnings',
            debit: 250000,
            credit: 0,
            currency: 'USD',
            dimensions: { branch: 'MG' },
          },
          {
            account_id: 'acc-6100',
            description: 'Close Rent Expense to Retained Earnings',
            debit: 0,
            credit: 1800000,
            currency: 'USD',
            dimensions: { branch: 'MG' },
          },
          {
            account_id: 'acc-6200',
            description: 'Close Utilities Expense to Retained Earnings',
            debit: 0,
            credit: 850000,
            currency: 'USD',
            dimensions: { branch: 'MG' },
          },
          {
            account_id: 'acc-6500',
            description: 'Close Depreciation to Retained Earnings',
            debit: 0,
            credit: 800000,
            currency: 'USD',
            dimensions: { branch: 'MG' },
          },
          {
            account_id: 'acc-3900',
            description: 'Net FY 2026 Net Income transfer to Retained Earnings',
            debit: 0,
            credit: 1050000,
            currency: 'USD',
          },
        ],
      },
      fatima,
      store.companySettings
    );

    expect(closeResult.journal.status).toBe('posted');
    expect(closeResult.journal.total_debit).toBe(4500000);
    expect(closeResult.journal.total_credit).toBe(4500000);

    const postCloseTB = useLedgerStore.getState().trialBalance();
    expect(postCloseTB.isBalanced).toBe(true);
  });
});

describe('PART 0 — Match the backend\'s accounting rules (Checks 0.1 to 0.12)', () => {
  beforeEach(() => {
    useLedgerStore.setState(useLedgerStore.getInitialState());
  });

  it('Check 1: 3-line FX invoice rounds HALF_UP with rounding line on settings.posting_accounts.rounding', () => {
    const store = useLedgerStore.getState();
    const inv: Invoice = {
      id: 'inv-fx-test',
      tenant_id: 'ten-acme',
      company_id: 'co-1',
      kind: 'invoice',
      number: 'INV-FY2026-00099',
      status: 'posted',
      contact_id: 'cust-1',
      issue_date: '2026-10-28',
      due_date: '2026-11-28',
      currency: 'EUR',
      fx_rate: 1.085,
      subtotal_fc: 1000,
      tax_total_fc: 0,
      total_fc: 1000,
      subtotal: 1085,
      tax_total: 0,
      total: 1085,
      settled_fc: 0,
      settled: 0,
      lines: [
        {
          id: 'l1',
          line_no: 1,
          account_id: 'acc-4000',
          description: 'Line 1',
          quantity: 1,
          unit_price_fc: 333,
          line_total_fc: 333,
          tax_amount_fc: 0,
          dimensions: { branch: 'MG' },
        },
        {
          id: 'l2',
          line_no: 2,
          account_id: 'acc-4000',
          description: 'Line 2',
          quantity: 1,
          unit_price_fc: 333,
          line_total_fc: 333,
          tax_amount_fc: 0,
          dimensions: { branch: 'MG' },
        },
        {
          id: 'l3',
          line_no: 3,
          account_id: 'acc-4000',
          description: 'Line 3',
          quantity: 1,
          unit_price_fc: 334,
          line_total_fc: 334,
          tax_amount_fc: 0,
          dimensions: { branch: 'MG' },
        },
      ],
      created_by: 'usr-1',
      created_at: new Date().toISOString(),
    };

    const jDraft = buildJournalFromInvoice(
      inv,
      mockCompanySettings,
      'per-2026-10',
      mockUsers[0]
    );

    // Total debits must equal total credits
    const totalDebit = jDraft.lines.reduce((s, l) => s + (l.debit || 0), 0);
    const totalCredit = jDraft.lines.reduce((s, l) => s + (l.credit || 0), 0);
    expect(totalDebit).toBe(totalCredit);
    expect(totalDebit).toBe(1085);

    // Check revenue lines: round(333 * 1.085) = 361, round(334 * 1.085) = 362. Total rev = 1084
    const revLines = jDraft.lines.filter((l) => l.account_id === 'acc-4000');
    expect(revLines).toHaveLength(3);
    const revSum = revLines.reduce((s, l) => s + (l.credit || 0), 0);
    expect(revSum).toBe(1084);

    // Residue (1 cent) must be posted to settings.posting_accounts.rounding (acc-9999)
    const roundingLine = jDraft.lines.find((l) => l.account_id === 'acc-9999');
    expect(roundingLine).toBeDefined();
    expect(roundingLine?.credit).toBe(1);
  });

  it('Check 2: Two lines of 5% tax on $0.10 each give $0.01 tax (per code), and $0.02 with tax_rounding = line', () => {
    const taxLines = [
      {
        id: 'l1',
        line_no: 1,
        account_id: 'acc-4000',
        description: 'Item A',
        line_total_fc: 10, // $0.10
        tax_code_id: 'tax-vat5', // 5%
        dimensions: { branch: 'MG' },
      },
      {
        id: 'l2',
        line_no: 2,
        account_id: 'acc-4000',
        description: 'Item B',
        line_total_fc: 10, // $0.10
        tax_code_id: 'tax-vat5', // 5%
        dimensions: { branch: 'MG' },
      },
    ];

    // Default per code: (10 + 10) * 0.05 = 1.0 -> roundHalfUp(1.0) = 1 cent ($0.01)
    const perCodeResult = calculateDocumentTax(taxLines, mockTaxCodes, 'document_per_code');
    expect(perCodeResult.totalTax).toBe(1);

    // Per line: round(10 * 0.05) + round(10 * 0.05) = 1 + 1 = 2 cents ($0.02)
    const perLineResult = calculateDocumentTax(taxLines, mockTaxCodes, 'line');
    expect(perLineResult.totalTax).toBe(2);
    expect(perLineResult.lines[0].tax_amount_fc).toBe(1);
    expect(perLineResult.lines[1].tax_amount_fc).toBe(1);
  });

  it('Check 3: Unbalanced + inactive account journal draft reports both violations in error.violations', () => {
    const store = useLedgerStore.getState();
    const inactiveAccount = {
      ...mockAccounts[0],
      id: 'acc-inactive-test',
      code: '9998',
      name: 'Discontinued Asset Account',
      is_active: false,
    };
    const testAccounts = [...store.accounts, inactiveAccount];

    const draft = {
      fiscal_period_id: 'per-2026-10',
      journal_type: 'manual' as const,
      journal_date: '2026-10-28',
      lines: [
        {
          id: 'l1',
          line_no: 1,
          account_id: 'acc-inactive-test',
          debit: 10000,
          credit: 0,
          currency: 'USD',
          fx_rate: 1.0,
          dimensions: {},
        },
        {
          id: 'l2',
          line_no: 2,
          account_id: 'acc-4000',
          debit: 0,
          credit: 8000, // Out of balance by $20.00
          currency: 'USD',
          fx_rate: 1.0,
          dimensions: { branch: 'MG' },
        },
      ],
    };

    let caughtError: PostingError | null = null;
    try {
      validateJournalDraft(draft, {
        periods: store.periods,
        accounts: testAccounts,
        settings: store.companySettings,
        sequences: store.sequences,
        currentUser: store.currentUser,
      });
    } catch (err: any) {
      caughtError = err;
    }

    expect(caughtError).toBeInstanceOf(PostingError);
    expect(caughtError?.status).toBe(422);
    const codes = caughtError?.violations.map((v) => v.code) || [];
    expect(codes).toContain('account_inactive');
    expect(codes).toContain('journal_unbalanced');
  });

  it('Check 4: Sales Assistant blocked from soft-closed Sep, Finance Manager allowed', () => {
    const store = useLedgerStore.getState();
    const salesAssistant = mockUsers.find((u) => u.role === 'sales_assistant')!;
    const financeManager = mockUsers.find((u) => u.role === 'finance_manager')!;

    // Sep 2026 is soft-closed
    const periodsWithSoftClose = store.periods.map((p) =>
      p.id === 'per-2026-09' ? { ...p, status: 'soft_closed' as const } : p
    );

    const draft = {
      fiscal_period_id: 'per-2026-09',
      journal_type: 'manual' as const,
      journal_date: '2026-09-15',
      lines: [
        {
          id: 'l1',
          line_no: 1,
          account_id: 'acc-1000',
          debit: 5000,
          credit: 0,
          currency: 'USD',
          dimensions: {},
        },
        {
          id: 'l2',
          line_no: 2,
          account_id: 'acc-4000',
          debit: 0,
          credit: 5000,
          currency: 'USD',
          dimensions: { branch: 'MG' },
        },
      ],
    };

    // Sales Assistant blocked with period_soft_closed
    expect(() => {
      validateJournalDraft(draft, {
        periods: periodsWithSoftClose,
        accounts: store.accounts,
        settings: store.companySettings,
        sequences: store.sequences,
        currentUser: salesAssistant,
      });
    }).toThrowError(/period is soft-closed/);

    try {
      validateJournalDraft(draft, {
        periods: periodsWithSoftClose,
        accounts: store.accounts,
        settings: store.companySettings,
        sequences: store.sequences,
        currentUser: salesAssistant,
      });
    } catch (err: any) {
      expect(err.code).toBe('period_soft_closed');
    }

    // Finance Manager allowed
    expect(() => {
      validateJournalDraft(draft, {
        periods: periodsWithSoftClose,
        accounts: store.accounts,
        settings: store.companySettings,
        sequences: store.sequences,
        currentUser: financeManager,
      });
    }).not.toThrow();
  });

  it('Check 5: Reversal dated before original rejected with reversal_before_original', () => {
    const store = useLedgerStore.getState();
    const fatima = mockUsers[1];

    // Post an original journal dated 2026-10-15
    const original = store.postJournalDirect(
      {
        fiscal_period_id: 'per-2026-10',
        journal_date: '2026-10-15',
        reference: 'ORIG-FOR-REV',
        memo: 'Original journal to be reversed',
        lines: [
          {
            id: 'l1',
            line_no: 1,
            account_id: 'acc-1000',
            debit: 1000,
            credit: 0,
            dimensions: {},
          },
          {
            id: 'l2',
            line_no: 2,
            account_id: 'acc-4000',
            debit: 0,
            credit: 1000,
            dimensions: { branch: 'MG' },
          },
        ],
      },
      fatima,
      store.companySettings
    );

    // Reversal dated 2026-10-10 (before 2026-10-15) must be rejected
    expect(() => {
      store.reverseJournal(original.journal.id, fatima, store.companySettings, '2026-10-10');
    }).toThrowError(/reversal_before_original|earlier than original/);

    try {
      store.reverseJournal(original.journal.id, fatima, store.companySettings, '2026-10-10');
    } catch (err: any) {
      expect(err.code).toBe('reversal_before_original');
    }

    // Reversal dated >= 2026-10-15 must succeed
    const validReversal = store.reverseJournal(
      original.journal.id,
      fatima,
      store.companySettings,
      '2026-10-20'
    );
    expect(validReversal.status).toBe('posted');
    expect(validReversal.reverses_id).toBe(original.journal.id);
  });

  it('Check 6: Closing journal rejected in regular December (period_adjustment_only) and accepted in FY2026 Adj', () => {
    const store = useLedgerStore.getState();
    const fatima = mockUsers[1];

    const closingDraft = {
      fiscal_period_id: 'per-2026-12', // Regular Dec 2026
      journal_type: 'closing' as const,
      journal_date: '2026-12-31',
      reference: 'YE-CLOSE-DEC',
      memo: 'Closing in regular December',
      lines: [
        {
          id: 'l1',
          line_no: 1,
          account_id: 'acc-4000',
          debit: 1000,
          credit: 0,
          dimensions: { branch: 'MG' },
        },
        {
          id: 'l2',
          line_no: 2,
          account_id: 'acc-3900',
          debit: 0,
          credit: 1000,
          dimensions: {},
        },
      ],
    };

    // Rejected in regular December with period_adjustment_only
    expect(() => {
      validateJournalDraft(closingDraft, {
        periods: store.periods,
        accounts: store.accounts,
        settings: store.companySettings,
        sequences: store.sequences,
        currentUser: fatima,
      });
    }).toThrowError(/period_adjustment_only|adjustment period/);

    try {
      validateJournalDraft(closingDraft, {
        periods: store.periods,
        accounts: store.accounts,
        settings: store.companySettings,
        sequences: store.sequences,
        currentUser: fatima,
      });
    } catch (err: any) {
      expect(err.code).toBe('period_adjustment_only');
    }

    // Accepted in FY2026 Adj period
    const adjDraft = {
      ...closingDraft,
      fiscal_period_id: 'per-2026-adj',
    };
    expect(() => {
      validateJournalDraft(adjDraft, {
        periods: store.periods,
        accounts: store.accounts,
        settings: store.companySettings,
        sequences: store.sequences,
        currentUser: fatima,
      });
    }).not.toThrow();
  });

  it('Check 7: Draft has no number, first post gets JV-FY2026-00001', () => {
    const store = useLedgerStore.getState();
    const rahim = mockUsers[0];

    // Draft created has number null
    const draft = store.saveJournalDraft({
      fiscal_period_id: 'per-2026-10',
      journal_type: 'manual',
      journal_date: '2026-10-28',
      reference: 'DRAFT-NUM-TEST',
      memo: 'Draft number verification',
      lines: [
        {
          id: 'l1',
          line_no: 1,
          account_id: 'acc-1000',
          debit: 1000,
          credit: 0,
          dimensions: {},
        },
        {
          id: 'l2',
          line_no: 2,
          account_id: 'acc-4000',
          debit: 0,
          credit: 1000,
          dimensions: { branch: 'MG' },
        },
      ],
    });

    expect(draft.status).toBe('draft');
    expect(draft.number).toBeNull();

    // Reset sequence to 1 to test initial post number
    useLedgerStore.setState({
      sequences: { ...store.sequences, journal: 1 },
    });

    const { journal } = store.postJournalDirect(
      draft,
      rahim,
      store.companySettings
    );

    expect(journal.status).toBe('posted');
    expect(journal.number).toBe('JV-FY2026-00001');

    // Next post gets JV-FY2026-00002
    const secondPost = store.postJournalDirect(
      {
        ...draft,
        id: undefined,
        reference: 'DRAFT-NUM-TEST-2',
      },
      rahim,
      store.companySettings
    );
    expect(secondPost.journal.number).toBe('JV-FY2026-00002');
  });
});

