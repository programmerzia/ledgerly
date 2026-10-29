import React from 'react';
import { cn } from '@/lib/utils';
import { Account, Dimension, TaxCode } from '@/types';
import { AccountPicker } from './AccountPicker';
import { DimensionChips } from './DimensionChips';
import { MoneyInput } from './MoneyInput';
import { Plus, Trash2, Copy, AlertCircle, CheckCircle2, MoreVertical, PlusCircle } from 'lucide-react';
import { formatMoney } from '@/lib/format';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';

export interface GridLineItem {
  id: string;
  line_no: number;
  account_id: string;
  description: string;
  quantity?: number;
  unit_price_fc?: number; // minor units
  discount_pct?: number;
  tax_code_id?: string;
  line_total_fc?: number; // minor units
  tax_amount_fc?: number; // minor units
  debit?: number; // minor units for journals
  credit?: number; // minor units for journals
  dimensions: {
    branch?: string;
    cost_centre?: string;
    project?: string;
  };
  errors?: Record<string, string>;
}

interface LineGridProps {
  mode?: 'invoice' | 'journal';
  lines: GridLineItem[];
  onChange: (lines: GridLineItem[]) => void;
  accounts: Account[];
  dimensions: Dimension[];
  taxCodes?: TaxCode[];
  currency?: string;
  readOnly?: boolean;
  className?: string;
}

