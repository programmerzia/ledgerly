import { describe, expect, it } from 'vitest';
import {
  ReportShapeError, drillQuery, parseAging, parseBalanceSheet, parseCashFlow, parseDrillSummary, parseExportTicket, parseLedgerHeader, parseLedgerLine,
  parseProfitAndLoss, parseStatement, parseTaxReturn, parseTrialBalance, selectionQuery, toDrillKey, type ReportSelection,
} from '../src/api/adapters/report';
import { currentPeriod, defaultSelection, resolveSelection, selectionFromSearch, selectionToSearch, type PeriodChoice } from '../src/api/adapters/reportSelection';

const m = (amount: number) => ({ amount, currency: 'USD' });
const A1 = '01a19a49-35e9-71d9-bab8-6ad8981db611';
const D1 = '01a19a49-35e9-71d9-bab8-6ad8a3ad5e58';
const V1 = '01a19a49-3838-7279-996e-cab670758a82';
const acct = (code: string, name: string, extra = {}) => ({ id: `id-${code}`, code, name, ...extra });

describe('trial balance', () => {
  const body = {
    generated_at: '2026-11-02T03:24:16Z', report: 'trial_balance', currency: 'USD', as_of: '2026-11-02',
    rows: [{ account: acct('1010', 'Main bank', { account_type: 'asset', subtype: 'Cash' }), debit: m(1430000), credit: m(0), drill: { account_id: A1, from: null, to: '2026-11-02', exclude_closing: false } }],
    totals: { debit: m(1430000), credit: m(1430000) }, balanced: true, filtered: false,
  };
  it('keeps the server totals and verdict as sent', () => {
    const tb = parseTrialBalance(body);
    expect(tb.totalDebit).toBe(1430000);
    expect(tb.totalCredit).toBe(1430000);
    expect(tb.balanced).toBe(true);
    expect(tb.rows[0].debit).toBe(1430000);
    expect(tb.rows[0].account.accountType).toBe('asset');
    expect(tb.rows[0].drill).toEqual({ account_id: A1, from: null, to: '2026-11-02', exclude_closing: false });
  });
  it('reports an out-of-balance run as the server says, without recomputing', () => {
    const tb = parseTrialBalance({ ...body, balanced: false, filtered: true, totals: { debit: m(10), credit: m(7) } });
    expect(tb.balanced).toBe(false);
    expect(tb.filtered).toBe(true);
    expect(tb.totalDebit).toBe(10);
  });
  it('refuses a body of the wrong shape and a fractional amount', () => {
    expect(() => parseTrialBalance({ rows: [] })).toThrow(ReportShapeError);
    expect(() => parseTrialBalance({ ...body, totals: { debit: m(10.5), credit: m(1) } })).toThrow(/integer/);
  });
});

describe('profit and loss', () => {
  const fig = (a: number, c: number, v: number, pct: string | null) => ({ amount: m(a), comparison: m(c), variance: m(v), variance_pct: pct });
  const body = {
    generated_at: '2026-11-02T03:24:16Z', currency: 'USD', from: '2026-10-01', to: '2026-10-31', basis: 'month',
    comparison: { type: 'previous_period', available: true, from: '2026-09-01', to: '2026-09-30' },
    sections: [{ key: 'operating_revenue', title: 'Revenue', lines: [{ account: acct('4100', 'Service revenue', { subtype: null }), ...fig(250000, 0, 250000, null), drill: { account_id: A1, from: '2026-10-01', to: '2026-10-31', exclude_closing: true } }], total: fig(250000, 0, 250000, null) }],
    subtotals: { gross_profit: fig(-50000, -300000, 250000, '83.3'), operating_profit: fig(-215050, -300000, 84950, '28.3'), net_profit: fig(-215050, -300000, 84950, '28.3') },
    filtered: false,
  };
  it('carries the comparison columns and subtotals from the server', () => {
    const pl = parseProfitAndLoss(body);
    expect(pl.comparison).toEqual({ type: 'previous_period', available: true, from: '2026-09-01', to: '2026-09-30' });
    expect(pl.sections[0].lines[0]).toMatchObject({ amount: 250000, comparison: 0, variance: 250000, variancePct: null });
    expect(pl.sections[0].lines[0].drill?.exclude_closing).toBe(true);
    expect(pl.netProfit).toEqual({ amount: -215050, comparison: -300000, variance: 84950, variancePct: '28.3' });
    expect(pl.grossProfit.amount).toBe(-50000);
  });
  it('has no comparison fields when the run had none', () => {
    const plain = { ...body, comparison: null, sections: [{ key: 'k', title: 'Revenue', lines: [], total: { amount: m(0) } }], subtotals: { gross_profit: { amount: m(0) }, operating_profit: { amount: m(0) }, net_profit: { amount: m(5) } } };
    const pl = parseProfitAndLoss(plain);
    expect(pl.comparison).toBeNull();
    expect(pl.netProfit).toEqual({ amount: 5 });
  });
  it('knows when there was nothing to compare with', () => {
    const pl = parseProfitAndLoss({ ...body, comparison: { type: 'previous_period', available: false, from: null, to: null } });
    expect(pl.comparison?.available).toBe(false);
  });
});

