import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { MoneyInput } from '@/components/domain/MoneyInput';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useAccounts } from '@/data/accounts';
import { pickableAccounts } from '@/api/adapters/account';
import { useTradeRefs } from '@/data/tradeRefs';
import { useItemActions, useItemList } from '@/data/items';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import { IntentSlot } from '@/api/intentSlot';
import { draftOfItem, toItemRequest, type ItemDraft, type LiveItem } from '@/api/adapters/item';
import { BTN_ACCENT, ErrorLine, LoadMore, LoadingLine, TableCard, inputClass, useDebounced } from './parts';

const CURRENCIES = ['CHF', 'USD', 'EUR', 'GBP'];

const Field: React.FC<{ id: string; label: string; error?: string; hint?: string; children: React.ReactNode }> = ({ id, label, error, hint, children }) => (
  <div className="flex flex-col gap-1">
    <label htmlFor={id} className="text-xs font-medium text-text-secondary">{label}</label>
    {children}
    {hint && !error && <span className="text-[11px] text-text-muted">{hint}</span>}
    {error && <span className="text-[11px] text-danger">{error}</span>}
  </div>
);

const ItemDialog: React.FC<{ item?: LiveItem; baseCurrency: string; onClose: () => void; onConflict: (c: VersionConflict | null) => void }> = ({ item, baseCurrency, onClose, onConflict }) => {
  const actions = useItemActions();
  const accounts = useAccounts();
  const refs = useTradeRefs();
  const [draft, setDraft] = useState<ItemDraft>(() => (item ? draftOfItem(item) : { code: '', name: '', description: '', kind: 'service', currency: baseCurrency, sales_account_id: '', purchase_account_id: '', sales_price: 0, purchase_price: 0, tax_code_id: '' }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const slot = useRef(new IntentSlot()).current;
  const offSlot = useRef(new IntentSlot()).current;
  const set = <K extends keyof ItemDraft>(k: K, v: ItemDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const income = pickableAccounts(accounts.data, [draft.sales_account_id]).filter((a) => a.is_active && a.is_postable && a.account_type === 'income');
  const expense = pickableAccounts(accounts.data, [draft.purchase_account_id]).filter((a) => a.is_active && a.is_postable && (a.account_type === 'expense' || a.account_type === 'asset'));
  const taxes = refs.taxCodes.filter((t) => t.kind !== 'wht');

  const conflictFor = (sv: unknown, retry: (v: number) => void) =>
    onConflict({
      noun: 'item',
      serverVersion: sv,
      localVersion: item?.version,
      onClose: () => onConflict(null),
      onReload: () => { onConflict(null); onClose(); toast.message('Closed without saving. Open the item again to see the latest.'); },
      onOverwrite: typeof sv === 'number' ? () => { onConflict(null); retry(sv); } : undefined,
    });

  async function save(version?: number) {
    setErrors({});
    setBanner('');
    const local: Record<string, string> = {};
    if (!/^[A-Za-z0-9._-]{1,32}$/.test(draft.code)) local.code = 'Use letters, numbers, dots, dashes or underscores (up to 32).';
    if (!draft.name.trim()) local.name = 'Give the item a name.';
    if (Object.keys(local).length) return setErrors(local);
    const body = toItemRequest(draft, item ? (version ?? item.version) : undefined);
    const intent = slot.for(JSON.stringify([item?.id ?? null, body]));
    setBusy(true);
    try {
      if (item) await actions.update(item.id, body, intent);
      else await actions.create(body, intent);
      slot.clear();
      toast.success(item ? 'Item saved' : `Item ${draft.name.trim()} created`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.isVersionConflict && item) conflictFor(e.serverVersion, (v) => void save(v));
      else if (e instanceof ApiError && e.isValidation) {
        setErrors(Object.fromEntries(Object.entries(e.errors ?? {}).map(([k, v]) => [k, v[0] ?? ''])));
        setBanner(Object.keys(e.errors ?? {}).length ? '' : describeError(e));
      } else if (e instanceof ApiError && e.violations?.[0]?.code === 'item_code_taken') setErrors({ code: 'That code is already used by another item.' });
      else if (e instanceof ApiError && e.violations?.length) setBanner(e.violations.map((v) => v.message).join(' '));
      else setBanner(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!item) return;
    setBusy(true);
    try {
      await actions.deactivate(item.id, item.version, offSlot.for(`${item.id}:${item.version}`));
      offSlot.clear();
      toast.success('Item deactivated. Documents that used it are not changed.');
      onClose();
    } catch (e) {
      setConfirmOff(false);
      if (e instanceof ApiError && e.isVersionConflict) conflictFor(e.serverVersion, () => undefined);
      else setBanner(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-w-xl rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary">{item ? `Edit ${item.name}` : 'New item'}</DialogTitle>
            <DialogDescription className="text-xs text-text-muted">Defaults for document lines. Picking the item on a line fills in the name, account, price and tax code, and you can still change them there.</DialogDescription>
          </DialogHeader>
          <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <Field id="it-name" label="Name" error={errors.name}>
              <input id="it-name" value={draft.name} onChange={(e) => set('name', e.target.value)} className={inputClass} autoFocus />
            </Field>
            <Field id="it-code" label="Code" error={errors.code}>
              <input id="it-code" value={draft.code} onChange={(e) => set('code', e.target.value)} placeholder="e.g. CONSULT-HR" className={inputClass} disabled={Boolean(item)} />
            </Field>
            <Field id="it-kind" label="Type" error={errors.kind}>
              <select id="it-kind" value={draft.kind} onChange={(e) => set('kind', e.target.value as ItemDraft['kind'])} className={inputClass}>
                <option value="service">Service</option>
                <option value="good">Product</option>
              </select>
            </Field>
            <Field id="it-cur" label="Currency of the prices" error={errors.currency}>
              <select id="it-cur" value={draft.currency} onChange={(e) => set('currency', e.target.value)} className={inputClass}>
                {Array.from(new Set([baseCurrency, draft.currency, ...CURRENCIES])).map((c) => (<option key={c} value={c}>{c}</option>))}
              </select>
            </Field>
            <Field id="it-sprice" label={`Sales price (${draft.currency})`} error={errors.sales_price} hint="Leave at 0 for no default price.">
              <MoneyInput id="it-sprice" value={draft.sales_price} onChange={(v) => set('sales_price', v)} currency={draft.currency} allowNegative={false} size="sm" />
            </Field>
            <Field id="it-pprice" label={`Cost price (${draft.currency})`} error={errors.purchase_price} hint="Leave at 0 for no default price.">
              <MoneyInput id="it-pprice" value={draft.purchase_price} onChange={(v) => set('purchase_price', v)} currency={draft.currency} allowNegative={false} size="sm" />
            </Field>
            <Field id="it-sacc" label="Sales account" error={errors.sales_account_id}>
              <select id="it-sacc" value={draft.sales_account_id} onChange={(e) => set('sales_account_id', e.target.value)} className={inputClass}>
                <option value="">None</option>
                {income.map((a) => (<option key={a.id} value={a.id}>{a.code} {a.name}</option>))}
              </select>
            </Field>
            <Field id="it-pacc" label="Purchase account" error={errors.purchase_account_id}>
              <select id="it-pacc" value={draft.purchase_account_id} onChange={(e) => set('purchase_account_id', e.target.value)} className={inputClass}>
                <option value="">None</option>
                {expense.map((a) => (<option key={a.id} value={a.id}>{a.code} {a.name}</option>))}
              </select>
            </Field>
            <Field id="it-tax" label="Tax code" error={errors.tax_code_id}>
              <select id="it-tax" value={draft.tax_code_id} onChange={(e) => set('tax_code_id', e.target.value)} className={inputClass}>
                <option value="">No tax</option>
                {taxes.map((t) => (<option key={t.id} value={t.id}>{t.code}</option>))}
              </select>
            </Field>
            <div className="col-span-2">
              <Field id="it-desc" label="Description" error={errors.description}>
                <textarea id="it-desc" rows={2} value={draft.description} onChange={(e) => set('description', e.target.value)} className="rounded-md border border-border bg-surface p-2 text-xs text-text-primary focus:border-accent focus:outline-none" />
              </Field>
            </div>
            {banner && <p role="alert" className="col-span-2 text-xs font-medium text-danger">{banner}</p>}
            <DialogFooter className="col-span-2 mt-1 flex items-center justify-between gap-2 sm:justify-between">
              {item && item.is_active && item.can.deactivate ? (
                <button type="button" onClick={() => setConfirmOff(true)} disabled={busy} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary hover:border-danger/50 hover:text-danger">Deactivate</button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button type="button" onClick={onClose} disabled={busy} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral">Cancel</button>
                {(!item || item.can.update) && (
                  <button type="submit" disabled={busy} className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50">{busy ? 'Saving…' : item ? 'Save changes' : 'Create item'}</button>
                )}
              </div>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={confirmOff} onOpenChange={setConfirmOff}>
        <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary">Deactivate {item?.name}?</DialogTitle>
            <DialogDescription className="text-xs text-text-muted">It will no longer be offered on new lines. Documents that already use it stay exactly as they are.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmOff(false)} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral">Keep active</button>
            <button type="button" disabled={busy} onClick={() => void turnOff()} className="h-8 rounded-md bg-danger px-3 text-[13px] font-medium text-white disabled:opacity-50">Deactivate</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};

/** Products and services against the API. */
export const ItemsLive: React.FC = () => {
  const company = useRouteCompany();
  const [searchText, setSearchText] = useState('');
  const [active, setActive] = useState<'true' | 'false' | ''>('true');
  const [kind, setKind] = useState('');
  const [dialog, setDialog] = useState<null | { item?: LiveItem }>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const search = useDebounced(searchText.trim(), 300);
  const list = useItemList({ active, kind, search });
  const filtered = Boolean(search) || Boolean(kind) || active !== 'true';

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Products & services"
        subtitle="What you sell and buy. An item fills in a line’s name, account, price and tax code."
        actions={
          <button type="button" onClick={() => setDialog({})} className={BTN_ACCENT}>
            <Plus className="size-4" /> New item
          </button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 border-b border-border" role="tablist">
          {([['true', 'Active'], ['false', 'Inactive'], ['', 'All']] as const).map(([v, label]) => (
            <button key={label} type="button" role="tab" aria-selected={active === v} onClick={() => setActive(v)} className={cn('-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors', active === v ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary')}>
              {label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <select aria-label="Type" value={kind} onChange={(e) => setKind(e.target.value)} className={inputClass}>
            <option value="">Products and services</option>
            <option value="service">Services</option>
            <option value="good">Products</option>
          </select>
          <input type="search" aria-label="Search items" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search by name or code" className={cn(inputClass, 'w-56')} />
        </div>
      </div>

      <TableCard>
        {list.isLoading ? (
          <LoadingLine what="items" />
        ) : list.error ? (
          <ErrorLine error={list.error} onRetry={list.refetch} />
        ) : list.rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <h3 className="text-sm font-semibold text-text-primary">{filtered ? 'No items match' : 'No items yet'}</h3>
            <p className="mt-1 max-w-sm text-[13px] text-text-muted">{filtered ? 'Change or clear the search to see more.' : 'Add what you sell or buy often, so lines fill in on their own.'}</p>
            {!filtered && <button type="button" onClick={() => setDialog({})} className="mt-4 h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover">New item</button>}
          </div>
        ) : (
          <table className="w-full text-left text-[13px]" data-testid="items-table">
            <thead>
              <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Type</th>
                <th className="px-3 py-2 text-right">Sales price</th>
                <th className="px-3 py-2 text-right">Cost price</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.rows.map((i) => (
                <tr key={i.id} data-item={i.code} onClick={() => setDialog({ item: i })} className="cursor-pointer hover:bg-surface-neutral/60">
                  <td className="px-3 py-2 font-semibold text-accent">{i.code}</td>
                  <td className="px-3 py-2 text-text-primary">
                    {i.name}
                    {!i.is_active && <span className="ml-2 rounded-[3px] bg-surface-neutral px-1.5 py-0.5 text-[11px] font-normal text-text-muted">Inactive</span>}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{i.kind === 'good' ? 'Product' : 'Service'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{i.sales_price > 0 ? formatMoney(i.sales_price, i.currency) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{i.purchase_price > 0 ? formatMoney(i.purchase_price, i.currency) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <LoadMore hasMore={list.hasMore} loading={list.isLoadingMore} onClick={list.loadMore} />
      </TableCard>

      {dialog && <ItemDialog item={dialog.item} baseCurrency={company.base_currency} onClose={() => setDialog(null)} onConflict={setConflict} />}
      <ConflictDialog conflict={conflict} />
    </div>
  );
};
