import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAssetCategories, useAssetTaxClasses, useCapitalisable, useFixedAssetActions, useFixedAssetList, useReconciliation, type AssetFilters } from '@/data/fixedAssets';
import { useActiveCompany } from '@/data/session';
import {
  ASSET_STATUS_LABEL, assetToEstimateDraft, asMethod, bpLabel, emptyNewAsset, METHOD_LABEL, METHOD_SHORT, toAssetCreateRequest, toAssetUpdateRequest, wornDownPercent,
  type AssetCategory, type AssetTaxClass, type Capitalisable, type EstimateDraft, type FixedAssetRow, type NewAssetDraft, type Reconciliation,
} from '@/api/adapters/fixedAssets';
import { formatDate, formatMoney } from '@/lib/format';
import { ErrorLine, LoadingLine } from '../parts';
import { Badge, DialogShell, Field, fieldClass, MoneyField, Note, primaryBtn, Problem, secondaryBtn, todayISO, type Writer } from './parts';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* ------------------------------------------------------------------ register to ledger check */

export const ReconciliationCard: React.FC<{ rec: Reconciliation; coSlug: string; currency: string }> = ({ rec, coSlug, currency }) => (
  <div className="rounded-lg border border-border bg-surface p-4" data-testid="reconciliation">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">Does the asset list match your books?</h2>
        <p className="mt-0.5 text-[11px] text-text-muted">The asset list compared with the fixed asset accounts in the general ledger{rec.as_of ? `, as of ${formatDate(rec.as_of)}` : ''}.</p>
      </div>
      <Badge tone={rec.reconciles ? 'posted' : 'pending_approval'}>{rec.reconciles ? 'Matches' : 'Differences found'}</Badge>
    </div>
    {rec.rows.length > 0 && (
      <div className="mt-3 overflow-x-auto">
        <table className="w-full border-collapse text-left text-xs">
          <thead>
            <tr className="h-7 border-b border-border text-[11px] font-semibold uppercase text-text-muted">
              <th className="pr-3">Account</th>
              <th className="pr-3 text-right">Asset list</th>
              <th className="pr-3 text-right">Books</th>
              <th className="pr-3 text-right">Difference</th>
              <th className="pr-3 text-right">From opening assets</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rec.rows.map((r) => (
              <tr key={r.account_id} className="h-8">
                <td className="pr-3">
                  <Link
                    to={`/${coSlug}/reports/general-ledger?${new URLSearchParams({ account: r.drill.account_id, ...(r.drill.to ? { to: r.drill.to } : {}) }).toString()}`}
                    className="font-medium text-accent hover:underline"
                  >
                    {r.account_code} {r.account_name}
                  </Link>
                  <span className="ml-2 text-[11px] text-text-muted">{r.kind === 'cost' ? 'cost' : 'depreciation so far'}</span>
                </td>
                <td className="pr-3 text-right tabular-nums">{formatMoney(r.register, currency)}</td>
                <td className="pr-3 text-right tabular-nums">{formatMoney(r.ledger, currency)}</td>
                <td className={`pr-3 text-right tabular-nums ${r.reconciles ? 'text-text-muted' : 'font-semibold text-danger'}`}>{formatMoney(r.difference, currency)}</td>
                <td className="pr-3 text-right tabular-nums text-text-muted">{r.opening_assets ? formatMoney(r.opening_assets, currency) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
    {!rec.reconciles && <p className="mt-2 text-[11px] text-text-muted">A difference usually means something was posted to a fixed asset account without adding it to the asset list, or an opening asset was entered differently from the opening balances.</p>}
  </div>
);

/* ------------------------------------------------------------------ estimate fields */

interface EstimateFieldsValue {
  method: NewAssetDraft['method'];
  life_months: string;
  rate_percent: string;
  units_total: string;
  tax_class_id: string;
}

const EstimateFields: React.FC<{ value: EstimateFieldsValue; onChange: (patch: Partial<EstimateFieldsValue>) => void; taxClasses: AssetTaxClass[] }> = ({ value, onChange, taxClasses }) => (
  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
    <Field label="Depreciation way">
      <select value={value.method} onChange={(e) => onChange({ method: asMethod(e.target.value) })} className={fieldClass}>
        {(['straight_line', 'declining_balance', 'units_of_production'] as const).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}
      </select>
    </Field>
    <Field label="Useful life (months)" hint="Blank uses the category's default">
      <input inputMode="numeric" value={value.life_months} onChange={(e) => onChange({ life_months: e.target.value })} className={fieldClass} />
    </Field>
    {value.method === 'declining_balance' && (
      <Field label="Yearly rate (%)" hint="Blank uses the category's default. For example 20 for 20% a year.">
        <input inputMode="decimal" value={value.rate_percent} onChange={(e) => onChange({ rate_percent: e.target.value })} className={fieldClass} />
      </Field>
    )}
    {value.method === 'units_of_production' && (
      <Field label="Total units expected" hint="For example kilometres or machine hours over its whole life">
        <input inputMode="numeric" value={value.units_total} onChange={(e) => onChange({ units_total: e.target.value })} className={fieldClass} />
      </Field>
    )}
    <Field label="Tax class (optional)" hint="Only used for the tax schedule">
      <select value={value.tax_class_id} onChange={(e) => onChange({ tax_class_id: e.target.value })} className={fieldClass}>
        <option value="">None</option>
        {taxClasses.filter((t) => t.is_active).map((t) => <option key={t.id} value={t.id}>{t.code} {t.name}</option>)}
      </select>
    </Field>
  </div>
);

/* ------------------------------------------------------------------ add: capitalise or opening */

const NewAssetDialog: React.FC<{
  mode: 'capitalise' | 'opening';
  onClose: () => void;
  writer: Writer;
  categories: AssetCategory[];
  taxClasses: AssetTaxClass[];
  currency: string;
}> = ({ mode, onClose, writer, categories, taxClasses, currency }) => {
  const lines = useCapitalisable(mode === 'capitalise');
  const actions = useFixedAssetActions();
  const [d, setD] = useState<NewAssetDraft>(() => ({ ...emptyNewAsset(), opening_as_of: mode === 'opening' ? todayISO() : '' }));
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<NewAssetDraft>) => setD((x) => ({ ...x, ...patch }));
  const active = categories.filter((c) => c.is_active);

  const pick = (key: string) => {
    const l = lines.data.find((x) => `${x.source_type}:${x.source_id}` === key);
    if (!l) return set({ source_type: 'bill_line', source_id: '' });
    const cat = l.category_id ?? '';
    set({ source_type: l.source_type, source_id: l.source_id, name: d.name || l.description, category_id: cat || d.category_id, cost: l.amount, acquired_on: l.date });
  };

  const save = async () => {
    const built = toAssetCreateRequest(mode === 'capitalise' ? { ...d, source_type: d.source_type || 'bill_line' } : { ...d, source_type: '', source_id: '' });
    if (!built.ok) return setProblem(built.error);
    setProblem(null);
    const r = await writer.exec('asset:new', JSON.stringify(built.body), (intent) => actions.createAsset(built.body, intent), { noun: 'asset', onProblem: setProblem });
    if (r) onClose();
  };

  const busy = writer.busy === 'asset:new';
  return (
    <DialogShell
      open
      onClose={onClose}
      wide
      title={mode === 'capitalise' ? 'Add an asset from a posted line' : 'Add an asset you already owned'}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="button" disabled={busy} onClick={() => void save()} className={primaryBtn}>{busy ? 'Saving…' : 'Add to asset list'}</button>
        </>
      }
    >
      {mode === 'capitalise' ? (
        <>
          <Note>This posts nothing. The cost is already in your books from the bill or journal you pick. Adding it here starts depreciation.</Note>
          {lines.isLoading ? (
            <LoadingLine what="posted lines" />
          ) : lines.error ? (
            <ErrorLine error={lines.error} onRetry={lines.refetch} />
          ) : lines.data.length === 0 ? (
            <p className="rounded-md border border-border px-3 py-4 text-center text-text-muted">No posted lines are waiting. A line shows up here when it is posted to a fixed asset account and not yet in the asset list.</p>
          ) : (
            <Field label="Posted line">
              <select value={d.source_id ? `${d.source_type}:${d.source_id}` : ''} onChange={(e) => pick(e.target.value)} className={fieldClass} data-testid="capitalise-line">
                <option value="">Choose a line</option>
                {lines.data.map((l: Capitalisable) => (
                  <option key={`${l.source_type}:${l.source_id}`} value={`${l.source_type}:${l.source_id}`}>
                    {l.document_number} · {formatDate(l.date)} · {l.account_code} · {formatMoney(l.amount, currency)}{l.description ? ` · ${l.description}` : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </>
      ) : (
        <Note>This posts nothing. Opening assets are for things you owned before you started here. The opening balances import carries their balances, so enter the same figures here.</Note>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Asset name"><input value={d.name} onChange={(e) => set({ name: e.target.value })} className={fieldClass} /></Field>
        <Field label="Category">
          <select value={d.category_id} onChange={(e) => set({ category_id: e.target.value })} className={fieldClass}>
            <option value="">Choose a category</option>
            {active.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <MoneyField label="Cost" value={d.cost} onChange={(v) => set({ cost: v })} currency={currency} hint={mode === 'capitalise' ? 'Starts as the line amount' : undefined} />
        <MoneyField label="Value left at the end of its life" value={d.residual} onChange={(v) => set({ residual: v })} currency={currency} />
        <Field label="Bought on"><input type="date" value={d.acquired_on} onChange={(e) => set({ acquired_on: e.target.value })} className={fieldClass} /></Field>
        <Field label="Ready for use from" hint="Blank means the buying date"><input type="date" value={d.available_from} onChange={(e) => set({ available_from: e.target.value })} className={fieldClass} /></Field>
        {mode === 'opening' && (
          <>
            <MoneyField label="Depreciation so far" value={d.opening_accumulated} onChange={(v) => set({ opening_accumulated: v })} currency={currency} />
            <Field label="Stated as of"><input type="date" value={d.opening_as_of} onChange={(e) => set({ opening_as_of: e.target.value })} className={fieldClass} /></Field>
          </>
        )}
      </div>
      <EstimateFields value={d} onChange={set} taxClasses={taxClasses} />
      <Problem message={problem} />
    </DialogShell>
  );
};

/* ------------------------------------------------------------------ edit estimates */

const EstimateDialog: React.FC<{ asset: FixedAssetRow; onClose: () => void; writer: Writer; taxClasses: AssetTaxClass[]; currency: string }> = ({ asset, onClose, writer, taxClasses, currency }) => {
  const actions = useFixedAssetActions();
  const [d, setD] = useState<EstimateDraft>(() => assetToEstimateDraft(asset));
  const [problem, setProblem] = useState<string | null>(null);
  const set = (patch: Partial<EstimateDraft>) => setD((x) => ({ ...x, ...patch }));

  const save = async () => {
    const built = toAssetUpdateRequest(asset, d);
    if (!built.ok) return setProblem(built.error);
    setProblem(null);
    const r = await writer.exec(`asset:${asset.id}`, JSON.stringify(built.body), (intent) => actions.updateAsset(asset.id, built.body, intent), { noun: 'asset', onProblem: setProblem });
    if (r) onClose();
  };

  return (
    <DialogShell
      open
      onClose={onClose}
      title={`Change estimates: ${asset.number}`}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="button" disabled={writer.busy === `asset:${asset.id}`} onClick={() => void save()} className={primaryBtn}>Save changes</button>
        </>
      }
    >
      <Note>A change to the life, rate or value left applies from the next depreciation run onward. Months already depreciated are not changed.</Note>
      <Field label="Asset name"><input value={d.name} onChange={(e) => set({ name: e.target.value })} className={fieldClass} /></Field>
      <Field label="Description"><input value={d.description} onChange={(e) => set({ description: e.target.value })} className={fieldClass} /></Field>
      <MoneyField label="Value left at the end of its life" value={d.residual} onChange={(v) => set({ residual: v })} currency={currency} />
      <EstimateFields value={d} onChange={set} taxClasses={taxClasses} />
      <Problem message={problem} />
    </DialogShell>
  );
};

/* ------------------------------------------------------------------ the tab */

export const RegisterTab: React.FC<{ writer: Writer }> = ({ writer }) => {
  const navigate = useNavigate();
  const { company } = useActiveCompany();
  const cur = company.base_currency;
  const categories = useAssetCategories();
  const taxClasses = useAssetTaxClasses();
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');
  const q = useDebounced(search.trim(), 300);
  const filters: AssetFilters = { q, category_id: category, status };
  const list = useFixedAssetList(filters);
  const recon = useReconciliation('');
  const [adding, setAdding] = useState<'capitalise' | 'opening' | null>(null);
  const [editing, setEditing] = useState<FixedAssetRow | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const taxName = (id: string | null) => taxClasses.data.find((t) => t.id === id);

  return (
    <div className="flex flex-col gap-4">
      {recon.data && <ReconciliationCard rec={recon.data} coSlug={company.slug} currency={cur} />}
      {Boolean(recon.error) && !recon.data && <ErrorLine error={recon.error} onRetry={recon.refetch} />}

      <div className="flex flex-wrap items-center gap-2">
        <input type="search" aria-label="Search assets" placeholder="Search by number or name" value={search} onChange={(e) => setSearch(e.target.value)} className={`${fieldClass} w-64`} />
        <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} className={fieldClass}>
          <option value="">All categories</option>
          {categories.data.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={fieldClass}>
          <option value="">All statuses</option>
          <option value="active">In use</option>
          <option value="fully_depreciated">Fully written down</option>
          <option value="disposed">Sold or scrapped</option>
        </select>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setAdding('capitalise')} className={primaryBtn}>Add from a posted line</button>
          <button type="button" onClick={() => setAdding('opening')} className={secondaryBtn}>Add opening asset</button>
        </div>
      </div>

      {list.isLoading ? (
        <LoadingLine what="assets" />
      ) : list.error ? (
        <ErrorLine error={list.error} onRetry={list.refetch} />
      ) : list.rows.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-6 py-14 text-center">
          <h3 className="text-sm font-semibold text-text-primary">{q || category || status ? 'No assets match' : 'No assets yet'}</h3>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-text-muted">
            {q || category || status ? 'Try a different search or filter.' : 'Buy an asset with a supplier bill, then add it here from the posted line. If you already owned assets before starting, add them as opening assets.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-left text-xs" data-testid="asset-rows">
            <thead>
              <tr className="h-8 border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase text-text-muted">
                <th className="px-3">Asset</th>
                <th className="px-3">Category</th>
                <th className="px-3">Bought</th>
                <th className="px-3">In use from</th>
                <th className="px-3 text-right">Cost</th>
                <th className="px-3 text-right">Value left at end</th>
                <th className="px-3">How</th>
                <th className="px-3 text-right">Life</th>
                <th className="px-3 text-right">Depreciation so far</th>
                <th className="px-3 text-right">Value today</th>
                <th className="px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.rows.map((a) => (
                <React.Fragment key={a.id}>
                  <tr className="h-11 cursor-pointer hover:bg-surface-neutral/50" onClick={() => setOpen(open === a.id ? null : a.id)} data-asset={a.number}>
                    <td className="px-3">
                      <div className="font-medium text-text-primary">{a.name}</div>
                      <div className="flex items-center gap-1.5 font-mono text-[11px] text-text-muted">
                        {a.number}
                        {a.is_opening && <Badge tone="draft" title="Brought in as an opening asset">Opening asset</Badge>}
                      </div>
                    </td>
                    <td className="px-3 text-text-secondary">{a.category_name}</td>
                    <td className="px-3 tabular-nums text-text-muted">{a.acquired_on ? formatDate(a.acquired_on) : '—'}</td>
                    <td className="px-3 tabular-nums text-text-muted">{a.available_from ? formatDate(a.available_from) : '—'}</td>
                    <td className="px-3 text-right tabular-nums">{formatMoney(a.cost, cur)}</td>
                    <td className="px-3 text-right tabular-nums text-text-secondary">{formatMoney(a.residual, cur)}</td>
                    <td className="px-3 text-text-secondary">{METHOD_SHORT[a.method]}</td>
                    <td className="px-3 text-right tabular-nums text-text-secondary">{a.method === 'declining_balance' ? bpLabel(a.declining_rate_bp) : a.life_months ? `${a.life_months} mo` : '—'}</td>
                    <td className="px-3 text-right tabular-nums">
                      {formatMoney(a.accumulated, cur)}
                      {a.is_opening && a.opening_accumulated > 0 && <div className="text-[11px] text-text-muted">{formatMoney(a.opening_accumulated, cur)} brought in{a.opening_as_of ? ` at ${formatDate(a.opening_as_of)}` : ''}</div>}
                    </td>
                    <td className="px-3 text-right font-semibold tabular-nums text-text-primary">{formatMoney(a.carrying, cur)}</td>
                    <td className="px-3"><Badge tone={a.status}>{ASSET_STATUS_LABEL[a.status] ?? a.status}</Badge></td>
                  </tr>
                  {open === a.id && (
                    <tr className="bg-surface-neutral/40">
                      <td colSpan={11} className="px-4 py-3">
                        <div className="flex flex-wrap items-start justify-between gap-4 text-xs">
                          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                            <dt className="text-text-muted">Worn down</dt><dd>{wornDownPercent(a)}% of its depreciable value</dd>
                            <dt className="text-text-muted">Months charged</dt><dd>{a.months_charged}{a.depreciated_through ? `, through ${formatDate(a.depreciated_through)}` : ''}</dd>
                            <dt className="text-text-muted">Write-downs so far</dt><dd className="tabular-nums">{formatMoney(a.accumulated_impairment, cur)}</dd>
                            {a.revaluation_reserve !== 0 && (<><dt className="text-text-muted">Revaluation reserve</dt><dd className="tabular-nums">{formatMoney(a.revaluation_reserve, cur)}</dd></>)}
                            {a.method === 'units_of_production' && (<><dt className="text-text-muted">Units used</dt><dd className="tabular-nums">{a.units_used} of {a.units_total ?? '?'}</dd></>)}
                            <dt className="text-text-muted">Tax class</dt><dd>{taxName(a.tax_class_id)?.name ?? 'None'}</dd>
                            {a.disposed_on && (<><dt className="text-text-muted">Sold or scrapped on</dt><dd>{formatDate(a.disposed_on)}</dd></>)}
                            {a.description && (<><dt className="text-text-muted">Description</dt><dd>{a.description}</dd></>)}
                          </dl>
                          <div className="flex items-center gap-3">
                            {a.source_journal_id && <button type="button" onClick={() => navigate(`/${company.slug}/journals/${a.source_journal_id}`)} className="text-xs font-medium text-accent hover:underline">View the journal it came from</button>}
                            {a.can.update && a.status !== 'disposed' && <button type="button" onClick={() => setEditing(a)} className={secondaryBtn}>Change estimates</button>}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
          {list.hasMore && (
            <div className="border-t border-border p-2 text-center">
              <button type="button" onClick={list.loadMore} disabled={list.isLoadingMore} className="text-xs font-medium text-accent hover:underline disabled:opacity-50">{list.isLoadingMore ? 'Loading…' : 'Show more'}</button>
            </div>
          )}
        </div>
      )}

      {adding && <NewAssetDialog key={adding} mode={adding} onClose={() => setAdding(null)} writer={writer} categories={categories.data} taxClasses={taxClasses.data} currency={cur} />}
      {editing && <EstimateDialog key={editing.id} asset={editing} onClose={() => setEditing(null)} writer={writer} taxClasses={taxClasses.data} currency={cur} />}
    </div>
  );
};