describe('trial balance with opening, movement and closing', () => {
  const side = (d: number, c: number) => ({ debit: m(d), credit: m(c) });
  const body = {
    generated_at: '2026-11-02T03:24:16Z', report: 'trial_balance', mode: 'movement', currency: 'USD', from: '2026-02-01', to: '2026-02-28', as_of: '2026-02-28', opening_as_of: '2026-01-31',
    rows: [{ account: acct('1000', 'Cash'), opening: side(135000, 0), movement: side(28500, 6000), closing: side(157500, 0), drill: { opening: { account_id: A1, from: null, to: '2026-01-31', exclude_closing: false }, movement: { account_id: A1, from: '2026-02-01', to: '2026-02-28', exclude_closing: false }, closing: { account_id: A1, from: null, to: '2026-02-28', exclude_closing: false } } }],
    totals: { opening: side(1, 1), movement: side(2, 2), closing: side(3, 3) }, balanced: true, filtered: false,
  };
  it('maps the three column groups and their drill keys', () => {
    const tb = parseTrialBalance(body);
    expect(tb.mode).toBe('movement');
    expect(tb.from).toBe('2026-02-01');
    expect(tb.rows[0].opening?.debit).toBe(135000);
    expect(tb.rows[0].movement).toEqual({ debit: 28500, credit: 6000 });
    expect(tb.rows[0].debit).toBe(157500);
    expect(tb.rows[0].drills?.movement?.from).toBe('2026-02-01');
    expect(tb.totals?.closing).toEqual({ debit: 3, credit: 3 });
  });
  it('asks for the movement view', () => {
    const sel = { when: { kind: 'range' as const, from: '2026-02-01', to: '2026-02-28' }, basis: 'month' as const, comparison: 'none' as const, hideZero: false, dims: {}, view: 'movement' as const };
    expect(selectionQuery(sel)).toMatchObject({ from: '2026-02-01', to: '2026-02-28', view: 'movement' });
  });
});

describe('breakdown by dimension', () => {
  const cols = [{ value: { id: V1, code: 'SALES', name: 'Sales' } }, { value: null }];
  it('maps the columns, the untagged column and each figure\'s cells on profit and loss', () => {
    const pl = parseProfitAndLoss({
      generated_at: '2026-11-02T03:24:16Z', currency: 'USD', from: '2026-01-01', to: '2026-02-28', comparison: null, filtered: false,
      breakdown: { dimension: { id: D1, code: 'DEPT', name: 'Department' }, columns: cols },
      sections: [{ key: 'operating_revenue', title: 'Revenue', lines: [{ account: acct('4000', 'Sales'), amount: m(130000), by_dimension: [m(100000), m(30000)] }], total: { amount: m(130000), by_dimension: [m(100000), m(30000)] } }],
      subtotals: { gross_profit: { amount: m(1), by_dimension: [m(1), m(0)] }, operating_profit: { amount: m(1), by_dimension: [m(1), m(0)] }, net_profit: { amount: m(1), by_dimension: [m(1), m(0)] } },
    });
    expect(pl.breakdown?.columns.map((c) => c?.name ?? 'Untagged')).toEqual(['Sales', 'Untagged']);
    expect(pl.sections[0].lines[0].byDimension).toEqual([100000, 30000]);
    expect(pl.netProfit.byDimension).toEqual([1, 0]);
  });
  it('maps trial balance cells and column totals', () => {
    const tb = parseTrialBalance({
      generated_at: '2026-11-02T03:24:16Z', report: 'trial_balance', mode: 'as_of', currency: 'USD', as_of: '2026-02-28',
      breakdown: { dimension: { id: D1, code: 'DEPT', name: 'Department' }, columns: cols },
      rows: [{ account: acct('1000', 'Cash'), debit: m(5), credit: m(0), by_dimension: [m(7), m(-2)] }],
      totals: { debit: m(5), credit: m(0), by_dimension: [m(7), m(-2)] }, balanced: true, filtered: false,
    });
    expect(tb.rows[0].byDimension).toEqual([7, -2]);
    expect(tb.totalsByDimension).toEqual([7, -2]);
  });
  it('sends the dimension as breakdown', () => {
    const sel = { when: { kind: 'asof' as const, date: '2026-02-28' }, basis: 'month' as const, comparison: 'none' as const, hideZero: false, dims: {}, breakdown: D1 };
    expect(selectionQuery(sel)).toMatchObject({ as_of: '2026-02-28', breakdown: D1 });
  });
});

