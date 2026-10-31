import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as R from '../src/mock/PostingRules';

// Shared with backend/tests/Unit/Trade/PostingParityTest.php: docs/fixtures/posting/*.json (13 §9).
const DIR = join(import.meta.dirname, '../../docs/fixtures/posting');
const load = (f: string): any[] => JSON.parse(readFileSync(join(DIR, f), 'utf8'));
const user: any = { id: 'fixture-user' };
const norm = (n: number) => (n === 0 ? 0 : n); // JSON has no -0

function actual(j: any) {
  const lines = j.lines.map((l: any) => {
    const o: any = {
      account_ref: l.account_id, debit: norm(l.debit), credit: norm(l.credit), currency: l.currency, fx_rate: l.fx_rate,
      amount_fc: norm(l.amount_fc), dimensions: l.dimensions || {}, description: l.description,
    };
    if (l.contact_id !== undefined) o.contact_ref = l.contact_id;
    if (l.tax_code_id !== undefined) o.tax_code_ref = l.tax_code_id;
    return o;
  });
  return {
    journal: {
      journal_type: j.journal_type, journal_date: j.journal_date, reference: j.reference, memo: j.memo,
      source_type: j.source_type, source_id: j.source_id,
    },
    lines,
    totals: {
      debit: lines.reduce((s: number, l: any) => s + l.debit, 0),
      credit: lines.reduce((s: number, l: any) => s + l.credit, 0),
    },
  };
}

const rules: Record<string, (i: any) => any> = {
  'invoice.json': (i) => R.buildJournalFromInvoice(i.invoice, i.settings, 'p', user),
  'bill.json': (i) => R.buildJournalFromBill(i.bill, i.settings, 'p', user),
  'settlement.json': (i) => R.buildJournalFromSettlement(i.settlement, i.bank_account_id, i.settings, 'p', user),
  'revaluation.json': (i) => R.buildJournalFromRevaluation(i.revaluation, i.settings, 'p', user),
  'depreciation.json': (i) =>
    R.buildJournalFromDepreciation(i.depreciation, i.depreciation_expense_account, i.accumulated_depreciation_account, 'p', user),
};

describe('posting parity fixtures (docs/fixtures/posting)', () => {
  for (const [file, rule] of Object.entries(rules)) {
    describe(file, () => {
      for (const c of load(file)) {
        it(c.name, () => {
          expect(actual(rule(c.input))).toEqual(c.expected);
        });
      }
    });
  }
});
