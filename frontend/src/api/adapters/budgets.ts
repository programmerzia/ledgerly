/**
 * Budget grid logic (plan 3c.16), live mode. Amounts are integer minor units of the base currency, in the account's own
 * direction (income and expense both positive). Text is parsed and formatted as strings: no floating point touches a
 * figure, and an annual split is the server's (`GET budgets/{id}/spread`).
 */

export interface GridPeriod {
  id: string;
  number: number;
  name: string;
  starts_on: string;
  ends_on: string;
}

export interface GridLine {
  account_id: string;
  fiscal_period_id: string;
  /** dimension id -> value id */
  dimensions: Record<string, string>;
  amount: number;
}

export interface GridRow {
  key: string;
  accountId: string;
  dims: Record<string, string>;
}

export interface GridState {
  rows: GridRow[];
  /** `${rowKey}#${periodId}` -> minor units; a missing key is 0 */
  cells: Record<string, number>;
}

export const cellKey = (rowKey: string, periodId: string): string => `${rowKey}#${periodId}`;

export function rowKeyOf(accountId: string, dims: Record<string, string>): string {
  const parts = Object.entries(dims).filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b)).map(([d, v]) => `${d}:${v}`);
  return parts.length === 0 ? accountId : `${accountId}|${parts.join(',')}`;
}

/** Rows and cells from the server's lines; rows ordered by account code, then dimensions. */
export function gridFromLines(lines: GridLine[], codeOf: (accountId: string) => string): GridState {
  const rows = new Map<string, GridRow>();
  const cells: Record<string, number> = {};
  for (const l of lines) {
    const key = rowKeyOf(l.account_id, l.dimensions);
    if (!rows.has(key)) rows.set(key, { key, accountId: l.account_id, dims: { ...l.dimensions } });
    cells[cellKey(key, l.fiscal_period_id)] = l.amount;
  }
  const ordered = [...rows.values()].sort((a, b) => codeOf(a.accountId).localeCompare(codeOf(b.accountId)) || a.key.localeCompare(b.key));
  return { rows: ordered, cells };
}

/** Money text -> minor units. Blank is 0 (clears the cell). `null` when it is not an amount with at most `scale` decimals. */
export function parseAmount(text: string, scale: number): number | null {
  let s = text.replace(/[\s ]/g, '');
  if (s === '') return 0;
  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  } else if (s.startsWith('+')) s = s.slice(1);
  s = s.replace(/,/g, '');
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return null;
  const frac = m[2] ?? '';
  if (frac.length > scale) return /^0*$/.test(frac.slice(scale)) ? finish(m[1], frac.slice(0, scale), scale, negative) : null;
  return finish(m[1], frac, scale, negative);
}

function finish(whole: string, frac: string, scale: number, negative: boolean): number | null {
  const digits = whole + frac.padEnd(scale, '0');
  const n = Number(digits);
  if (!Number.isSafeInteger(n) || n > 999_999_999_999_999) return null;
  return negative && n !== 0 ? -n : n;
}

/** Minor units -> plain editable text ("1234.50"); 0 shows as empty. */
export function formatAmount(minor: number, scale: number): string {
  if (minor === 0) return '';
  const abs = Math.abs(minor).toString().padStart(scale + 1, '0');
  const body = scale === 0 ? abs : `${abs.slice(0, -scale)}.${abs.slice(-scale)}`;
  return minor < 0 ? `-${body}` : body;
}

/** A pasted block from a spreadsheet: rows of tab-separated cells. A trailing newline does not make an empty row. */
export function parseClipboard(text: string): string[][] {
  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();
  return rows.map((r) => r.split('\t'));
}

export interface PasteResult {
  cells: Record<string, number>;
  /** Cells that were not an amount; they are skipped. */
  invalid: number;
  /** The block reached past the last row or the last period; the overflow is dropped. */
  clipped: boolean;
}

/** Writes a pasted block into the grid starting at (row, column); returns the cells it sets. */
export function applyPaste(rows: GridRow[], periods: GridPeriod[], startRow: number, startCol: number, block: string[][], scale: number): PasteResult {
  const cells: Record<string, number> = {};
  let invalid = 0;
  let clipped = false;
  block.forEach((line, i) => {
    const row = rows[startRow + i];
    if (!row) {
      clipped = true;
      return;
    }
    line.forEach((raw, j) => {
      const period = periods[startCol + j];
      if (!period) {
        clipped = true;
        return;
      }
      const v = parseAmount(raw, scale);
      if (v === null) invalid += 1;
      else cells[cellKey(row.key, period.id)] = v;
    });
  });
  return { cells, invalid, clipped };
}

/** The value of column `from` copied into every column to its right. */
export function fillAcross(row: GridRow, periods: GridPeriod[], cells: Record<string, number>, from: number): Record<string, number> {
  const value = cells[cellKey(row.key, periods[from]?.id ?? '')] ?? 0;
  const out: Record<string, number> = {};
  for (let c = from + 1; c < periods.length; c++) out[cellKey(row.key, periods[c].id)] = value;
  return out;
}

export interface SaveCell {
  account_id: string;
  fiscal_period_id: string;
  dimensions?: Record<string, string>;
  amount: number;
}

/** What differs from the server's lines, as cells to save (a cleared cell is sent as 0). */
export function changedCells(server: GridLine[], state: GridState): SaveCell[] {
  const rowsByKey = new Map(state.rows.map((r) => [r.key, r]));
  const before: Record<string, GridLine> = {};
  for (const l of server) before[cellKey(rowKeyOf(l.account_id, l.dimensions), l.fiscal_period_id)] = l;
  const out: SaveCell[] = [];
  const emit = (accountId: string, periodId: string, dims: Record<string, string>, amount: number) => {
    const cell: SaveCell = { account_id: accountId, fiscal_period_id: periodId, amount };
    if (Object.keys(dims).length > 0) cell.dimensions = dims;
    out.push(cell);
  };
  for (const [k, v] of Object.entries(state.cells)) {
    const row = rowsByKey.get(k.slice(0, k.indexOf('#')));
    if (row && (before[k]?.amount ?? 0) !== v) emit(row.accountId, k.slice(k.indexOf('#') + 1), row.dims, v);
  }
  // A saved cell the grid no longer holds is cleared.
  for (const [k, l] of Object.entries(before)) if (!(k in state.cells) && l.amount !== 0) emit(l.account_id, l.fiscal_period_id, l.dimensions, 0);
  return out;
}

/** The row total in minor units, for display only: it is a sum of the cells the person typed, and the server re-adds on save. */
export function rowTotal(row: GridRow, periods: GridPeriod[], cells: Record<string, number>): number {
  let t = 0;
  for (const p of periods) t += cells[cellKey(row.key, p.id)] ?? 0;
  return t;
}