describe('balance sheet (D9 gross presentation, D13 equity by fund)', () => {
  const fund = { id: V1, code: 'RESTR', name: 'Donor restricted' };
  const body = {
    generated_at: '2026-11-02T03:24:24Z', currency: 'USD', as_of: '2026-11-02', comparison: null,
    assets: {
      lines: [
        { key: A1, account: acct('1200', 'Accounts receivable (AR control)', { subtype: 'Current Assets' }), amount: m(300000), drill: { account_id: A1, from: null, to: '2026-11-02', exclude_closing: false, contact_side: 'debit' } },
        { key: `supplier_debit_balances:${A1}`, name: 'Supplier debit balances', account: acct('2000', 'Accounts payable'), gross: true, contacts: [{ contact: { id: 'c1', name: 'Dalmar Freight' }, amount: m(100000), drill: { account_id: A1, from: null, to: '2026-11-02', exclude_closing: false, contact_id: 'c1' } }], amount: m(100000), drill: { account_id: A1, from: null, to: '2026-11-02', exclude_closing: false, contact_side: 'debit' } },
      ],
      total: { amount: m(400000) },
      current: { lines: [], total: { amount: m(400000) } },
      non_current: { lines: [], total: { amount: m(0) } },
    },
    liabilities: {
      lines: [{ key: `customer_credit_balances:${A1}`, name: 'Customer credit balances', gross: true, contacts: [{ contact: { id: 'c2', name: 'Acme Traders' }, amount: m(500000), drill: { account_id: A1, from: null, to: '2026-11-02', exclude_closing: false, contact_id: 'c2' } }], amount: m(500000), drill: { account_id: A1, from: null, to: '2026-11-02', exclude_closing: false, contact_side: 'credit' } }],
      total: { amount: m(500000) },
      current: { lines: [], total: { amount: m(500000) } },
      non_current: { lines: [], total: { amount: m(0) } },
    },
    equity: {
      lines: [
        { key: `${D1}:${V1}`, account: acct('3000', 'Share capital'), fund, amount: m(500000), drill: { account_id: D1, from: null, to: '2026-11-02', exclude_closing: false } },
        { key: `${D1}:`, account: acct('3000', 'Share capital'), fund: null, amount: m(1500000) },
        { key: 'current_year_result:', name: 'Current year result', result: true, fund: null, amount: m(314950), report: { report: 'profit_and_loss', to: '2026-11-02' } },
      ],
      total: { amount: m(2314950) },
      funds: [{ fund: null, total: { amount: m(1814950) } }, { fund, total: { amount: m(500000) } }],
    },
    totals: { liabilities_and_equity: { amount: m(2814950) } },
    balanced: false, difference: m(-2414950), filtered: false,
  };
  const bs = parseBalanceSheet(body);
  it('keeps credit balances in receivables as their own liability line, with the contacts', () => {
    const line = bs.liabilities.lines[0];
    expect(line.gross).toBe(true);
    expect(line.label).toBe('Customer credit balances');
    expect(line.code).toBeNull();
    expect(line.contacts).toHaveLength(1);
    expect(line.contacts[0]).toMatchObject({ name: 'Acme Traders', amount: 500000 });
    expect(line.contacts[0].drill?.contact_id).toBe('c2');
    expect(bs.assets.lines[1].label).toBe('Supplier debit balances');
    // The control account line is the server's own (kept) figure, not net of the credit.
    expect(bs.assets.lines[0]).toMatchObject({ code: '1200', amount: 300000, gross: false });
  });
  it('keeps equity by fund and the unclosed result lines', () => {
    expect(bs.equity.lines[0].fund).toEqual({ id: V1, code: 'RESTR', name: 'Donor restricted' });
    expect(bs.equity.lines[1].fund).toBeNull();
    expect(bs.equity.lines[2]).toMatchObject({ result: true, label: 'Current year result', amount: 314950 });
    expect(bs.equity.funds?.map((f) => f.total.amount)).toEqual([1814950, 500000]);
    expect(bs.equity.funds?.[0].fund).toBeNull();
  });
  it('keeps the current and non-current parts of assets and liabilities (IAS 1.60)', () => {
    expect(bs.assets.current.total.amount + bs.assets.nonCurrent.total.amount).toBe(bs.assets.total.amount);
    expect(bs.liabilities.current.total.amount + bs.liabilities.nonCurrent.total.amount).toBe(bs.liabilities.total.amount);
    expect(() => parseBalanceSheet({ ...body, assets: { lines: [], total: { amount: m(0) } } })).toThrow(ReportShapeError);
  });
  it('does not decide whether it balances', () => {
    expect(bs.balanced).toBe(false);
    expect(bs.difference).toBe(-2414950);
    expect(bs.liabilitiesAndEquity.amount).toBe(2814950);
  });
  it('leaves funds undefined when the company has no fund dimension', () => {
    const none = parseBalanceSheet({ ...body, equity: { lines: [{ key: 'k', account: acct('3000', 'Capital'), amount: m(1) }], total: { amount: m(1) } } });
    expect(none.equity.funds).toBeNull();
    expect(none.equity.lines[0].fund).toBeUndefined();
  });
});

