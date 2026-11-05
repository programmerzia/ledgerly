/**
 * The budget grid editor (plan 3c.16): account rows by period columns, amounts typed in the company currency and kept as integer
 * minor units. Fast to use: arrow keys and Enter move between cells, a block copied from a spreadsheet pastes across cells and rows,
 * Alt+Right (or the arrow button) fills a value across the rest of the year, an annual total is split by the server with the
 * remainder in the last month, and a starting point can be copied from another version or last year's actuals. Nothing is saved
 * until Save; the server re-checks every cell.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, Scissors } from 'lucide-react';
import { toast } from 'sonner';
import { applyPaste, cellKey, fillAcross, formatAmount, parseAmount, parseClipboard, rowTotal, type GridPeriod, type GridRow, type GridState } from '@/api/adapters/budgets';
import { describeError } from '@/api/messages';
import { formatMoney, getCurrencyMinorUnits } from '@/lib/format';
import { cn } from '@/lib/utils';

export interface GridLabels {
  /** "4000 Sales" for an account id. */
  account: (accountId: string) => string;
  /** "DEPT: North" chips for a row's dimension values. */
  dims: (dims: Record<string, string>) => string;
}

interface Props {
  periods: GridPeriod[];
  state: GridState;
  onChange: (next: GridState) => void;
  readOnly: boolean;
  currency: string;
  labels: GridLabels;
  /** Splits an annual total over the year on the server; resolves to the amount per period id. */
  spread: (total: number) => Promise<Array<{ fiscal_period_id: string; amount: number }>>;
}

const cellCls =
  'h-8 w-full min-w-[5.5rem] rounded-[3px] border border-transparent bg-transparent px-1.5 text-right text-[13px] tabular-nums text-text-primary outline-none hover:border-border focus:border-accent focus:bg-surface read-only:text-text-secondary read-only:hover:border-transparent';

