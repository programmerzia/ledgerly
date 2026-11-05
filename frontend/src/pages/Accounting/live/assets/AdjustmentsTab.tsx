import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { AccountPicker } from '@/components/domain/AccountPicker';
import { MoneyInput } from '@/components/domain/MoneyInput';
import { useAccounts } from '@/data/accounts';
import { useAllAssets, useAssetCategories, useAssetTransactions, useFixedAssetActions } from '@/data/fixedAssets';
import { useActiveCompany } from '@/data/session';
import {
  DOC_STATUS_LABEL, emptyAssetTx, TX_KIND_LABEL, toAssetTxRequest, type AssetTransaction, type AssetTxDraft, type AssetTxKind, type TxPreview,
} from '@/api/adapters/fixedAssets';
import { formatDate, formatMoney } from '@/lib/format';
import { ErrorLine, LoadingLine } from '../parts';
import { DialogShell, DocActions, DocStatusBadge, Field, fieldClass, MoneyField, Note, primaryBtn, Problem, secondaryBtn, todayISO, type Writer } from './parts';

const KIND_HELP: Record<AssetTxKind, string> = {
  disposal: 'Sold, scrapped or given away. The gain or loss is worked out for you.',
  impairment: 'The asset is worth less than its books say, for example it is damaged.',
  impairment_reversal: 'Put back some or all of an earlier write-down. It can never take the asset above what it would be worth without the write-down.',
  revaluation: 'Set a new value for every asset in a category that is kept at current value.',
};

