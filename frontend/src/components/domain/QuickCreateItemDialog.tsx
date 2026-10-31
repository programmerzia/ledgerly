import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useLedgerStore } from '@/mock/store';
import type { Item } from '@/types';
import { MoneyInput } from './MoneyInput';
import { Kbd } from '@/components/ui/kbd';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (item: Item) => void;
  initialName?: string;
}

const skuFromName = (name: string) =>
  name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 20);

const fieldCls =
  'h-8 px-2.5 bg-surface border border-border rounded-sm text-xs text-text-primary focus:outline-none focus:border-accent';

export const QuickCreateItemDialog: React.FC<Props> = ({ open, onOpenChange, onCreated, initialName = '' }) => {
  const { items, accounts, taxCodes, addItem } = useLedgerStore();
  const incomeAccounts = accounts.filter((a) => a.account_type === 'income');

  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [skuEdited, setSkuEdited] = useState(false);
  const [price, setPrice] = useState(0);
  const [incomeCode, setIncomeCode] = useState('4000');
  const [taxCode, setTaxCode] = useState('VAT5');
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName(initialName);
      setSku(skuFromName(initialName));
      setSkuEdited(false);
      setPrice(0);
      setIncomeCode('4000');
      setTaxCode('VAT5');
      setError('');
    }
  }, [open, initialName]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError('Give the item a name.');
    const finalSku = (sku.trim() || skuFromName(trimmed)).toUpperCase();
    if (!finalSku) return setError('Give the item a code (SKU).');
    if (items.some((i) => i.sku.toUpperCase() === finalSku)) {
      return setError(`The code ${finalSku} is already used. Change it to something unique.`);
    }
    const acct = accounts.find((a) => a.code === incomeCode);
    const item: Item = {
      id: `itm-${Date.now()}`,
      sku: finalSku,
      name: trimmed,
      type: 'service',
      sales_price: price,
      income_account: incomeCode,
      income_account_name: acct?.name ?? '',
      purchase_price: 0,
      expense_account: '5000',
      tax_code: taxCode,
      is_active: true,
      total_sold_qty: 0,
    };
    addItem(item);
    toast.success(`Item ${item.name} created`);
    onOpenChange(false);
    onCreated?.(item);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>New item</DialogTitle>
          <DialogDescription>Saved to your price list and added to this line.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
            Name
            <input
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!skuEdited) setSku(skuFromName(e.target.value));
              }}
              placeholder="e.g. Monthly support plan"
              className={fieldCls}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
              Code (SKU)
              <input
                value={sku}
                onChange={(e) => {
                  setSku(e.target.value.toUpperCase());
                  setSkuEdited(true);
                }}
                className={`${fieldCls} font-mono`}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
              Price (before tax)
              <MoneyInput value={price} onChange={setPrice} size="sm" />
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
              Income account
              <select value={incomeCode} onChange={(e) => setIncomeCode(e.target.value)} className={fieldCls}>
                {incomeAccounts.map((a) => (
                  <option key={a.id} value={a.code}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-text-secondary">
              Tax
              <select value={taxCode} onChange={(e) => setTaxCode(e.target.value)} className={fieldCls}>
                {taxCodes.map((t) => (
                  <option key={t.id} value={t.code}>
                    {t.code} ({(t.rate * 100).toFixed(0)}%)
                  </option>
                ))}
              </select>
            </label>
          </div>
          {error && <p className="text-xs text-danger font-medium">{error}</p>}
          <DialogFooter>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="h-8 px-3 rounded-sm border border-border text-xs font-medium text-text-secondary hover:bg-surface-neutral"
            >
              Cancel <Kbd className="ml-1">Esc</Kbd>
            </button>
            <button
              type="submit"
              className="h-8 px-4 rounded-sm bg-accent hover:bg-accent-hover text-white text-xs font-semibold"
            >
              Create item <Kbd className="ml-1 bg-white/20 border-white/30 text-white">↵</Kbd>
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
