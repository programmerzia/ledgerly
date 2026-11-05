import React, { useMemo, useState } from 'react';
import { AccountPicker } from '@/components/domain/AccountPicker';
import { useAccounts } from '@/data/accounts';
import { useAssetCategories, useFixedAssetActions } from '@/data/fixedAssets';
import {
  asMethod, bpLabel, categoryToDraft, emptyCategoryDraft, METHOD_LABEL, METHOD_SHORT, MODEL_LABEL, toCategoryRequest, type AssetCategory, type CategoryDraft,
} from '@/api/adapters/fixedAssets';
import { ErrorLine, LoadingLine } from '../parts';
import { Badge, DialogShell, Field, fieldClass, Note, primaryBtn, Problem, secondaryBtn, type Writer } from './parts';

export const CategoriesTab: React.FC<{ writer: Writer; onChanged: () => void }> = ({ writer, onChanged }) => {
  const cats = useAssetCategories();
  const accounts = useAccounts();
  const actions = useFixedAssetActions();
  const [editing, setEditing] = useState<{ cat: AssetCategory | null } | null>(null);
  const [draft, setDraft] = useState<CategoryDraft>(emptyCategoryDraft());
  const [problem, setProblem] = useState<string | null>(null);

  const usable = useMemo(() => accounts.data.filter((a) => a.is_active && a.is_postable), [accounts.data]);
  const assetAccounts = useMemo(() => usable.filter((a) => a.control_type === 'fixed_asset'), [usable]);
  const accumAccounts = useMemo(() => usable.filter((a) => a.control_type === 'accum_depr'), [usable]);
  const expenseAccounts = useMemo(() => usable.filter((a) => a.account_type === 'expense'), [usable]);
  const accountLabel = (id: string) => {
    const a = accounts.data.find((x) => x.id === id);
    return a ? `${a.code} ${a.name}` : '';
  };

  const openEdit = (cat: AssetCategory | null) => {
    setProblem(null);
    setDraft(cat ? categoryToDraft(cat) : emptyCategoryDraft());
    setEditing({ cat });
  };

  const save = async () => {
    if (!editing) return;
    const built = toCategoryRequest(draft, editing.cat?.version);
    if (!built.ok) {
      setProblem(built.error);
      return;
    }
    setProblem(null);
    const cat = editing.cat;
    const r = await writer.exec(`category:${cat?.id ?? 'new'}`, JSON.stringify(built.body), (intent) => (cat ? actions.updateCategory(cat.id, built.body, intent) : actions.createCategory(built.body, intent)), {
      noun: 'category',
      onProblem: setProblem,
    });
    if (r) {
      setEditing(null);
      onChanged();
    }
  };

  const set = <K extends keyof CategoryDraft>(k: K, v: CategoryDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const busy = writer.busy?.startsWith('category:') ?? false;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="max-w-2xl text-[13px] text-text-muted">A category groups similar assets (computers, vehicles, buildings). It decides which accounts the asset and its depreciation sit in, and the default way and length of depreciation.</p>
        <button type="button" onClick={() => openEdit(null)} className={primaryBtn}>New category</button>
      </div>

      {cats.isLoading ? (
        <LoadingLine what="categories" />
      ) : cats.error ? (
        <ErrorLine error={cats.error} onRetry={cats.refetch} />
      ) : cats.data.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <h3 className="text-sm font-semibold text-text-primary">No categories yet</h3>
          <p className="mt-1 text-[13px] text-text-muted">Add a category before you add assets.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="h-8 border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase text-text-muted">
                <th className="px-3">Category</th>
                <th className="px-3">Accounts (asset / depreciation so far / expense)</th>
                <th className="px-3">Valued</th>
                <th className="px-3">Default depreciation</th>
                <th className="px-3">Status</th>
                <th className="px-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border" data-testid="category-rows">
              {cats.data.map((c) => (
                <tr key={c.id} className="h-10 hover:bg-surface-neutral/50">
                  <td className="px-3 font-medium text-text-primary">{c.name}</td>
                  <td className="px-3 text-text-secondary">{accountLabel(c.asset_account_id)} / {accountLabel(c.accumulated_account_id)} / {accountLabel(c.expense_account_id)}</td>
                  <td className="px-3 text-text-secondary">{MODEL_LABEL[c.measurement_model]}</td>
                  <td className="px-3 text-text-secondary">
                    {c.is_depreciable
                      ? `${METHOD_SHORT[c.default_method]}${c.default_method === 'declining_balance' ? `, ${bpLabel(c.default_declining_rate_bp)} a year` : c.default_life_months ? `, ${c.default_life_months} months` : ''}`
                      : 'Not depreciated'}
                  </td>
                  <td className="px-3">{c.is_active ? <Badge tone="active">Active</Badge> : <Badge tone="disposed">Inactive</Badge>}</td>
                  <td className="px-3 text-right">
                    {c.can.update && (
                      <button type="button" onClick={() => openEdit(c)} className="text-xs font-medium text-accent hover:underline">Edit</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <DialogShell
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.cat ? 'Edit category' : 'New category'}
        footer={
          <>
            <button type="button" onClick={() => setEditing(null)} className={secondaryBtn}>Cancel</button>
            <button type="button" disabled={busy} onClick={() => void save()} className={primaryBtn}>{busy ? 'Saving…' : 'Save category'}</button>
          </>
        }
      >
        <Field label="Name">
          <input value={draft.name} onChange={(e) => set('name', e.target.value)} className={fieldClass} placeholder="For example Computers and phones" />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Asset account" hint="Where the cost sits">
            <AccountPicker accounts={assetAccounts} value={draft.asset_account_id} onChange={(id) => set('asset_account_id', id)} />
          </Field>
          <Field label="Depreciation so far account" hint="Reduces the asset's value">
            <AccountPicker accounts={accumAccounts} value={draft.accumulated_account_id} onChange={(id) => set('accumulated_account_id', id)} />
          </Field>
          <Field label="Depreciation expense account" hint="Where the monthly charge goes">
            <AccountPicker accounts={expenseAccounts} value={draft.expense_account_id} onChange={(id) => set('expense_account_id', id)} />
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="How assets are valued" hint={draft.measurement_model === 'revaluation' ? 'The whole category is revalued together, from the Sales and write-downs tab.' : undefined}>
            <select value={draft.measurement_model} onChange={(e) => set('measurement_model', e.target.value === 'revaluation' ? 'revaluation' : 'cost')} className={fieldClass}>
              <option value="cost">At cost less depreciation</option>
              <option value="revaluation">Revalued to current value</option>
            </select>
          </Field>
          <Field label="Wears down">
            <select value={draft.is_depreciable ? 'yes' : 'no'} onChange={(e) => set('is_depreciable', e.target.value === 'yes')} className={fieldClass}>
              <option value="yes">Yes, it is depreciated</option>
              <option value="no">No (for example land)</option>
            </select>
          </Field>
        </div>
        {draft.is_depreciable && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Field label="Default way">
              <select value={draft.default_method} onChange={(e) => set('default_method', asMethod(e.target.value))} className={fieldClass}>
                {(['straight_line', 'declining_balance', 'units_of_production'] as const).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
              </select>
            </Field>
            <Field label="Default life (months)">
              <input inputMode="numeric" value={draft.life_months} onChange={(e) => set('life_months', e.target.value)} className={fieldClass} />
            </Field>
            {draft.default_method === 'declining_balance' && (
              <Field label="Yearly rate (%)" hint="For example 20 for 20% a year">
                <input inputMode="decimal" value={draft.rate_percent} onChange={(e) => set('rate_percent', e.target.value)} className={fieldClass} />
              </Field>
            )}
          </div>
        )}
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input type="checkbox" checked={draft.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          Active (new assets can be added to it)
        </label>
        <Note>Changing a category later does not change assets already in it. Each asset keeps its own estimates.</Note>
        <Problem message={problem} />
      </DialogShell>
    </div>
  );
};
