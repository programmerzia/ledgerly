/**
 * Seed general ledger for Acme Trading (FY 2026, Jan–Oct).
 *
 * Every seeded sub-ledger document is backed by its journal, built with the same posting rules
 * the app uses when a user posts (PostingRules.buildJournalFrom*):
 *   - posted sales invoices and purchase bills → sales / purchase journals
 *   - invoice settlements → receipt journals (the seeded Settlement where one exists, otherwise a
 *     receipt dated within terms)
 * Monthly operating activity that has no document in the mock (cash sales, payroll, rent,
 * utilities, direct purchases, depreciation, quarterly VAT returns, FX differences) is posted as
 * dated summary journals so every month has a realistic P&L.
 *
 * The opening journal (2026-01-01) carries balance-sheet accounts only. Bank and cash balances are
 * solved so that their 31 Oct book balances equal the figures the bank-reconciliation demo is
 * built on; retained earnings balances the opening journal. AR and AP open at zero, so the control
 * accounts equal the open documents (AR control = invoices' amount due).
 *
 * Seeded journals keep the imported-history numbering JRN-2026-0001… (gapless, chronological).
 * Journals posted in the app continue on the live JV-FY2026-##### sequence.
 */
import type { Bill, Invoice, Journal, JournalLine, Settlement } from '@/types';
import {
  mockBills,
  mockCompanySettings,
  mockInvoices,
  mockJournals,
  mockSettlements,
  mockUsers,
} from '@/mock/data';
import {
  buildJournalFromBill,
  buildJournalFromInvoice,
  buildJournalFromSettlement,
} from '@/mock/PostingRules';

/** Bump when the seed changes so browsers drop their persisted copy (see store/index.ts). */
export const SEED_VERSION = '2026-10-31.ledger-v3';

const AS_OF = '2026-10-31';
const MONTHS = 10; // Jan..Oct

/** 31 Oct book balances the bank-reconciliation demo and bank cards rely on (minor units). */
const CLOSING_TARGETS: Record<string, number> = {
  'acc-1000': 1_450_000, // Cash on hand
  'acc-1010': 12_610_000, // Premier Bank USD
  'acc-1020': 4_210_000, // Dahabshiil SOS account
};

/** Balance-sheet openings that are not solved (debit positive, credit negative). */
const FIXED_OPENINGS: Record<string, number> = {
  'acc-1500': 9_500_000, // Fixed assets
  'acc-1510': -400_000, // Accumulated depreciation (1,900,000 at 31 Oct after 10 × 150,000)
  'acc-2100': -1_420_000, // VAT output for Q4 2025, settled in January
  'acc-2110': 860_000, // VAT input for Q4 2025, offset in January
  'acc-2120': -450_000, // WHT payable
  'acc-3000': -10_000_000, // Share capital
};

const DEPRECIATION_PER_MONTH = 150_000;

const maker = mockUsers.find((u) => u.id === 'usr-1') ?? mockUsers[0];
const approver = mockUsers.find((u) => u.id === 'usr-2') ?? mockUsers[0];

const pad2 = (n: number) => String(n).padStart(2, '0');
const periodOf = (date: string) => `per-2026-${date.slice(5, 7)}`;
const isoDate = (y: number, m: number, d: number) => `${y}-${pad2(m)}-${pad2(d)}`;
const addDays = (date: string, days: number) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
const minDate = (a: string, b: string) => (a < b ? a : b);

type Draft = Omit<Journal, 'number'>;

function line(
  key: string,
  accountId: string,
  amount: number,
  description: string,
  dims: Record<string, string> = { branch: 'MG' },
): JournalLine {
  return {
    id: key,
    line_no: 0,
    account_id: accountId,
    debit: amount > 0 ? amount : 0,
    credit: amount < 0 ? -amount : 0,
    currency: 'USD',
    fx_rate: 1.0,
    amount_fc: amount,
    dimensions: dims,
    description,
  };
}