export const BudgetGrid: React.FC<Props> = ({ periods, state, onChange, readOnly, currency, labels, spread }) => {
  const scale = getCurrencyMinorUnits(currency);
  const table = useRef<HTMLTableElement>(null);
  const [editing, setEditing] = useState<{ key: string; text: string } | null>(null);
  const [spreadRow, setSpreadRow] = useState<string | null>(null);
  const [spreadText, setSpreadText] = useState('');
  const [busy, setBusy] = useState(false);

  const colTotals = useMemo(() => periods.map((p) => state.rows.reduce((t, r) => t + (state.cells[cellKey(r.key, p.id)] ?? 0), 0)), [periods, state]);

  useEffect(() => setEditing(null), [state.rows.length]);

  const setCells = (cells: Record<string, number>) => onChange({ ...state, cells: { ...state.cells, ...cells } });
  const focusCell = (r: number, c: number) => {
    const el = table.current?.querySelector<HTMLInputElement>(`[data-cell="${r}-${c}"]`);
    if (el) {
      el.focus();
      el.select();
    }
  };

  const commit = (key: string, text: string) => {
    const v = parseAmount(text, scale);
    setEditing(null);
    if (v === null) {
      toast.error(`"${text}" is not an amount. Use digits with at most ${scale} decimals.`);
      return;
    }
    if (v !== (state.cells[key] ?? 0)) setCells({ [key]: v });
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, r: number, c: number, row: GridRow) => {
    const input = e.currentTarget;
    if (e.altKey && e.key === 'ArrowRight' && !readOnly) {
      e.preventDefault();
      const key = cellKey(row.key, periods[c].id);
      const v = editing?.key === key ? parseAmount(editing.text, scale) : (state.cells[key] ?? 0);
      if (v === null) return;
      setEditing(null);
      setCells({ [key]: v, ...fillAcross(row, periods, { ...state.cells, [key]: v }, c) });
      return;
    }
    const atStart = input.selectionStart === 0 && input.selectionEnd === 0;
    const atEnd = input.selectionStart === input.value.length;
    const go = (dr: number, dc: number) => {
      e.preventDefault();
      input.blur();
      window.setTimeout(() => focusCell(r + dr, c + dc), 0);
    };
    if (e.key === 'ArrowDown' || (e.key === 'Enter' && !e.shiftKey)) go(1, 0);
    else if (e.key === 'ArrowUp' || (e.key === 'Enter' && e.shiftKey)) go(-1, 0);
    else if (e.key === 'ArrowRight' && atEnd) go(0, 1);
    else if (e.key === 'ArrowLeft' && atStart) go(0, -1);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLInputElement>, r: number, c: number) => {
    if (readOnly) return;
    const block = parseClipboard(e.clipboardData.getData('text'));
    if (block.length === 0 || (block.length === 1 && block[0].length === 1)) return;   // one value: the browser's own paste
    e.preventDefault();
    const res = applyPaste(state.rows, periods, r, c, block, scale);
    setEditing(null);
    setCells(res.cells);
    const n = Object.keys(res.cells).length;
    const notes = [res.invalid > 0 ? `${res.invalid} not an amount, skipped` : '', res.clipped ? 'the rest did not fit the grid and was dropped' : ''].filter(Boolean);
    toast[res.invalid > 0 || res.clipped ? 'warning' : 'success'](`Pasted ${n} ${n === 1 ? 'cell' : 'cells'}${notes.length ? `: ${notes.join('; ')}` : ''}. Save to keep them.`);
  };

  const fillRow = (row: GridRow) => {
    const from = periods.findIndex((p) => (state.cells[cellKey(row.key, p.id)] ?? 0) !== 0);
    if (from < 0) return;
    setCells(fillAcross(row, periods, state.cells, from));
  };

  const applySpread = async (row: GridRow) => {
    const total = parseAmount(spreadText, scale);
    if (total === null || total === 0) {
      toast.error('Enter the annual total as an amount.');
      return;
    }
    setBusy(true);
    try {
      const parts = await spread(total);
      const cells: Record<string, number> = {};
      for (const p of parts) cells[cellKey(row.key, p.fiscal_period_id)] = p.amount;
      setCells(cells);
      setSpreadRow(null);
      setSpreadText('');
    } catch (err) {
      toast.error(describeError(err));
    } finally {
      setBusy(false);
    }
  };

  if (state.rows.length === 0) {
    return <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-[13px] text-text-muted" data-testid="budget-empty">No accounts in this budget yet. Add an account below, or copy a starting point.</p>;
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface">
      <table ref={table} className="w-full border-collapse text-[13px]" data-testid="budget-grid">
        <thead>
          <tr className="border-b border-border text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
            <th className="sticky left-0 z-10 min-w-[14rem] bg-surface px-3 py-2 text-left">Account</th>
            {periods.map((p) => <th key={p.id} className="px-1 py-2 text-right">{p.name}</th>)}
            <th className="px-3 py-2 text-right">Total (as typed)</th>
            {!readOnly && <th className="w-16 px-2 py-2"><span className="sr-only">Row actions</span></th>}
          </tr>
        </thead>
        <tbody>
          {state.rows.map((row, r) => (
            <tr key={row.key} data-row={row.key} className="border-b border-border/60 last:border-0 hover:bg-surface-neutral/40">
              <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-1 text-left font-normal text-text-primary">
                <div>{labels.account(row.accountId)}</div>
                {Object.keys(row.dims).length > 0 && <div className="text-[11px] text-text-muted">{labels.dims(row.dims)}</div>}
              </th>
              {periods.map((p, c) => {
                const key = cellKey(row.key, p.id);
                const value = state.cells[key] ?? 0;
                return (
                  <td key={p.id} className="px-0.5 py-0.5">
                    <input
                      data-cell={`${r}-${c}`}
                      aria-label={`${labels.account(row.accountId)}, ${p.name}`}
                      inputMode="decimal"
                      autoComplete="off"
                      className={cellCls}
                      readOnly={readOnly}
                      value={editing?.key === key ? editing.text : formatAmount(value, scale)}
                      onFocus={(e) => { setEditing({ key, text: formatAmount(value, scale) }); e.currentTarget.select(); }}
                      onChange={(e) => setEditing({ key, text: e.target.value })}
                      onBlur={(e) => { if (!readOnly && editing?.key === key) commit(key, e.target.value); }}
                      onKeyDown={(e) => onKeyDown(e, r, c, row)}
                      onPaste={(e) => onPaste(e, r, c)}
                    />
                  </td>
                );
              })}
              <td className="px-3 py-1 text-right font-medium tabular-nums text-text-primary" data-testid="row-total">{formatMoney(rowTotal(row, periods, state.cells), currency)}</td>
              {!readOnly && (
                <td className="whitespace-nowrap px-2 py-1 text-right">
                  <button type="button" title="Fill the first amount across the rest of the year" aria-label={`Fill across, ${labels.account(row.accountId)}`} className="mr-1 cursor-pointer text-text-muted hover:text-accent" onClick={() => fillRow(row)}>
                    <ArrowRight className="size-3.5" />
                  </button>
                  <button type="button" title="Split an annual total over the year" aria-label={`Spread an annual total, ${labels.account(row.accountId)}`} className="cursor-pointer text-text-muted hover:text-accent" onClick={() => { setSpreadRow(spreadRow === row.key ? null : row.key); setSpreadText(''); }}>
                    <Scissors className="size-3.5" />
                  </button>
                  {spreadRow === row.key && (
                    <div className="absolute right-4 z-20 mt-1 flex items-center gap-2 rounded-md border border-border bg-surface-elevated p-2 shadow-md">
                      <input aria-label="Annual total" autoFocus inputMode="decimal" className={cn(cellCls, 'w-32 border-border')} placeholder="Annual total" value={spreadText} onChange={(e) => setSpreadText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void applySpread(row); if (e.key === 'Escape') setSpreadRow(null); }} />
                      <button type="button" disabled={busy} className="h-8 rounded-md bg-accent px-3 text-xs font-medium text-white disabled:opacity-60" onClick={() => void applySpread(row)}>Split</button>
                    </div>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t border-border-strong font-semibold">
            <th scope="row" className="sticky left-0 bg-surface px-3 py-2 text-left">Total (as typed)</th>
            {colTotals.map((t, i) => <td key={periods[i].id} className="px-2 py-2 text-right tabular-nums">{formatMoney(t, currency)}</td>)}
            <td className="px-3 py-2 text-right tabular-nums">{formatMoney(colTotals.reduce((a, b) => a + b, 0), currency)}</td>
            {!readOnly && <td />}
          </tr>
        </tfoot>
      </table>
    </div>
  );
};