describe('cash flow', () => {
  it('maps sections, the opening and closing cash and the server verdict', () => {
    const cf = parseCashFlow({
      generated_at: null, currency: 'USD', from: '2026-10-01', to: '2026-10-31',
      operating: { lines: [{ key: 'net_profit', label: 'Net profit', amount: m(-215050) }, { key: 'account', label: 'Increase in receivables', amount: m(-220000), drill: { account_id: A1, from: '2026-10-01', to: '2026-10-31', exclude_closing: true } }], total: m(-435050) },
      investing: { lines: [], total: m(0) }, financing: { lines: [], total: m(0) },
      fx_effect_on_cash: m(0), net_change_in_cash: m(-1000), opening_cash: m(1431000), closing_cash: m(1430000), unexplained: m(0), reconciles: true,
      assumptions: [{ id: 'x', code: '1220', name: 'Prepayments', activity: 'operating', reason: 'No subtype' }],
    });
    expect(cf.operating.total).toBe(-435050);
    expect(cf.operating.lines[1].drill?.exclude_closing).toBe(true);
    expect(cf.opening).toBe(1431000);
    expect(cf.closing).toBe(1430000);
    expect(cf.reconciles).toBe(true);
    expect(cf.assumptions[0]).toEqual({ account: '1220 Prepayments', activity: 'operating', reason: 'No subtype' });
  });
});

describe('aging', () => {
  const row = (open: number, credits: number, net: number) => ({
    current: m(open), days_1_30: m(0), days_31_60: m(0), days_61_90: m(0), days_over_90: m(0), open: m(open), credit_notes: m(0), on_account: m(credits), credits: m(credits), net: m(net),
  });
  it('keeps credits apart from the buckets and net as the server computed it', () => {
    const ag = parseAging({
      currency: 'USD', as_of: '2026-11-02', buckets: [],
      rows: [{ contact: { id: 'c1', code: 'ACME', name: 'Acme Traders' }, ...row(0, 500000, -500000) }],
      credits: [{ contact: { id: 'c1', code: 'ACME', name: 'Acme Traders' }, kind: 'receipt', id: 'r1', number: 'RCT-1', date: '2026-09-20', amount: m(500000) }],
      totals: row(300000, 500000, -200000),
    });
    expect(ag.rows[0].open).toBe(0);
    expect(ag.rows[0].credits).toBe(500000);
    expect(ag.rows[0].net).toBe(-500000);
    expect(ag.totals.buckets.current).toBe(300000);
    expect(ag.totals.net).toBe(-200000);
    expect(ag.credits[0]).toMatchObject({ kind: 'receipt', number: 'RCT-1', amount: 500000 });
  });
});