function summary(
  id: string,
  date: string,
  type: Journal['journal_type'],
  reference: string,
  memo: string,
  lines: JournalLine[],
): Draft {
  return finalize({
    id,
    tenant_id: 'ten-acme',
    company_id: 'co-1',
    fiscal_period_id: periodOf(date),
    journal_type: type,
    status: 'posted',
    journal_date: date,
    reference,
    memo,
    total_debit: 0,
    total_credit: 0,
    lines,
    created_by: maker.id,
    approved_by: approver.id,
    created_at: `${date}T09:00:00Z`,
    updated_at: `${date}T16:00:00Z`,
  });
}

function finalize(j: Draft): Draft {
  const lines = j.lines.map((l, i) => ({ ...l, line_no: i + 1 }));
  const dr = lines.reduce((s, l) => s + l.debit, 0);
  const cr = lines.reduce((s, l) => s + l.credit, 0);
  if (dr !== cr) throw new Error(`Seed journal ${j.id} is unbalanced: ${dr} ≠ ${cr}`);
  return {
    ...j,
    lines,
    total_debit: dr,
    total_credit: cr,
    posted_at: j.posted_at ?? `${j.journal_date}T16:00:00Z`,
    posted_by: j.posted_by ?? approver.id,
    version: 1,
  };
}

function fromBuilder(
  id: string,
  date: string,
  built: Omit<Journal, 'id' | 'number' | 'status' | 'posted_at' | 'posted_by'>,
): Draft {
  return finalize({
    ...built,
    id,
    status: 'posted',
    journal_date: date,
    fiscal_period_id: periodOf(date),
    created_by: built.created_by ?? maker.id,
    approved_by: approver.id,
    created_at: `${date}T09:00:00Z`,
    updated_at: `${date}T16:00:00Z`,
  } as Draft);
}

// ---------------------------------------------------------------------------------------------
// 1. Document journals
// ---------------------------------------------------------------------------------------------
const postedInvoices = mockInvoices.filter((i) => i.status === 'posted' && i.kind === 'sales_invoice');
const postedBills = mockBills.filter((b) => b.status === 'posted');

const invoiceJournalId = (inv: Invoice) => `jrn-seed-${inv.id}`;
const billJournalId = (bill: Bill) => `jrn-seed-${bill.id}`;

const documentJournals: Draft[] = [
  ...postedInvoices.map((inv) =>
    fromBuilder(
      invoiceJournalId(inv),
      inv.issue_date,
      buildJournalFromInvoice(inv, mockCompanySettings, periodOf(inv.issue_date), approver),
    ),
  ),
  ...postedBills.map((bill) =>
    fromBuilder(
      billJournalId(bill),
      bill.issue_date,
      buildJournalFromBill(bill, mockCompanySettings, periodOf(bill.issue_date), approver),
    ),
  ),
];

// Receipts: seeded settlements first, then synthesised receipts for the rest of `settled`.
const seededReceipts = mockSettlements.filter((s) => s.kind === 'receipt' && s.status === 'posted');
const coveredByReceipt = new Map<string, number>();
for (const s of seededReceipts) {
  for (const a of s.allocations) {
    coveredByReceipt.set(a.invoice_id, (coveredByReceipt.get(a.invoice_id) ?? 0) + a.allocated_amount_base);
  }
}

