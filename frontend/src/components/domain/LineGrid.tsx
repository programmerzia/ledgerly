import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Account, Dimension, TaxCode, Item } from '@/types';
import { ItemPicker } from './ItemPicker';
import { Kbd } from '@/components/ui/kbd';
import { AccountPicker } from './AccountPicker';
import { DimensionChips } from './DimensionChips';
import { MoneyInput } from './MoneyInput';
import { Plus, Trash2, Copy, AlertCircle, CheckCircle2, PlusCircle } from 'lucide-react';
import { formatMoney } from '@/lib/format';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { FieldHelp } from './FieldHelp';

export interface GridLineItem {
  id: string;
  line_no: number;
  /** Set when the line was filled from the price list. */
  item_id?: string;
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
  /** Hide the built-in totals strip when the page renders its own totals block. */
  showTotals?: boolean;
  /** Price list; when given, invoice mode shows an Item picker as the first column. */
  items?: Item[];
  /** Pre-fill for new lines (e.g. from the customer). */
  lineDefaults?: { account_id?: string; tax_code_id?: string; branch?: string };
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
  showTotals = true,
  items,
  lineDefaults,
  className,
}) => {
  const isInvoice = mode === 'invoice';
  const showItems = isInvoice && !!items;
  const focusNewRow = useRef(false);

  useEffect(() => {
    if (!focusNewRow.current) return;
    focusNewRow.current = false;
    const last = lines[lines.length - 1];
    if (!last) return;
    document.querySelector<HTMLElement>(`[data-item-picker="${last.id}"]`)?.focus();
  }, [lines]);

  const applyItem = (index: number, item: Item) => {
    const acct = accounts.find((a) => a.code === item.income_account);
    const tax = taxCodes.find((t) => t.code === item.tax_code);
    const current = lines[index];
    updateLine(index, {
      item_id: item.id,
      description: item.name,
      unit_price_fc: item.sales_price,
      ...(acct ? { account_id: acct.id } : {}),
      ...(tax ? { tax_code_id: tax.id } : {}),
      quantity: current.quantity || 1,
      dimensions:
        !current.dimensions?.branch && lineDefaults?.branch
          ? { ...current.dimensions, branch: lineDefaults.branch }
          : current.dimensions,
    });
  };

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
      account_id: lineDefaults?.account_id || '',
      description: '',
      quantity: 1,
      unit_price_fc: 0,
      tax_code_id: lineDefaults?.tax_code_id || taxCodes[0]?.id || '',
      line_total_fc: 0,
      tax_amount_fc: 0,
      debit: 0,
      credit: 0,
      dimensions: lineDefaults?.branch ? { branch: lineDefaults.branch } : {},
    };
    focusNewRow.current = true;
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
    if (e.key !== 'Enter') return;
    if (e.metaKey || e.ctrlKey) {
      // In invoice mode Ctrl/Cmd+Enter belongs to the form (submit for approval).
      if (!isInvoice) {
        e.preventDefault();
        addLine();
      }
      return;
    }
    // Enter on the last cell of the last row starts a new line
    const target = e.target as HTMLElement;
    if (isInvoice && !readOnly && index === lines.length - 1 && target.dataset.lastCell === 'true') {
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
              {showItems && (
                <th className="min-w-[180px] py-2 px-2">
                  <span className="inline-flex items-center">
                    Item
                    <FieldHelp help="Pick from your price list to fill description, price, account and tax. You can still change any of them." example="Managed Cloud VM" />
                  </span>
                </th>
              )}
              <th className="min-w-[160px] py-2 px-2">
                <span className="inline-flex items-center">
                  Account
                  <FieldHelp help="General ledger posting account for this line." example="4000 Sales Revenue" />
                </span>
              </th>
              <th className="min-w-[180px] py-2 px-2">
                <span className="inline-flex items-center">
                  Description
                  <FieldHelp help="Line narrative or commercial item description." example="Transceiver modules" />
                </span>
              </th>
              <th className="min-w-[130px] py-2 px-2">
                <span className="inline-flex items-center">
                  Dimensions
                  <FieldHelp help="Branch, Cost centre or Project tags for segmental accounting." example="Branch = Mogadishu" />
                </span>
              </th>

              {isInvoice ? (
                <>
                  <th className="w-16 min-w-[64px] text-right py-2 px-2">
                    <span className="inline-flex items-center justify-end">
                      Qty
                      <FieldHelp help="Quantity of goods or services billed." example="1" />
                    </span>
                  </th>
                  <th className="w-28 min-w-[110px] text-right py-2 px-2">
                    <span className="inline-flex items-center justify-end">
                      Unit price
                      <FieldHelp help="Price per unit in transaction currency." example="500.00" />
                    </span>
                  </th>
                  <th className="w-24 min-w-[96px] py-2 px-2">
                    <span className="inline-flex items-center">
                      Tax code
                      <FieldHelp help="Applicable tax treatment (e.g. VAT 5%, Zero Rated, Exempt)." example="tax-vat5" />
                    </span>
                  </th>
                  <th className="w-28 min-w-[110px] text-right py-2 px-2">
                    <span className="inline-flex items-center justify-end">
                      Line total
                      <FieldHelp help="Calculated line amount before withholding taxes." />
                    </span>
                  </th>
                </>
              ) : (
                <>
                  <th className="w-32 min-w-[128px] text-right py-2 px-2">
                    <span className="inline-flex items-center justify-end">
                      Debit
                      <FieldHelp help="Debit posting amount in base currency." />
                    </span>
                  </th>
                  <th className="w-32 min-w-[128px] text-right py-2 px-2">
                    <span className="inline-flex items-center justify-end">
                      Credit
                      <FieldHelp help="Credit posting amount in base currency." />
                    </span>
                  </th>
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
                <React.Fragment key={line.id}>
                  <ContextMenu>
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

                      {showItems && (
                        <td className="px-2">
                          {readOnly ? (
                            <span className="text-xs">{items!.find((i) => i.id === line.item_id)?.name || '—'}</span>
                          ) : (
                            <ItemPicker
                              items={items!}
                              value={line.item_id}
                              focusKey={line.id}
                              onChange={(it) => applyItem(idx, it)}
                              currency={currency}
                            />
                          )}
                        </td>
                      )}

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
                          <span className="block whitespace-normal break-words text-text-primary">{line.description}</span>
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

                          {/* Unit price */}
                          <td className="px-2">
                            <MoneyInput
                              value={line.unit_price_fc || 0}
                              currency={currency}
                              disabled={readOnly}
                              size="sm"
                              onChange={(val) => updateLine(idx, { unit_price_fc: val })}
                            />
                          </td>

                          {/* Tax code */}
                          <td className="px-2">
                            {readOnly ? (
                              <span className="text-xs font-mono">
                                {taxCodes.find((t) => t.id === line.tax_code_id)?.code || '—'}
                              </span>
                            ) : (
                              <select
                                value={line.tax_code_id || ''}
                                data-last-cell="true"
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

                          {/* Line total */}
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
                      <span>Duplicate line (Ctrl+D)</span>
                    </ContextMenuItem>
                    <ContextMenuItem onClick={addLine}>
                      <PlusCircle className="mr-2 h-3.5 w-3.5" />
                      <span>Insert line below</span>
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
                      <span>Clear line values</span>
                    </ContextMenuItem>
                    <ContextMenuItem
                      onClick={() => {
                        if (line.description) navigator.clipboard.writeText(line.description);
                      }}
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      <span>Copy description</span>
                    </ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem
                      onClick={() => removeLine(idx)}
                      disabled={lines.length <= 1}
                      className="text-danger focus:text-danger"
                    >
                      <Trash2 className="mr-2 h-3.5 w-3.5" />
                      <span>Delete line</span>
                    </ContextMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
                {hasLineError && (
                  <tr className="bg-danger-soft/15 text-danger text-[11px] border-b border-danger/30">
                    <td colSpan={10} className="px-4 py-1.5">
                      <div className="flex items-center gap-1.5 font-medium">
                        <AlertCircle className="w-3.5 h-3.5 text-danger shrink-0" />
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5">
                          {Object.entries(line.errors!).map(([k, msg]) => (
                            <span key={k}>
                              Line {line.line_no}: {msg}
                            </span>
                          ))}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
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
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-surface border border-border hover:border-accent text-text-primary rounded-sm text-xs font-medium transition-colors shrink-0"
          >
            <Plus className="w-3.5 h-3.5 text-accent" />
            <span>Add line</span>
            {!isInvoice && (
              <span className="hidden sm:inline text-[10px] text-text-muted font-mono ml-1.5">(⌘ + Enter)</span>
            )}
          </button>
        ) : (
          <div />
        )}

        {isInvoice && !readOnly && (
          <div className="hidden lg:flex items-center gap-1.5 text-[11px] text-text-muted">
            <Kbd>Enter</Kbd> on the last field adds a line
          </div>
        )}

        {/* Totals & Balancing Section */}
        {!showTotals ? null : isInvoice ? (
          <div className="flex flex-wrap items-center justify-end gap-3 sm:gap-6 text-xs font-mono sm:ml-auto">
            <div className="flex items-center gap-2">
              <span className="text-text-muted text-xs">Subtotal:</span>
              <span className="font-semibold text-text-primary">{formatMoney(subtotal, currency)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-text-muted text-xs">Tax:</span>
              <span className="font-semibold text-text-primary">{formatMoney(totalTax, currency)}</span>
            </div>
            <div className="flex items-center gap-2 pl-3 border-l border-border">
              <span className="text-text-primary font-semibold text-xs">Total:</span>
              <span className="text-sm font-semibold text-accent">{formatMoney(grandTotal, currency)}</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-3 sm:gap-4 text-xs font-mono sm:ml-auto">
            <div className="flex items-center gap-2">
              <span className="text-text-muted text-xs">Total debit:</span>
              <span className="font-semibold text-text-primary">{formatMoney(totalDebit, currency)}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-text-muted text-xs">Total credit:</span>
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