describe('statement and tax return', () => {
  it('maps a statement with the server running balance', () => {
    const st = parseStatement({
      currency: 'USD', contact: { id: 'c1', code: 'ACME', name: 'Acme Traders' }, from: '2026-01-01', to: '2026-11-02', opening_balance: m(0),
      rows: [{ date: '2026-08-01', type: 'invoice', document: { type: 'sales_invoice', id: 'i1', number: 'INV-1' }, journal_number: 'JV-1', description: 'Goods', debit: m(100000), credit: m(0), balance: m(100000) }],
      totals: { debit: m(100000), credit: m(0) }, closing_balance: m(100000),
    });
    expect(st.rows[0]).toMatchObject({ documentNumber: 'INV-1', journalNumber: 'JV-1', balance: 100000 });
    expect(st.closing).toBe(100000);
  });
  it('maps a tax return with recoverability', () => {
    const side = (type: string, rows: unknown[]) => ({ tax_type: type, rows, totals: { net: m(1000), tax: m(100) } });
    const tr = parseTaxReturn({
      currency: 'USD', from: '2026-01-01', to: '2026-11-02',
      sales: side('output', [{ tax_code: { id: 't1', code: 'VAT5', name: 'VAT 5%', kind: 'vat' }, recoverable: null, net: m(1000), tax: m(100) }]),
      purchases: side('input', [{ tax_code: null, recoverable: false, net: m(1000), tax: m(100) }]),
      net_tax_payable: m(0),
    });
    expect(tr.sales.rows[0]).toMatchObject({ code: 'VAT5', recoverable: null });
    expect(tr.purchases.rows[0]).toMatchObject({ name: 'No tax code', recoverable: false });
    expect(tr.netPayable).toBe(0);
  });
});

describe('ledger lines, drill and exports', () => {
  const line = {
    id: 'l1', journal: { id: 'j1', number: 'JV-FY2026-00007', date: '2026-10-10', type: 'manual', reference: null, memo: null }, source: { type: 'sales_invoice', id: 'i1' },
    line_no: 1, account_id: A1, debit: m(250000), credit: m(0), description: 'AR Control', contact_id: null, dimensions: { [D1]: V1 },
  };
  it('reads a line with and without a running balance', () => {
    expect(parseLedgerLine(line)).toMatchObject({ journalId: 'j1', journalNumber: 'JV-FY2026-00007', debit: 250000, balance: null, sourceType: 'sales_invoice', dimensions: { [D1]: V1 } });
    expect(parseLedgerLine({ ...line, balance: m(250000) }).balance).toBe(250000);
  });
  it('reads the ledger header and the drill summary', () => {
    const h = parseLedgerHeader({ currency: 'USD', account: acct('1300', 'Inventory', { account_type: 'asset', subtype: null }), from: '2026-01-01', to: null, opening_balance: m(0), summary: { debit: m(10), credit: m(4), line_count: 2 }, closing_balance: m(6) });
    expect(h).toMatchObject({ opening: 0, closing: 6, totalDebit: 10, totalCredit: 4, lineCount: 2, to: null });
    const s = parseDrillSummary({ debit: m(10), credit: m(4), net: m(6), line_count: 2 }, acct('1300', 'Inventory'));
    expect(s).toMatchObject({ net: 6, lineCount: 2 });
  });
  it('turns a drill key into the query the drill endpoint reads', () => {
    const key = toDrillKey({ account_id: A1, from: null, to: '2026-11-02', exclude_closing: true, contact_side: 'credit', dimensions: { [D1]: [V1] } });
    expect(key).toBeDefined();
    expect(drillQuery(key!)).toEqual({ account_id: A1, to: '2026-11-02', exclude_closing: 'true', contact_side: 'credit', [`dimensions[${D1}]`]: V1 });
    expect(drillQuery({ account_id: A1, from: '2026-10-01', to: '2026-10-31', exclude_closing: false })).toEqual({ account_id: A1, from: '2026-10-01', to: '2026-10-31', exclude_closing: 'false' });
  });
  it('reads an export ticket', () => {
    expect(parseExportTicket({ data: { id: 'e1', status: 'queued', report: 'trial-balance', format: 'pdf' } })).toEqual({ id: 'e1', status: 'queued' });
    expect(parseExportTicket({ data: { id: 'e1', status: 'failed' } }).status).toBe('failed');
  });
});