export const LineGrid: React.FC<LineGridProps> = ({
  mode = 'invoice',
  lines,
  onChange,
  accounts,
  dimensions,
  taxCodes = [],
  currency = 'USD',
  readOnly = false,
  className,
}) => {
  const isInvoice = mode === 'invoice';

  const updateLine = (index: number, updates: Partial<GridLineItem>) => {
    const newLines = [...lines];
    const target = { ...newLines[index], ...updates };

    if (isInvoice) {
      const qty = target.quantity ?? 1;
      const price = target.unit_price_fc ?? 0;
      const subtotal = Math.round(qty * price);
      target.line_total_fc = subtotal;

      const tax = taxCodes.find((t) => t.id === target.tax_code_id);
      if (tax && tax.rate > 0) {
        target.tax_amount_fc = Math.round(subtotal * tax.rate);
      } else {
        target.tax_amount_fc = 0;
      }
    }

    newLines[index] = target;
    onChange(newLines);
  };

  const addLine = () => {
    const newLine: GridLineItem = {
      id: `line-${Date.now()}-${lines.length + 1}`,
      line_no: lines.length + 1,
      account_id: '',
      description: '',
      quantity: 1,
      unit_price_fc: 0,
      tax_code_id: taxCodes[0]?.id || '',
      line_total_fc: 0,
      tax_amount_fc: 0,
      debit: 0,
      credit: 0,
      dimensions: {},
    };
    onChange([...lines, newLine]);
  };

  const removeLine = (index: number) => {
    if (lines.length <= 1) return;
    const filtered = lines.filter((_, i) => i !== index).map((l, i) => ({ ...l, line_no: i + 1 }));
    onChange(filtered);
  };

  const duplicateLine = (index: number) => {
    const lineToDup = lines[index];
    const duplicated: GridLineItem = {
      ...lineToDup,
      id: `line-${Date.now()}-${lines.length + 1}`,
      line_no: lines.length + 1,
    };
    const nextLines = [...lines];
    nextLines.splice(index + 1, 0, duplicated);
    onChange(nextLines.map((l, i) => ({ ...l, line_no: i + 1 })));
  };

  // Keyboard navigation: Enter on a line adds or focuses next
  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      addLine();
    }
  };

  // Computations for totals & balancing
  const subtotal = lines.reduce((s, l) => s + (l.line_total_fc || 0), 0);
  const totalTax = lines.reduce((s, l) => s + (l.tax_amount_fc || 0), 0);
  const grandTotal = subtotal + totalTax;

  const totalDebit = lines.reduce((s, l) => s + (l.debit || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (l.credit || 0), 0);
  const difference = totalDebit - totalCredit;
  const isBalanced = difference === 0;

  return (
    <div className={cn('flex flex-col border border-border rounded-md bg-surface overflow-hidden', className)}>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="bg-surface-neutral/80 border-b border-border text-col-header">
              <th className="w-10 text-center py-2 px-1">#</th>
              <th className="min-w-[200px] py-2 px-2">Account</th>
              <th className="min-w-[180px] py-2 px-2">Description</th>
              <th className="min-w-[170px] py-2 px-2">Dimensions</th>

              {isInvoice ? (
                <>
                  <th className="w-20 text-right py-2 px-2">Qty</th>
                  <th className="w-32 text-right py-2 px-2">Unit Price</th>
                  <th className="w-28 py-2 px-2">Tax Code</th>
                  <th className="w-32 text-right py-2 px-2">Line Total</th>
                </>
              ) : (
                <>
                  <th className="w-32 text-right py-2 px-2">Debit</th>
                  <th className="w-32 text-right py-2 px-2">Credit</th>
                </>
              )}

              {!readOnly && <th className="w-16 text-center py-2 px-1">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {lines.map((line, idx) => {
              const hasLineError = line.errors && Object.keys(line.errors).length > 0;
              const hasBranchError = !line.dimensions?.branch;

              return (
                <ContextMenu key={line.id}>
                  <ContextMenuTrigger asChild>
                    <tr
                      className={cn(
                        'hover:bg-surface-neutral/60 transition-colors h-9',
                        hasLineError && 'bg-danger-soft/20'
                      )}
                      onKeyDown={(e) => handleKeyDown(e, idx)}
                    >
                      {/* Row Index */}
                      <td className="text-center font-mono text-[11px] text-text-muted px-1">{line.line_no}</td>

                      {/* Account Picker */}
                      <td className="px-2">
                        {readOnly ? (
                          <span className="font-mono text-xs">
                            {accounts.find((a) => a.id === line.account_id)?.name || '—'}
                          </span>
                        ) : (
                          <AccountPicker
                            accounts={accounts}
                            value={line.account_id}
                            onChange={(accId) => updateLine(idx, { account_id: accId })}
                            error={!line.account_id && line.errors?.account_id !== undefined}
                          />
                        )}
                      </td>

                      {/* Description */}
                      <td className="px-2">
                        {readOnly ? (
                          <span className="truncate block text-text-primary">{line.description}</span>
                        ) : (
                          <input
                            type="text"
                            value={line.description}
                            onChange={(e) => updateLine(idx, { description: e.target.value })}
                            placeholder="Item or transaction description..."
                            className="w-full h-8 px-2 bg-surface text-text-primary border border-border rounded-sm text-xs focus:outline-none focus:ring-1 focus:ring-accent"
                          />
                        )}
                      </td>

                      {/* Dimensions */}
                      <td className="px-2">
                        <DimensionChips
                          dimensions={dimensions}
                          values={line.dimensions}
                          disabled={readOnly}
                          error={hasBranchError && line.errors?.branch !== undefined}
                          onChange={(dims) => updateLine(idx, { dimensions: dims })}
                        />
                      </td>

                      {isInvoice ? (
                        <>
                          {/* Qty */}
                          <td className="px-2">
                            {readOnly ? (
                              <span className="font-mono text-right block">{line.quantity}</span>
                            ) : (
                              <input
                                type="number"
                                min="1"
                                step="1"
                                value={line.quantity || 1}
                                onChange={(e) =>
                                  updateLine(idx, { quantity: parseFloat(e.target.value) || 0 })
                                }
                                className="w-full h-8 px-2 text-right font-mono text-xs bg-surface text-text-primary border border-border rounded-sm focus:outline-none focus:ring-1 focus:ring-accent"
                              />
                            )}
                          </td>

                          {/* Unit Price */}
                          <td className="px-2">
                            <MoneyInput
                              value={line.unit_price_fc || 0}
                              currency={currency}
                              disabled={readOnly}
                              size="sm"
                              onChange={(val) => updateLine(idx, { unit_price_fc: val })}
                            />
                          </td>

                          {/* Tax Code */}
                          <td className="px-2">
                            {readOnly ? (
                              <span className="text-xs font-mono">
                                {taxCodes.find((t) => t.id === line.tax_code_id)?.code || '—'}
                              </span>
                            ) : (
                              <select
                                value={line.tax_code_id || ''}
                                onChange={(e) => updateLine(idx, { tax_code_id: e.target.value })}
                                className="w-full h-8 px-2 bg-surface text-text-primary border border-border rounded-sm text-xs focus:outline-none focus:ring-1 focus:ring-accent font-mono"
                              >
                                {taxCodes.map((t) => (
                                  <option key={t.id} value={t.id}>
                                    {t.code} ({(t.rate * 100).toFixed(0)}%)
                                  </option>
                                ))}
                              </select>
                            )}
                          </td>

                          {/* Line Total */}
                          <td className="text-right font-mono text-num text-text-primary pr-3 px-2">
                            {formatMoney(line.line_total_fc, currency)}
                          </td>
                        </>
                      ) : (
                        <>
                          {/* Debit */}
                          <td className="px-2">
                            <MoneyInput
                              value={line.debit || 0}
                              currency={currency}
                              disabled={readOnly}
                              size="sm"
                              onChange={(val) => {
                                updateLine(idx, {
                                  debit: val,
                                  credit: val > 0 ? 0 : line.credit,
                                });
                              }}
                            />
                          </td>

                          {/* Credit */}
                          <td className="px-2">
                            <MoneyInput
                              value={line.credit || 0}
                              currency={currency}
                              disabled={readOnly}
                              size="sm"
                              onChange={(val) => {
                                updateLine(idx, {
                                  credit: val,
                                  debit: val > 0 ? 0 : line.debit,
                                });
                              }}
                            />
                          </td>
                        </>
                      )}

                      {/* Actions */}
                      {!readOnly && (
                        <td className="text-center px-1">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => duplicateLine(idx)}
                              title="Duplicate line"
                              className="p-1 text-text-muted hover:text-accent rounded-sm transition-colors"
                            >
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => removeLine(idx)}
                              disabled={lines.length <= 1}
                              title="Delete line"
                              className="p-1 text-text-muted hover:text-danger disabled:opacity-30 rounded-sm transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  </ContextMenuTrigger>
                  <ContextMenuContent>
                    <ContextMenuItem onClick={() => duplicateLine(idx)}>
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      <span>Duplicate Line (Ctrl+D)</span>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={addLine}>
                      <PlusCircle className="mr-2 h-3.5 w-3.5" />
                      <span>Insert Line Below</span>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onClick={() =>
                        updateLine(idx, {
                          description: '',
                          quantity: 1,
                          unit_price_fc: 0,
                          line_total_fc: 0,
                          debit: 0,
                          credit: 0,
                        })
                      }
                    >
                      <span>Clear Line Values</span>
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => {
                        if (line.description) navigator.clipboard.writeText(line.description);
                      }}
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      <span>Copy Description</span>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onClick={() => removeLine(idx)}
                      disabled={lines.length <= 1}
                      className="text-danger focus:text-danger"
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      <span>Delete Line</span>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Grid Footer */}
      <div className="p-3 border-t border-border bg-surface-neutral/40 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        {!readOnly ? (
          <button
            type="button"
            onClick={addLine}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-surface border border-border hover:border-accent text-text-primary rounded-sm text-xs font-medium shadow-xs transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5 text-accent" />
            <span>Add Line</span>
            <span className="hidden sm:inline text-[10px] text-text-muted font-mono ml-1.5">(⌘ + Enter)</span>
          </button>
        ) : (
          <div />
        )}

        {/* Totals & Balancing Section */}
        {isInvoice ? (
          <div className="flex flex-wrap items-center justify-end gap-3 sm:gap-6 text-xs font-mono sm:ml-auto">
            <div className="flex items-center gap-2">
              <span className="text-text-muted uppercase tracking-wider text-[11px]">Subtotal:</span>
              <span className="font-semibold text-text-primary">{formatMoney(subtotal, currency)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-text-muted uppercase tracking-wider text-[11px]">Tax:</span>
              <span className="font-semibold text-text-primary">{formatMoney(totalTax, currency)}</span>
            </div>
            <div className="flex items-center gap-2 pl-3 border-l border-border">
              <span className="text-text-primary font-semibold uppercase tracking-wider text-xs">Total:</span>
              <span className="text-sm font-bold text-accent">{formatMoney(grandTotal, currency)}</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-3 sm:gap-4 text-xs font-mono sm:ml-auto">
            <div className="flex items-center gap-2">
              <span className="text-text-muted uppercase tracking-wider text-[11px]">Total Debit:</span>
              <span className="font-semibold text-text-primary">{formatMoney(totalDebit, currency)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-text-muted uppercase tracking-wider text-[11px]">Total Credit:</span>
              <span className="font-semibold text-text-primary">{formatMoney(totalCredit, currency)}</span>
            </div>

            {/* Live Balancing Difference Pill */}
            <div
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-sm border text-xs font-medium font-sans',
                isBalanced
                  ? 'bg-success-soft text-success border-transparent'
                  : 'bg-danger-soft text-danger border-transparent'
              )}
            >
              {isBalanced ? (
                <>
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Balanced</span>
                </>
              ) : (
                <>
                  <AlertCircle className="w-3.5 h-3.5" />
                  <span>
                    Diff: {formatMoney(Math.abs(difference), currency)} {difference > 0 ? 'Dr' : 'Cr'}
                  </span>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