/** What the server would post and what it does to each asset. Shown before anything is created. */
export const TxPreviewPanel: React.FC<{ preview: TxPreview; currency: string }> = ({ preview, currency }) => (
  <div className="flex flex-col gap-3" data-testid="tx-preview">
    {preview.assets.map((a) => (
      <div key={a.asset_id} className="rounded-lg border border-border">
        <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-neutral px-3 py-2">
          <span className="font-medium text-text-primary"><span className="font-mono text-text-muted">{a.asset_number}</span> {a.asset_name}</span>
          <span className="tabular-nums text-text-secondary">{formatMoney(a.carrying_before, currency)} to {formatMoney(a.carrying_after, currency)}</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 px-3 py-2 sm:grid-cols-4">
          {a.gain_or_loss !== null && (<><dt className="text-text-muted">{a.gain_or_loss >= 0 ? 'Gain' : 'Loss'}</dt><dd className={`tabular-nums ${a.gain_or_loss >= 0 ? 'text-success' : 'text-danger'}`}>{formatMoney(Math.abs(a.gain_or_loss), currency)}</dd></>)}
          {a.to_reserve !== null && (<><dt className="text-text-muted">To revaluation reserve</dt><dd className="tabular-nums">{formatMoney(a.to_reserve, currency)}</dd></>)}
          {a.to_profit_or_loss !== null && (<><dt className="text-text-muted">To profit or loss</dt><dd className="tabular-nums">{formatMoney(a.to_profit_or_loss, currency)}</dd></>)}
          {a.cap !== null && (<><dt className="text-text-muted">Most that can be reversed</dt><dd className="tabular-nums">{formatMoney(a.cap, currency)}</dd></>)}
        </dl>
        <table className="w-full border-t border-border text-xs">
          <thead>
            <tr className="h-7 text-[11px] font-semibold uppercase text-text-muted"><th className="px-3 text-left">Account</th><th className="px-3 text-right">Debit</th><th className="px-3 text-right">Credit</th></tr>
          </thead>
          <tbody className="divide-y divide-border">
            {a.journal_lines.map((l, i) => (
              <tr key={i} className="h-7">
                <td className="px-3 text-text-primary">{l.account_code} {l.account_name}</td>
                <td className="px-3 text-right tabular-nums">{l.debit ? formatMoney(l.debit, currency) : ''}</td>
                <td className="px-3 text-right tabular-nums">{l.credit ? formatMoney(l.credit, currency) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ))}
  </div>
);

const NewTxDialog: React.FC<{ kind: AssetTxKind | null; onClose: () => void; writer: Writer; currency: string }> = ({ kind, onClose, writer, currency }) => {
  const actions = useFixedAssetActions();
  const accounts = useAccounts();
  const categories = useAssetCategories();
  const assets = useAllAssets(undefined, kind !== null);
  const [d, setD] = useState<AssetTxDraft>(emptyAssetTx('disposal'));
  const [preview, setPreview] = useState<{ sig: string; data: TxPreview } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [openedFor, setOpenedFor] = useState<AssetTxKind | null>(null);
  if (kind !== openedFor) {
    setOpenedFor(kind);
    if (kind) {
      setD({ ...emptyAssetTx(kind), tx_date: todayISO() });
      setPreview(null);
      setProblem(null);
    }
  }
  const set = (patch: Partial<AssetTxDraft>) => { setD((x) => ({ ...x, ...patch })); setProblem(null); };

  const live = assets.data.filter((a) => a.status !== 'disposed');
  const revalued = categories.data.filter((c) => c.measurement_model === 'revaluation' && c.is_active);
  const inCategory = useMemo(() => live.filter((a) => a.category_id === d.category_id), [live, d.category_id]);
  const receiving = accounts.data.filter((a) => a.is_active && a.is_postable && a.account_type === 'asset' && a.control_type !== 'fixed_asset' && a.control_type !== 'accum_depr');
  const picked = live.find((a) => a.id === d.asset_id);

  const chooseCategory = (id: string) => {
    const values: Record<string, number | null> = {};
    for (const a of live.filter((x) => x.category_id === id)) values[a.id] = a.carrying;
    set({ category_id: id, values });
  };

  const built = toAssetTxRequest(d);
  const sig = built.ok ? JSON.stringify(built.body) : '';
  const previewOk = preview !== null && preview.sig === sig;

  const runPreview = async () => {
    if (!built.ok) return setProblem(built.error);
    setProblem(null);
    const r = await writer.exec('tx:preview', sig, (intent) => actions.previewTransaction(built.body, intent), { noun: 'adjustment', onProblem: setProblem });
    if (r) setPreview({ sig, data: r });
  };

  const create = async () => {
    if (!built.ok || !previewOk) return;
    const r = await writer.exec('tx:new', sig, (intent) => actions.createTransaction(built.body, intent), { noun: 'adjustment', onProblem: setProblem });
    if (r) {
      toast.success('Draft saved. Submit it from the list to post it.');
      onClose();
    }
  };

  if (!kind) return null;
  const busy = writer.busy === 'tx:preview' || writer.busy === 'tx:new';

  return (
    <DialogShell
      open
      onClose={onClose}
      wide
      title={TX_KIND_LABEL[kind]}
      footer={
        <>
          <button type="button" onClick={onClose} className={secondaryBtn}>Cancel</button>
          <button type="button" disabled={busy} onClick={() => void runPreview()} className={secondaryBtn}>{writer.busy === 'tx:preview' ? 'Checking…' : 'Preview the journal'}</button>
          <button type="button" disabled={busy || !previewOk} onClick={() => void create()} className={primaryBtn} title={previewOk ? undefined : 'Preview the journal first'}>Save as draft</button>
        </>
      }
    >
      <p className="text-text-secondary">{KIND_HELP[kind]}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date"><input type="date" value={d.tx_date} onChange={(e) => set({ tx_date: e.target.value })} className={fieldClass} /></Field>
        {kind !== 'revaluation' ? (
          <Field label="Asset">
            <select value={d.asset_id} onChange={(e) => set({ asset_id: e.target.value })} className={fieldClass} aria-label="Asset">
              <option value="">Choose an asset</option>
              {live.map((a) => <option key={a.id} value={a.id}>{a.number} {a.name} ({formatMoney(a.carrying, currency)})</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Category (kept at current value)">
            <select value={d.category_id} onChange={(e) => chooseCategory(e.target.value)} className={fieldClass} aria-label="Category">
              <option value="">Choose a category</option>
              {revalued.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {revalued.length === 0 && !categories.isLoading && <span className="text-[11px] text-text-muted">No category is set to be revalued. Change that on the Categories tab.</span>}
          </Field>
        )}

        {kind === 'disposal' && (
          <>
            <MoneyField label="Money received" value={d.proceeds} onChange={(v) => set({ proceeds: v })} currency={currency} hint="Leave at zero if it was scrapped" />
            {d.proceeds > 0 && (
              <Field label="Received into">
                <AccountPicker accounts={receiving} value={d.proceeds_account_id} onChange={(id) => set({ proceeds_account_id: id })} />
              </Field>
            )}
          </>
        )}
        {(kind === 'impairment' || kind === 'impairment_reversal') && (
          <MoneyField label={kind === 'impairment' ? 'Amount to write down' : 'Amount to put back'} value={d.amount} onChange={(v) => set({ amount: v })} currency={currency} hint={picked ? `Value today ${formatMoney(picked.carrying, currency)}` : undefined} />
        )}
      </div>

      {kind === 'disposal' && picked && picked.revaluation_reserve !== 0 && (
        <label className="flex items-start gap-2 text-xs text-text-secondary">
          <input type="checkbox" className="mt-0.5" checked={d.transfer_reserve} onChange={(e) => set({ transfer_reserve: e.target.checked })} />
          <span>Move the remaining revaluation reserve ({formatMoney(picked.revaluation_reserve, currency)}) straight to retained earnings</span>
        </label>
      )}

      {kind === 'revaluation' && d.category_id && (
        <div className="overflow-hidden rounded-lg border border-border">
          <table className="w-full text-xs" data-testid="reval-values">
            <thead>
              <tr className="h-8 border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase text-text-muted"><th className="px-3 text-left">Asset</th><th className="px-3 text-right">Value today</th><th className="px-3 text-right">New value</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {inCategory.length === 0 && <tr><td colSpan={3} className="px-3 py-4 text-center text-text-muted">There are no assets in use in this category.</td></tr>}
              {inCategory.map((a) => (
                <tr key={a.id} className="h-10">
                  <td className="px-3"><span className="font-mono text-text-muted">{a.number}</span> {a.name}</td>
                  <td className="px-3 text-right tabular-nums text-text-muted">{formatMoney(a.carrying, currency)}</td>
                  <td className="w-44 px-3 py-1"><MoneyInput value={d.values[a.id] ?? 0} currency={currency} size="sm" onChange={(v) => set({ values: { ...d.values, [a.id]: v } })} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t border-border px-3 py-2 text-[11px] text-text-muted">The whole category is revalued together, so every asset needs a value. Enter the same value to leave one unchanged.</p>
        </div>
      )}

      <Field label={kind === 'impairment' || kind === 'impairment_reversal' ? 'Why' : 'Note (optional)'}>
        <input value={d.reason} onChange={(e) => set({ reason: e.target.value })} className={fieldClass} />
      </Field>

      {previewOk && preview ? <TxPreviewPanel preview={preview.data} currency={currency} /> : <Note>Press "Preview the journal" to see exactly what would be posted. You can only save once you have looked at it.</Note>}
      <Problem message={problem} />
    </DialogShell>
  );
};

export const AdjustmentsTab: React.FC<{ writer: Writer }> = ({ writer }) => {
  const navigate = useNavigate();
  const { company } = useActiveCompany();
  const cur = company.base_currency;
  const [kind, setKind] = useState('');
  const [status, setStatus] = useState('');
  const list = useAssetTransactions({ kind, status });
  const categories = useAssetCategories();
  const actions = useFixedAssetActions();
  const [creating, setCreating] = useState<AssetTxKind | null>(null);
  const catName = (id: string | null) => categories.data.find((c) => c.id === id)?.name ?? '';

  const what = (t: AssetTransaction): string => {
    if (t.kind === 'revaluation') return catName(t.category_id) || 'Category';
    const l = t.lines[0];
    return l ? `${l.asset_number} ${l.asset_name}` : '';
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {(['disposal', 'impairment', 'impairment_reversal', 'revaluation'] as const).map((k) => (
          <button key={k} type="button" onClick={() => setCreating(k)} className={k === 'disposal' ? primaryBtn : secondaryBtn}>
            {k === 'disposal' ? 'Sell or scrap an asset' : k === 'impairment' ? 'Write an asset down' : k === 'impairment_reversal' ? 'Reverse a write-down' : 'Revalue a category'}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} className={fieldClass}>
            <option value="">All kinds</option>
            {Object.entries(TX_KIND_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className={fieldClass}>
            <option value="">All statuses</option>
            {Object.entries(DOC_STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </div>

      {list.isLoading ? (
        <LoadingLine what="sales and adjustments" />
      ) : list.error ? (
        <ErrorLine error={list.error} onRetry={list.refetch} />
      ) : list.data.length === 0 ? (
        <div className="rounded-lg border border-border bg-surface px-6 py-12 text-center">
          <h3 className="text-sm font-semibold text-text-primary">Nothing here yet</h3>
          <p className="mt-1 text-[13px] text-text-muted">Sales, scrapping, write-downs and revaluations are listed here once you create them.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full border-collapse text-left text-xs" data-testid="tx-rows">
            <thead>
              <tr className="h-8 border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase text-text-muted">
                <th className="px-3">Number</th><th className="px-3">What</th><th className="px-3">Date</th><th className="px-3">Asset</th><th className="px-3 text-right">Amount</th><th className="px-3">Status</th><th className="px-3" /><th className="px-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.data.map((t) => (
                <tr key={t.id} className="h-11">
                  <td className="px-3 font-mono">{t.number || 'Draft'}</td>
                  <td className="px-3 text-text-primary">{TX_KIND_LABEL[t.kind]}{t.reason && <div className="text-[11px] text-text-muted">{t.reason}</div>}</td>
                  <td className="px-3 tabular-nums text-text-muted">{t.tx_date ? formatDate(t.tx_date) : ''}</td>
                  <td className="px-3 text-text-secondary">{what(t)}</td>
                  <td className="px-3 text-right tabular-nums">{formatMoney(t.kind === 'disposal' ? t.proceeds : t.amount, cur)}</td>
                  <td className="px-3"><DocStatusBadge status={t.status} /></td>
                  <td className="px-3">
                    {t.journal_id && <button type="button" onClick={() => navigate(`/${company.slug}/journals/${t.journal_id}`)} className="text-xs font-medium text-accent hover:underline">Journal</button>}
                  </td>
                  <td className="px-3 py-1.5">
                    <DocActions doc={t} noun="Asset adjustment" total={t.amount} writer={writer} perform={(step, body, intent) => actions.transitionTransaction(t.id, step, body, intent)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <NewTxDialog kind={creating} onClose={() => setCreating(null)} writer={writer} currency={cur} />
    </div>
  );
};