describe('selection', () => {
  const periods: PeriodChoice[] = [
    { id: 'p-adj', name: 'Adjustments', starts_on: '2026-12-31', ends_on: '2026-12-31', kind: 'adjustment' },
    { id: 'p-oct', name: 'Oct 2026', starts_on: '2026-10-01', ends_on: '2026-10-31', kind: 'regular' },
    { id: 'p-nov', name: 'Nov 2026', starts_on: '2026-11-01', ends_on: '2026-11-30', kind: 'regular' },
  ];
  const base: ReportSelection = { when: { kind: 'period', periodId: 'p-oct' }, basis: 'ytd', comparison: 'previous_period', hideZero: true, dims: { [D1]: V1 }, accountId: A1 };

  it('builds the query the API expects, with dimensions as brackets', () => {
    expect(selectionQuery(base, { basis: true, comparison: true })).toEqual({
      period_id: 'p-oct', basis: 'ytd', comparison: 'previous_period', hide_zero: 'true', [`dimensions[${D1}]`]: V1, account_id: A1,
    });
    expect(selectionQuery({ ...base, when: { kind: 'asof', date: '2026-11-02' } }, {})).toMatchObject({ as_of: '2026-11-02' });
    expect(selectionQuery({ ...base, when: { kind: 'range', from: '', to: '2026-11-02' } }, {})).toEqual(expect.not.objectContaining({ from: expect.anything() }));
  });
  it('round trips through the query string', () => {
    const pid = '01a19a49-35e9-71d9-bab8-6ad8981db000';
    const back = selectionFromSearch(selectionToSearch({ ...base, when: { kind: 'period', periodId: pid } }));
    expect(back).toMatchObject({ when: { kind: 'period', periodId: pid }, basis: 'ytd', comparison: 'previous_period', hideZero: true, accountId: A1, dims: { [D1]: V1 } });
    const range = selectionFromSearch(selectionToSearch({ ...base, when: { kind: 'range', from: '2026-01-01', to: '2026-09-30' } }));
    expect(range.when).toEqual({ kind: 'range', from: '2026-01-01', to: '2026-09-30' });
  });
  it('ignores ids that are not ids', () => {
    const sp = new URLSearchParams({ period: 'nope', asof: '2026-13', account: 'x', 'd.bad': 'y' });
    expect(selectionFromSearch(sp)).toEqual({});
  });
  it('defaults to today for as-of reports and the current period for range reports', () => {
    expect(defaultSelection('asof', periods, '2026-11-02').when).toEqual({ kind: 'asof', date: '2026-11-02' });
    expect(defaultSelection('range', periods, '2026-11-02').when).toEqual({ kind: 'period', periodId: 'p-nov' });
    expect(defaultSelection('range', [], '2026-11-02').when).toEqual({ kind: 'range', from: '2026-11-01', to: '2026-11-02' });
    expect(currentPeriod(periods, '2027-03-01')?.id).toBe('p-nov');
  });
  it('turns a range from a link into an as-of date for an as-of report', () => {
    const sp = new URLSearchParams({ from: '2026-01-01', to: '2026-09-30' });
    expect(resolveSelection(sp, 'asof', periods, '2026-11-02').when).toEqual({ kind: 'asof', date: '2026-09-30' });
    expect(resolveSelection(new URLSearchParams({ asof: '2026-09-30' }), 'range', periods, '2026-11-02').when).toEqual({ kind: 'range', from: '2026-09-01', to: '2026-09-30' });
  });
  it('lets the person turn the default hide-zero off', () => {
    expect(resolveSelection(new URLSearchParams(), 'asof', periods, '2026-11-02', true).hideZero).toBe(true);
    expect(resolveSelection(new URLSearchParams({ zero: '0' }), 'asof', periods, '2026-11-02', true).hideZero).toBe(false);
  });
});
