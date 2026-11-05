import { describe, expect, it } from 'vitest';
import {
  applyPaste, cellKey, changedCells, fillAcross, formatAmount, gridFromLines, parseAmount, parseClipboard, rowKeyOf, rowTotal, type GridLine, type GridPeriod,
} from '../src/api/adapters/budgets';
import { isLiveRoute } from '../src/data/liveRoutes';
import { missingUploadOptions } from '../src/api/adapters/imports';

const periods: GridPeriod[] = [1, 2, 3, 4].map((n) => ({ id: `p${n}`, number: n, name: `M${n}`, starts_on: `2026-0${n}-01`, ends_on: `2026-0${n}-28` }));
const code = (id: string) => ({ a4000: '4000', a5000: '5000' })[id as 'a4000'] ?? id;

describe('amounts are integer minor units, parsed from text without floats', () => {
  it('reads plain, grouped, negative and bracketed amounts', () => {
    expect(parseAmount('1234.56', 2)).toBe(123456);
    expect(parseAmount('1,234.5', 2)).toBe(123450);
    expect(parseAmount('  1 000 ', 2)).toBe(100000);
    expect(parseAmount('-12.30', 2)).toBe(-1230);
    expect(parseAmount('(12.30)', 2)).toBe(-1230);
    expect(parseAmount('', 2)).toBe(0);
    expect(parseAmount('0.1', 2)).toBe(10);
    expect(parseAmount('19.99', 2)).toBe(1999);
    expect(parseAmount('5', 0)).toBe(5);
  });
  it('refuses what is not an amount or has too many decimals', () => {
    for (const bad of ['abc', '1.234', '1e3', '12.3.4', '--5', '$5']) expect(parseAmount(bad, 2)).toBeNull();
    expect(parseAmount('12.340', 2)).toBe(1234);   // trailing zeros beyond the scale are not lost precision
    expect(parseAmount('9999999999999999', 0)).toBeNull();
  });
  it('formats back without grouping, and shows a zero as empty', () => {
    expect(formatAmount(123456, 2)).toBe('1234.56');
    expect(formatAmount(5, 2)).toBe('0.05');
    expect(formatAmount(-1230, 2)).toBe('-12.30');
    expect(formatAmount(0, 2)).toBe('');
    expect(formatAmount(7, 0)).toBe('7');
    for (const n of [1, 99, 100, 123456789, -5]) expect(parseAmount(formatAmount(n, 2), 2)).toBe(n);
  });
});

describe('pasting a block from a spreadsheet', () => {
  const lines: GridLine[] = [
    { account_id: 'a4000', fiscal_period_id: 'p1', dimensions: {}, amount: 100 },
    { account_id: 'a5000', fiscal_period_id: 'p1', dimensions: {}, amount: 50 },
  ];
  const grid = gridFromLines(lines, code);

  it('splits rows and tab-separated cells, ignoring the trailing newline', () => {
    expect(parseClipboard('1\t2\r\n3\t4\r\n')).toEqual([['1', '2'], ['3', '4']]);
    expect(parseClipboard('7')).toEqual([['7']]);
  });
  it('fills from the cell it lands on, across columns and down rows', () => {
    const r = applyPaste(grid.rows, periods, 0, 1, [['10', '20'], ['30', '40.5']], 2);
    expect(r.cells).toEqual({ [cellKey('a4000', 'p2')]: 1000, [cellKey('a4000', 'p3')]: 2000, [cellKey('a5000', 'p2')]: 3000, [cellKey('a5000', 'p3')]: 4050 });
    expect(r.invalid).toBe(0);
    expect(r.clipped).toBe(false);
  });
  it('drops what does not fit and counts what is not an amount', () => {
    const r = applyPaste(grid.rows, periods, 1, 3, [['1', '2'], ['3', 'x']], 2);
    expect(r.cells).toEqual({ [cellKey('a5000', 'p4')]: 100 });
    expect(r.clipped).toBe(true);
    const bad = applyPaste(grid.rows, periods, 0, 0, [['1', 'oops', '3']], 2);
    expect(bad.invalid).toBe(1);
    expect(Object.keys(bad.cells)).toHaveLength(2);
  });
  it('fills a value across the rest of the year', () => {
    const row = grid.rows[0];
    expect(fillAcross(row, periods, grid.cells, 0)).toEqual({ [cellKey('a4000', 'p2')]: 100, [cellKey('a4000', 'p3')]: 100, [cellKey('a4000', 'p4')]: 100 });
  });
});

describe('what is saved', () => {
  const server: GridLine[] = [
    { account_id: 'a4000', fiscal_period_id: 'p1', dimensions: {}, amount: 100 },
    { account_id: 'a4000', fiscal_period_id: 'p2', dimensions: {}, amount: 200 },
    { account_id: 'a5000', fiscal_period_id: 'p1', dimensions: { d1: 'v1' }, amount: 50 },
  ];
  it('is only the cells that changed, a cleared cell as 0, with dimensions where the row has them', () => {
    const state = gridFromLines(server, code);
    expect(changedCells(server, state)).toEqual([]);
    state.cells[cellKey('a4000', 'p1')] = 150;
    state.cells[cellKey('a4000', 'p2')] = 0;
    state.cells[cellKey(rowKeyOf('a5000', { d1: 'v1' }), 'p3')] = 75;
    const changes = changedCells(server, state);
    expect(changes).toContainEqual({ account_id: 'a4000', fiscal_period_id: 'p1', amount: 150 });
    expect(changes).toContainEqual({ account_id: 'a4000', fiscal_period_id: 'p2', amount: 0 });
    expect(changes).toContainEqual({ account_id: 'a5000', fiscal_period_id: 'p3', dimensions: { d1: 'v1' }, amount: 75 });
    expect(changes).toHaveLength(3);
  });
  it('treats an absent cell as a clear', () => {
    const state = gridFromLines(server, code);
    delete state.cells[cellKey('a4000', 'p2')];
    expect(changedCells(server, state)).toEqual([{ account_id: 'a4000', fiscal_period_id: 'p2', amount: 0 }]);
  });
  it('keeps rows with different dimensions apart and orders rows by account code', () => {
    const state = gridFromLines(server, code);
    expect(state.rows.map((r) => r.accountId)).toEqual(['a4000', 'a5000']);
    expect(rowKeyOf('a5000', { d2: 'x', d1: 'y' })).toBe(rowKeyOf('a5000', { d1: 'y', d2: 'x' }));
    expect(rowKeyOf('a5000', {})).not.toBe(rowKeyOf('a5000', { d1: 'v1' }));
    expect(rowTotal(state.rows[0], periods, state.cells)).toBe(300);
  });
});

describe('routes and imports', () => {
  it('lists the budget screens and the numbering settings as connected', () => {
    for (const p of ['/acme/budgets', '/acme/reports/budget-vs-actual', '/acme/settings/numbering']) expect(isLiveRoute(p)).toBe(true);
    expect(isLiveRoute('/acme/assets')).toBe(true);
  });
  it('asks for the budget before a budget file can be uploaded', () => {
    expect(missingUploadOptions('budget_lines', {})).toEqual(['budget_id']);
    expect(missingUploadOptions('budget_lines', { budget_id: 'b1' })).toEqual([]);
  });
});
