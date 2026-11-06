import React, { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/domain/PageHeader';
import { EmptyState } from '@/components/domain/EmptyState';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { BulkBar, BulkResultsSheet } from '@/components/live/BulkBar';
import { runBulkRows, useRowSelection, type BulkResult } from '@/data/bulk';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatMoney, getCurrencyMinorUnits } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useBankAccounts, useBankRules, useBankingActions, useContactChoices, useChartAccounts } from '@/data/banking';
import { useTaxCodes } from '@/data/setup';
import { IntentSlot } from '@/api/intentSlot';
import { ApiError } from '@/api/errors';
import { describeError, fieldError } from '@/api/messages';
import {
  bankingErrorText,
  blankRule,
  parseAmountInput,
  reorder,
  ruleProblem,
  toRuleForm,
  toRuleRequest,
  type LiveBankRule,
  type RuleForm,
} from '@/api/adapters/banking';
import { ErrorLine, LoadingLine } from '@/pages/Accounting/live/parts';
import { Field, Segmented, SimpleSelect, inputCls } from '../reconcile/shared';
import { CodingFields } from './CodingFields';

const cell = 'px-3 py-2.5 align-top';

export const BankRulesLive: React.FC = () => {
  const company = useRouteCompany();
  const rules = useBankRules();
  const banks = useBankAccounts();
  const accounts = useChartAccounts();
  const taxes = useTaxCodes(company.id);
  const contacts = useContactChoices();
  const actions = useBankingActions();
  const [editing, setEditing] = useState<LiveBankRule | 'new' | null>(null);
  const [toDelete, setToDelete] = useState<LiveBankRule | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const orderSlot = useRef(new IntentSlot()).current;
  const toggleSlot = useRef(new IntentSlot()).current;
  const deleteSlot = useRef(new IntentSlot()).current;
  const sel = useRowSelection(rules.data);
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null);

  const accountLabel = (id: string) => {
    const a = accounts.data.find((x) => x.id === id);
    return a ? `${a.code} ${a.name}` : 'an account';
  };
  const bankName = (id: string | null) => (id ? (banks.data.find((b) => b.id === id)?.name ?? 'one account') : 'All accounts');

  const move = async (r: LiveBankRule, dir: -1 | 1) => {
    const ids = rules.data.map((x) => x.id);
    const next = reorder(ids, r.id, dir);
    if (!next) return;
    setBusy(true);
    try {
      await actions.reorderRules(next, orderSlot.for(next.join(',')));
      orderSlot.clear();
    } catch (e) {
      toast.error(bankingErrorText(e, describeError));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (r: LiveBankRule, active: boolean) => {
    setBusy(true);
    try {
      await actions.updateRule(r.id, toRuleRequest({ ...toRuleForm(r), is_active: active }, r.version), toggleSlot.for(`${r.id}:${r.version}:${active}`));
      toggleSlot.clear();
    } catch (e) {
      if (e instanceof ApiError && e.isVersionConflict) {
        setConflict({ noun: 'rule', serverVersion: e.serverVersion, localVersion: r.version, onReload: () => { setConflict(null); rules.refetch(); }, onClose: () => { setConflict(null); rules.refetch(); } });
      } else toast.error(bankingErrorText(e, describeError));
    } finally {
      setBusy(false);
    }
  };

  /** Each rule is updated on its own through the same call as its switch; one that is refused does not stop the others. */
  const setActiveFor = async (active: boolean) => {
    const items = sel.selected.map((r) => ({ ...r, label: r.name }));
    setBusy(true);
    try {
      const r = await runBulkRows(
        (fn) => fn(),
        active ? 'enabled' : 'disabled',
        items,
        (x) => x.can.update && x.is_active !== active,
        active ? 'Already enabled, or you cannot change it.' : 'Already disabled, or you cannot change it.',
        async (x, intent) => {
          await actions.updateRule(x.id, toRuleRequest({ ...toRuleForm(x), is_active: active }, x.version), intent);
          return active ? 'Enabled' : 'Disabled';
        },
        (e) => bankingErrorText(e, describeError),
      );
      setBulkResult(r);
      sel.clear();
    } finally {
      setBusy(false);
    }
  };

  /** The ticked rules go first, in the order they already have; the rest keep theirs. The server stores the new order. */
  const moveToTop = async () => {
    const picked = new Set(sel.selected.map((r) => r.id));
    const ids = rules.data.map((r) => r.id);
    const next = [...ids.filter((id) => picked.has(id)), ...ids.filter((id) => !picked.has(id))];
    if (next.join() === ids.join()) return toast.message('They are already first.');
    setBusy(true);
    try {
      await actions.reorderRules(next, orderSlot.for(next.join(',')));
      orderSlot.clear();
      toast.success('Moved to the top. The first matching rule wins.');
      sel.clear();
    } catch (e) {
      toast.error(bankingErrorText(e, describeError));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!toDelete) return;
    setBusy(true);
    try {
      await actions.deleteRule(toDelete.id, deleteSlot.for(toDelete.id));
      deleteSlot.clear();
      toast.success('Rule deleted.');
      setToDelete(null);
    } catch (e) {
      toast.error(bankingErrorText(e, describeError));
    } finally {
      setBusy(false);
    }
  };

  const range = (r: LiveBankRule) => {
    const cur = company.base_currency;
    if (r.min_amount !== null && r.max_amount !== null) return `${formatMoney(r.min_amount, cur)} to ${formatMoney(r.max_amount, cur)}`;
    if (r.min_amount !== null) return `at least ${formatMoney(r.min_amount, cur)}`;
    if (r.max_amount !== null) return `up to ${formatMoney(r.max_amount, cur)}`;
    return null;
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        breadcrumb={[{ label: 'Bank & cash', to: `/${company.slug}/banking` }, { label: 'Rules' }]}
        title="Bank rules"
        subtitle="Rules suggest how to code repeat bank lines. You accept each one. The first matching rule wins."
        actions={
          <button type="button" onClick={() => setEditing('new')} className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover">
            <Plus className="size-4" /> New rule
          </button>
        }
      />

      {rules.isLoading ? (
        <LoadingLine what="rules" />
      ) : rules.error ? (
        <ErrorLine error={rules.error} onRetry={rules.refetch} />
      ) : rules.data.length === 0 ? (
        <EmptyState title="No bank rules yet" description="Add a rule for the lines that come up every month, such as bank fees or fuel." actionLabel="New rule" onAction={() => setEditing('new')} />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full text-left" data-testid="rules-table">
            <thead className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase text-text-muted">
              <tr>
                <th className={`${cell} w-9`}>
                  <Checkbox checked={sel.allSelected} onCheckedChange={sel.toggleAll} aria-label="Select all rules" />
                </th>
                <th className={cell}>Order</th>
                <th className={cell}>Name</th>
                <th className={cell}>If the bank line...</th>
                <th className={cell}>...then code as</th>
                <th className={`${cell} text-right`}>Times used</th>
                <th className={cell}>Active</th>
                <th className={cell} />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rules.data.map((r, i) => {
                const tax = (taxes.data ?? []).find((t) => t.id === r.tax_code_id)?.code;
                const contact = contacts.data.find((c) => c.id === r.contact_id)?.name;
                const rg = range(r);
                return (
                  <tr key={r.id} data-rule={r.name}>
                    <td className={cell}>
                      <Checkbox checked={sel.isSelected(r.id)} onCheckedChange={() => sel.toggle(r.id)} aria-label={`Select ${r.name}`} />
                    </td>
                    <td className={cell}>
                      <div className="flex items-center gap-0.5">
                        <span className="w-5 text-xs tabular-nums text-text-muted">{i + 1}</span>
                        <button type="button" aria-label={`Move ${r.name} up`} disabled={i === 0 || busy || !r.can.update} onClick={() => void move(r, -1)} className="rounded p-1 text-text-muted hover:bg-surface-neutral hover:text-text-primary disabled:opacity-30">
                          <ArrowUp className="size-3.5" />
                        </button>
                        <button type="button" aria-label={`Move ${r.name} down`} disabled={i === rules.data.length - 1 || busy || !r.can.update} onClick={() => void move(r, 1)} className="rounded p-1 text-text-muted hover:bg-surface-neutral hover:text-text-primary disabled:opacity-30">
                          <ArrowDown className="size-3.5" />
                        </button>
                      </div>
                    </td>
                    <td className={`${cell} text-[13px] font-medium text-text-primary`}>
                      {r.name}
                      <div className="text-[11px] font-normal text-text-muted">{bankName(r.bank_account_id)}</div>
                    </td>
                    <td className={`${cell} text-xs text-text-secondary`}>
                      <span className="mr-1.5 rounded bg-surface-neutral px-1.5 py-0.5 text-[11px] font-medium">{r.direction === 'out' ? 'Money out' : r.direction === 'in' ? 'Money in' : 'Either'}</span>
                      contains <span className="font-mono font-semibold text-text-primary">"{r.contains}"</span>
                      {rg && <span className="text-text-muted"> · {rg}</span>}
                    </td>
                    <td className={`${cell} text-xs text-text-secondary`}>
                      <span className="text-text-primary">{accountLabel(r.account_id)}</span>
                      {tax && <span className="ml-1.5 rounded border border-border px-1 font-mono text-[10px]">{tax}</span>}
                      {contact && <span className="text-text-muted"> · {contact}</span>}
                    </td>
                    <td className={`${cell} text-right text-xs tabular-nums text-text-secondary`}>{r.times_applied}</td>
                    <td className={cell}>
                      <Switch checked={r.is_active} disabled={!r.can.update || busy} aria-label={`${r.name} active`} onCheckedChange={(v) => void toggle(r, v)} />
                    </td>
                    <td className={cell}>
                      <div className="flex items-center justify-end gap-1">
                        {r.can.update && (
                          <button type="button" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)} className="rounded p-1.5 text-text-muted hover:bg-surface-neutral hover:text-text-primary">
                            <Pencil className="size-3.5" />
                          </button>
                        )}
                        {r.can.delete && (
                          <button type="button" aria-label={`Delete ${r.name}`} onClick={() => setToDelete(r)} className="rounded p-1.5 text-text-muted hover:bg-surface-neutral hover:text-danger">
                            <Trash2 className="size-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <BulkBar
        selected={sel.selected.length}
        busy={busy}
        onClear={sel.clear}
        actions={[
          { key: 'enable', label: 'Enable', count: sel.selected.filter((r) => r.can.update && !r.is_active).length, onClick: () => void setActiveFor(true) },
          { key: 'disable', label: 'Disable', count: sel.selected.filter((r) => r.can.update && r.is_active).length, onClick: () => void setActiveFor(false) },
          { key: 'top', label: 'Move to top', count: sel.selected.filter((r) => r.can.update).length, onClick: () => void moveToTop() },
        ]}
      />
      <BulkResultsSheet result={bulkResult} title="Rules" onClose={() => setBulkResult(null)} />

      <RuleDialog target={editing} onClose={() => setEditing(null)} />

      <Dialog open={Boolean(toDelete)} onOpenChange={(o) => !o && !busy && setToDelete(null)}>
        <DialogContent className="max-w-sm p-6">
          <DialogHeader>
            <DialogTitle>Delete this rule?</DialogTitle>
            <DialogDescription>"{toDelete?.name}" will stop suggesting codes. Lines already recorded are not changed.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <button type="button" onClick={() => setToDelete(null)} className="h-8 rounded-md border border-border px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-neutral">
              Keep rule
            </button>
            <button type="button" autoFocus disabled={busy} onClick={() => void remove()} className="h-9 rounded-lg bg-danger px-4 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-60">
              Delete rule
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConflictDialog conflict={conflict} />
    </div>
  );
};

const amountText = (minor: number | null, digits: number): string => {
  if (minor === null) return '';
  const s = String(Math.abs(minor)).padStart(digits + 1, '0');
  const body = digits === 0 ? s : `${s.slice(0, -digits)}.${s.slice(-digits)}`;
  return minor < 0 ? `-${body}` : body;
};

const RuleDialog: React.FC<{ target: LiveBankRule | 'new' | null; onClose: () => void }> = ({ target, onClose }) => {
  const company = useRouteCompany();
  const banks = useBankAccounts();
  const actions = useBankingActions();
  const slot = useRef(new IntentSlot()).current;
  const digits = getCurrencyMinorUnits(company.base_currency);
  const [form, setForm] = useState<RuleForm>(blankRule());
  const [min, setMin] = useState('');
  const [max, setMax] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [local, setLocal] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const editing = target && target !== 'new' ? target : null;

  useEffect(() => {
    if (!target) return;
    setError(null);
    setLocal('');
    slot.clear();
    const f = target === 'new' ? blankRule() : toRuleForm(target);
    setForm(f);
    setMin(amountText(f.min_amount, digits));
    setMax(amountText(f.max_amount, digits));
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = <K extends keyof RuleForm>(k: K, v: RuleForm[K]) => setForm((f) => ({ ...f, [k]: v }));

  const save = async (versionOverride?: number) => {
    setLocal('');
    const lo = parseAmountInput(min, digits);
    const hi = parseAmountInput(max, digits);
    if (!lo.ok || !hi.ok) return setLocal('Enter the smallest and biggest amounts as plain numbers.');
    const next: RuleForm = { ...form, min_amount: lo.minor, max_amount: hi.minor };
    const issue = ruleProblem(next);
    if (issue) return setLocal(issue);
    setBusy(true);
    setError(null);
    const body = toRuleRequest(next, editing ? (versionOverride ?? editing.version) : undefined);
    try {
      const intent = slot.for(JSON.stringify([editing?.id ?? 'new', body]));
      if (editing) await actions.updateRule(editing.id, body, intent);
      else await actions.createRule(body, intent);
      slot.clear();
      toast.success(editing ? 'Rule saved.' : 'Rule added. It suggests; you still confirm each line.');
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.isVersionConflict && editing) {
        setConflict({
          noun: 'rule',
          serverVersion: e.serverVersion,
          localVersion: editing.version,
          onReload: () => { setConflict(null); onClose(); },
          onOverwrite: typeof e.serverVersion === 'number' ? () => { setConflict(null); void save(e.serverVersion as number); } : undefined,
          onClose: () => setConflict(null),
        });
      } else setError(e);
    } finally {
      setBusy(false);
    }
  };

  const message = local || (error ? bankingErrorText(error, describeError) : '');
  return (
    <>
      <Dialog open={Boolean(target)} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-w-xl p-6">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit rule' : 'New bank rule'}</DialogTitle>
            <DialogDescription>When a bank line looks like this, suggest coding it the way you set below. Nothing posts until you accept.</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex flex-col gap-3">
            <Field label="Rule name">
              <input className={inputCls} autoFocus value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. CORR-" aria-label="Rule name" />
              {fieldError(error, 'name') && <span className="text-[11px] text-danger">{fieldError(error, 'name')}</span>}
            </Field>
            <div className="rounded-lg border border-border p-3">
              <div className="mb-2 text-xs font-semibold text-text-primary">If the bank line...</div>
              <div className="flex flex-col gap-3">
                <Segmented
                  value={form.direction}
                  onChange={(v) => set('direction', v as RuleForm['direction'])}
                  options={[{ value: 'out', label: 'Money out' }, { value: 'in', label: 'Money in' }, { value: 'any', label: 'Either' }]}
                />
                <Field label="contains (any part of the description, name or reference)">
                  <input className={inputCls} value={form.contains} onChange={(e) => set('contains', e.target.value)} placeholder="e.g. CH-XX" aria-label="Contains" />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Smallest amount (optional)">
                    <input className={inputCls} inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} aria-label="Smallest amount" />
                  </Field>
                  <Field label="Biggest amount (optional)">
                    <input className={inputCls} inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} aria-label="Biggest amount" />
                  </Field>
                </div>
                <Field label="Applies to">
                  <SimpleSelect aria-label="Applies to" value={form.bank_account_id ?? undefined} onChange={(v) => set('bank_account_id', v ?? null)} noneLabel="All accounts" options={banks.data.map((b) => ({ value: b.id, label: b.name }))} />
                </Field>
              </div>
            </div>
            <div className="rounded-lg border border-border p-3">
              <div className="mb-2 text-xs font-semibold text-text-primary">...then code it as</div>
              <CodingFields value={form} onChange={(v) => setForm((f) => ({ ...f, ...v }))} />
            </div>
            {message && <p role="alert" className="text-[13px] text-danger">{message}</p>}
            <DialogFooter className="gap-2">
              <button type="button" onClick={onClose} disabled={busy} className="h-8 rounded-md border border-border px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-neutral">Cancel</button>
              <button type="submit" disabled={busy} className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50">{busy ? 'Saving…' : editing ? 'Save rule' : 'Add rule'}</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConflictDialog conflict={conflict} />
    </>
  );
};