const synthesisedReceipts: Settlement[] = postedInvoices
  .map((inv, idx) => ({ inv, idx, open: inv.settled - (coveredByReceipt.get(inv.id) ?? 0) }))
  .filter(({ open }) => open > 0)
  .map(({ inv, idx, open }) => {
    const date = minDate(addDays(inv.issue_date, 12 + (idx % 15)), '2026-10-30');
    return {
      id: `set-seed-${inv.id}`,
      tenant_id: 'ten-acme',
      company_id: 'co-1',
      kind: 'receipt',
      number: `RCT-${inv.number ?? inv.id}`,
      status: 'posted',
      contact_id: inv.contact_id,
      bank_account_id: 'bnk-1',
      settlement_date: date,
      currency: inv.currency,
      fx_rate: 1.0,
      amount_fc: open,
      amount: open,
      unallocated_fc: 0,
      allocations: [
        {
          id: `alloc-seed-${inv.id}`,
          invoice_id: inv.id,
          invoice_number: inv.number ?? inv.id,
          invoice_total_fc: inv.total_fc,
          invoice_open_fc: open,
          allocated_amount_fc: open,
          allocated_amount_base: open,
          fx_gain_loss: 0,
        },
      ],
      reference: `TRF-${inv.number ?? inv.id}`,
      memo: `Payment received for ${inv.number ?? inv.id}`,
      created_by: maker.id,
      approved_by: approver.id,
      posted_at: `${date}T16:00:00Z`,
      created_at: `${date}T09:00:00Z`,
    } satisfies Settlement;
  });

const receiptJournals: Draft[] = [...seededReceipts, ...synthesisedReceipts].map((s) =>
  fromBuilder(
    `jrn-seed-${s.id}`,
    s.settlement_date,
    buildJournalFromSettlement(s, 'acc-1010', mockCompanySettings, periodOf(s.settlement_date), approver),
  ),
);

// ---------------------------------------------------------------------------------------------
// 2. Monthly operating activity without documents in the mock
// ---------------------------------------------------------------------------------------------
const SEASON = [0, -2, 1, 2, 3, 1, -1, 2, 14, 3]; // gentle seasonality, Jan..Oct
const sales = (m: number) => 620_000 + m * 35_000 + SEASON[m - 1] * 45_000; // cash & POS sales, net
const services = (m: number) => 240_000 + m * 12_000;

const monthlyJournals: Draft[] = [];
const vatOutputByMonth: number[] = Array(MONTHS + 1).fill(0);
for (const inv of postedInvoices) vatOutputByMonth[Number(inv.issue_date.slice(5, 7))] += inv.tax_total;

