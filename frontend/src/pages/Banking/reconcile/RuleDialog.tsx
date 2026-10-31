import React, { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useLedgerStore } from '@/mock/store';
import { matchBankRule } from '@/mock/BankTransactions';
import { AccountPicker } from '@/components/domain/AccountPicker';
import { MoneyInput } from '@/components/domain/MoneyInput';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { BankRule } from '@/types';
import { Field, Segmented, SimpleSelect, codableAccounts, dimOptions, inputCls } from './shared';

type Draft = Omit<BankRule, 'id' | 'times_applied' | 'priority'>;

const blank = (): Draft => ({
  name: '',
  is_active: true,
  direction: 'out',
  contains: '',
  account_id: '',
  dimensions: { branch: 'MG' },
});

interface Props {
  open: boolean;
  onClose: () => void;
  /** Rule being edited; omit for a new rule. Pass `template` to prefill a new one (duplicate). */
  rule?: BankRule;
  template?: Partial<Draft>;
}

export const RuleDialog: React.FC<Props> = ({ open, onClose, rule, template }) => {
  const { accounts, taxCodes, contacts, dimensions, bankRules, bankStatementLines, addBankRule, updateBankRule } = useLedgerStore();
  const [d, setD] = useState<Draft>(blank());
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setD(rule ? { ...rule } : { ...blank(), ...template });
  }, [open, rule, template]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  // Live preview: how many open lines this rule alone would catch.
  const matches = useMemo(() => {
    if (!d.contains.trim()) return 0;
    const probe = { ...d, id: 'probe', priority: 0, times_applied: 0, is_active: true } as BankRule;
    return bankStatementLines.filter(
      (l) => l.status === 'unmatched' && !l.pending_journal_id && matchBankRule(l, [probe])
    ).length;
  }, [d, bankStatementLines]);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.contains.trim()) return setError('Enter the words a bank line must contain, for example "FUEL".');
    if (!d.account_id) return setError('Choose the account this rule codes lines to.');
    const clean: Draft = {
      ...d,
      name: d.name.trim() || d.contains.trim(),
      contains: d.contains.trim(),
      min_amount: d.min_amount || undefined,
      max_amount: d.max_amount || undefined,
    };
    if (clean.min_amount && clean.max_amount && clean.min_amount > clean.max_amount) {
      return setError('The smallest amount cannot be larger than the biggest amount.');
    }
    if (rule) {
      updateBankRule(rule.id, clean);
      toast.success(`Rule "${clean.name}" updated.`);
    } else {
      addBankRule({ ...clean, priority: Math.max(0, ...bankRules.map((r) => r.priority)) + 10 });
      toast.success(`Rule "${clean.name}" added. It suggests, you still confirm each line.`);
    }
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl p-6">
        <DialogHeader>
          <DialogTitle>{rule ? 'Edit rule' : 'New bank rule'}</DialogTitle>
          <DialogDescription>
            When a bank line looks like this, suggest coding it the way you set below. Nothing posts until you accept.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex flex-col gap-3">
          <Field label="Rule name">
            <input className={inputCls} autoFocus value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Generator fuel" />
          </Field>
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-xs font-semibold text-text-primary">If the bank line...</div>
            <div className="flex flex-col gap-3">
              <Segmented
                value={d.direction}
                onChange={(v) => set('direction', v as Draft['direction'])}
                options={[
                  { value: 'out', label: 'Money out' },
                  { value: 'in', label: 'Money in' },
                  { value: 'any', label: 'Either' },
                ]}
              />
              <Field label="contains (any part of the description, name or reference)">
                <input className={inputCls} value={d.contains} onChange={(e) => set('contains', e.target.value)} placeholder="e.g. FUEL" aria-label="Contains" />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Smallest amount (optional)">
                  <MoneyInput value={d.min_amount ?? 0} onChange={(v) => set('min_amount', v || undefined)} />
                </Field>
                <Field label="Biggest amount (optional)">
                  <MoneyInput value={d.max_amount ?? 0} onChange={(v) => set('max_amount', v || undefined)} />
                </Field>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-text-secondary" data-testid="rule-preview">
                Would match <b className="tabular-nums text-text-primary">{matches}</b> open {matches === 1 ? 'line' : 'lines'} right now
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-border p-3">
            <div className="mb-2 text-xs font-semibold text-text-primary">...then code it as</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Account" className="col-span-2">
                <AccountPicker accounts={codableAccounts(accounts)} value={d.account_id} onChange={(id) => set('account_id', id)} placeholder="Choose an account..." />
              </Field>
              <Field label="Tax">
                <SimpleSelect
                  aria-label="Tax code"
                  value={d.tax_code_id}
                  onChange={(v) => set('tax_code_id', v)}
                  noneLabel="No tax"
                  options={taxCodes.filter((t) => t.is_active && t.kind !== 'wht').map((t) => ({ value: t.id, label: `${t.code} · ${Math.round(t.rate * 100)}%` }))}
                />
              </Field>
              <Field label="Contact (optional)">
                <SimpleSelect
                  aria-label="Contact"
                  value={d.contact_id}
                  onChange={(v) => set('contact_id', v)}
                  noneLabel="No contact"
                  options={contacts.filter((c) => c.is_active).map((c) => ({ value: c.id, label: c.name }))}
                />
              </Field>
              <Field label="Branch">
                <SimpleSelect
                  aria-label="Branch"
                  allowNone={false}
                  value={d.dimensions?.branch}
                  onChange={(v) => set('dimensions', { ...d.dimensions, branch: v ?? 'MG' })}
                  options={dimOptions(dimensions, 'branch')}
                />
              </Field>
              <Field label="Memo (optional)">
                <input className={inputCls} value={d.memo ?? ''} onChange={(e) => set('memo', e.target.value || undefined)} />
              </Field>
            </div>
          </div>
          {error && (
            <div role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
          <DialogFooter className="gap-2">
            <button type="button" onClick={onClose} className="h-8 rounded-md border border-border px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-neutral">
              Cancel
            </button>
            <button type="submit" className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover">
              {rule ? 'Save rule' : 'Add rule'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