for (let m = 1; m <= MONTHS; m++) {
  const mon = new Date(Date.UTC(2026, m - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const s = sales(m);
  const sv = services(m);
  const vat = Math.round((s + sv) * 0.05);
  vatOutputByMonth[m] += vat;

  monthlyJournals.push(
    summary(`jrn-seed-cashsales-${m}`, isoDate(2026, m, 28), 'sales', `POS-${mon.toUpperCase()}`,
      `Cash and card sales summary · ${mon} 2026`, [
        line(`cs-${m}-bank`, 'acc-1010', s + sv + vat, 'Card settlements and cash banked'),
        line(`cs-${m}-4000`, 'acc-4000', -s, 'Counter sales', { branch: 'MG', cost_centre: 'SALES' }),
        line(`cs-${m}-4100`, 'acc-4100', -sv, 'Walk-in service jobs', { branch: 'MG', cost_centre: 'SALES' }),
        line(`cs-${m}-vat`, 'acc-2100', -vat, 'VAT 5% on cash sales'),
      ]),
  );

  // Direct costs ≈ 46% of the month's goods sales (invoiced goods + counter sales).
  const invoicedGoods = postedInvoices
    .filter((i) => Number(i.issue_date.slice(5, 7)) === m)
    .flatMap((i) => i.lines)
    .filter((l) => l.account_id === 'acc-4000')
    .reduce((t, l) => t + l.line_total_fc, 0);
  const cogs = Math.round(((invoicedGoods + s) * 0.46) / 100) * 100;
  monthlyJournals.push(
    summary(`jrn-seed-cogs-${m}`, isoDate(2026, m, 26), 'purchase', `STOCK-${mon.toUpperCase()}`,
      `Stock purchases for resale · ${mon} 2026`, [
        line(`cg-${m}-5000`, 'acc-5000', cogs, 'Goods purchased for resale', { branch: 'MG', cost_centre: 'OPS' }),
        line(`cg-${m}-bank`, 'acc-1010', -cogs, 'Supplier transfers'),
      ]),
  );

  const payroll = m <= 6 ? 450_000 : 485_000;
  monthlyJournals.push(
    summary(`jrn-seed-payroll-${m}`, isoDate(2026, m, 25), 'bank', `PAYROLL-${mon.toUpperCase()}`,
      `Payroll · ${mon} 2026`, [
        line(`pr-${m}-6000`, 'acc-6000', payroll, 'Salaries and wages', { branch: 'MG', cost_centre: 'ADMIN' }),
        line(`pr-${m}-bank`, 'acc-1010', -payroll, 'Salary transfers'),
      ]),
  );

  // October rent is the manual journal JRN for the office lease adjustment (jrn-2026-0101).
  if (m < 10) {
    monthlyJournals.push(
      summary(`jrn-seed-rent-${m}`, isoDate(2026, m, 2), 'bank', `RENT-${mon.toUpperCase()}`,
        `Office rent · ${mon} 2026`, [
          line(`rt-${m}-6100`, 'acc-6100', 150_000, 'Mogadishu HQ rent', { branch: 'MG', cost_centre: 'ADMIN' }),
          line(`rt-${m}-bank`, 'acc-1010', -150_000, 'Standing order to landlord'),
        ]),
    );
  }

  // October utilities come from the supplier bills.
  if (m < 10) {
    const util = 62_000 + (m % 3) * 9_000 + (m >= 6 && m <= 8 ? 18_000 : 0);
    monthlyJournals.push(
      summary(`jrn-seed-util-${m}`, isoDate(2026, m, 18), 'bank', `UTIL-${mon.toUpperCase()}`,
        `Power, water and internet · ${mon} 2026`, [
          line(`ut-${m}-6200`, 'acc-6200', util, 'Utilities', { branch: 'MG', cost_centre: 'ADMIN' }),
          line(`ut-${m}-bank`, 'acc-1010', -util, 'Direct debits'),
        ]),
    );
  }

  monthlyJournals.push(
    summary(`jrn-seed-depr-${m}`, isoDate(2026, m, 25), 'depreciation', `DEPR-${mon.toUpperCase()}`,
      `Depreciation run · ${mon} 2026`, [
        line(`dp-${m}-6500`, 'acc-6500', DEPRECIATION_PER_MONTH, 'Straight-line depreciation', { branch: 'MG', cost_centre: 'ADMIN' }),
        line(`dp-${m}-1510`, 'acc-1510', -DEPRECIATION_PER_MONTH, 'Accumulated depreciation'),
      ]),
  );
}

// Quarterly VAT returns: pay last quarter's output VAT less input VAT. Q4 2025 (opening) in Jan.
const vatReturns: [number, number, number][] = [
  // [month paid, output VAT, input VAT]
  [1, -FIXED_OPENINGS['acc-2100'], FIXED_OPENINGS['acc-2110']],
  [4, vatOutputByMonth[1] + vatOutputByMonth[2] + vatOutputByMonth[3], 0],
  [7, vatOutputByMonth[4] + vatOutputByMonth[5] + vatOutputByMonth[6], 0],
  [10, vatOutputByMonth[7] + vatOutputByMonth[8] + vatOutputByMonth[9], 0],
];
for (const [m, out, inp] of vatReturns) {
  const q = m === 1 ? 'Q4 2025' : `Q${(m - 1) / 3} 2026`;
  monthlyJournals.push(
    summary(`jrn-seed-vat-${m}`, isoDate(2026, m, 20), 'bank', `VAT-${q.replace(' ', '-')}`,
      `VAT return ${q}`, [
        line(`vr-${m}-2100`, 'acc-2100', out, 'Output VAT for the quarter'),
        ...(inp ? [line(`vr-${m}-2110`, 'acc-2110', -inp, 'Input VAT recovered')] : []),
        line(`vr-${m}-bank`, 'acc-1010', -(out - inp), 'Payment to tax authority'),
      ]),
  );
}

// Realised FX differences on SOS conversions.
for (const [m, amt] of [[3, 85_000], [5, -62_000], [8, 150_000], [9, -58_000]] as const) {
  monthlyJournals.push(
    summary(`jrn-seed-fx-${m}`, isoDate(2026, m, 27), 'fx', `FX-${pad2(m)}`,
      `Realised FX on SOS conversions · ${pad2(m)}/2026`, [
        line(`fx-${m}-bank`, 'acc-1010', amt, 'Conversion difference'),
        amt > 0
          ? line(`fx-${m}-4900`, 'acc-4900', -amt, 'Realised FX gain', { branch: 'MG', cost_centre: 'FIN' })
          : line(`fx-${m}-6900`, 'acc-6900', -amt, 'Realised FX loss', { branch: 'MG', cost_centre: 'FIN' }),
      ]),
  );
}

// Hand-written demo journals from data.ts (October manual entries), opening excluded.
const demoJournals: Draft[] = mockJournals.filter((j) => j.journal_type !== 'opening');

// ---------------------------------------------------------------------------------------------
// 3. Opening journal solved for bank/cash targets; retained earnings balances it
// ---------------------------------------------------------------------------------------------
const activity: Draft[] = [...documentJournals, ...receiptJournals, ...monthlyJournals, ...demoJournals];

const movement = (accountId: string) =>
  activity
    .filter((j) => j.journal_date <= AS_OF)
    .flatMap((j) => j.lines)
    .filter((l) => l.account_id === accountId)
    .reduce((t, l) => t + l.debit - l.credit, 0);

const openings: Record<string, number> = { ...FIXED_OPENINGS };
for (const [acc, target] of Object.entries(CLOSING_TARGETS)) openings[acc] = target - movement(acc);
openings['acc-3900'] = -Object.values(openings).reduce((t, v) => t + v, 0);

const OPENING_LABELS: Record<string, string> = {
  'acc-1000': 'Cash on hand',
  'acc-1010': 'Premier Bank USD Operating',
  'acc-1020': 'Dahabshiil SOS Account',
  'acc-1500': 'Fixed assets at cost',
  'acc-1510': 'Accumulated depreciation',
  'acc-2100': 'VAT output payable (Q4 2025)',
  'acc-2110': 'VAT input recoverable (Q4 2025)',
  'acc-2120': 'WHT payable',
  'acc-3000': 'Share capital',
  'acc-3900': 'Retained earnings brought forward',
};

const openingTemplate = mockJournals.find((j) => j.journal_type === 'opening');
const openingJournal = finalize({
  ...(openingTemplate as Journal),
  id: openingTemplate?.id ?? 'jrn-2026-0001',
  memo: 'Opening balance sheet for FY 2026',
  lines: Object.entries(openings)
    .filter(([, v]) => v !== 0)
    .map(([acc, v]) => line(`jl-op-${acc}`, acc, v, OPENING_LABELS[acc] ?? 'Opening balance')),
});

// ---------------------------------------------------------------------------------------------
// 4. Number chronologically (imported-history sequence) and export
// ---------------------------------------------------------------------------------------------
const ordered = [openingJournal, ...activity].sort(
  (a, b) => a.journal_date.localeCompare(b.journal_date) || (a.posted_at ?? '').localeCompare(b.posted_at ?? '') || a.id.localeCompare(b.id),
);

export const seedJournals: Journal[] = ordered.map((j, i) => ({
  ...j,
  number: `JRN-2026-${String(i + 1).padStart(4, '0')}`,
}));

/** Journal backing each seeded document (invoice, bill or settlement id → journal id). */
export const seedJournalIdByDocument: Record<string, string> = Object.fromEntries([
  ...postedInvoices.map((i) => [i.id, invoiceJournalId(i)]),
  ...postedBills.map((b) => [b.id, billJournalId(b)]),
  ...seededReceipts.map((s) => [s.id, `jrn-seed-${s.id}`]),
]);
