import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, Plus, Save, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/domain/PageHeader';
import { SignDialog } from '@/components/domain/SignDialog';
import { MoneyInput } from '@/components/domain/MoneyInput';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRouteCompany } from '@/data/session';
import { useAccounts } from '@/data/accounts';
import { pickableAccounts } from '@/api/adapters/account';
import { useDimensions } from '@/data/dimensions';
import { useTradeRefs } from '@/data/tradeRefs';
import { useRequisition, useRequisitionActions } from '@/data/procurement';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import { describePurchaseViolation } from '@/api/tradeViolations';
import { IntentSlot } from '@/api/intentSlot';
import { toApiDate } from '@/api/adapters/dates';
import { isQuantity, splitDocFieldErrors } from '@/api/adapters/invoice';
import { isPositiveQuantity, toRequisitionInput, toRequisitionRequest, type Requisition, type RequisitionDraftInput } from '@/api/adapters/procurement';
import { BTN_ACCENT, BTN_GHOST, ErrorLine, LoadingLine, inputClass } from './parts';

interface FormLine {
  key: string;
  item_id: string;
  description: string;
  account_id: string;
  quantity: string;
  estimated_unit_price: number;
  needed_by: string;
  dimensions: Record<string, string>;
  errors?: Record<string, string>;
}

let seq = 0;
const blankLine = (over: Partial<FormLine> = {}): FormLine => ({
  key: `rl-${Date.now()}-${++seq}`,
  item_id: '',
  description: '',
  account_id: '',
  quantity: '1',
  estimated_unit_price: 0,
  needed_by: '',
  dimensions: {},
  ...over,
});

const fromInput = (d: RequisitionDraftInput): FormLine[] =>
  d.lines.map((l) =>
    blankLine({
      item_id: l.item_id ?? '',
      description: l.description,
      account_id: l.account_id ?? '',
      quantity: l.quantity,
      estimated_unit_price: l.estimated_unit_price,
      needed_by: l.needed_by,
      dimensions: l.dimensions ?? {},
    }),
  );

const Inner: React.FC<{ editId?: string }> = ({ editId }) => {
  const navigate = useNavigate();
  const company = useRouteCompany();
  const co = company.slug;
  const base = company.base_currency;
  const accounts = useAccounts();
  const refs = useTradeRefs();
  const dims = useDimensions();
  const existing = useRequisition(editId);
  const actions = useRequisitionActions();
  const { run, signProps } = useSignedRun();

  const [date, setDate] = useState(() => toApiDate(new Date()));
  const [memo, setMemo] = useState('');
  const [lines, setLines] = useState<FormLine[]>([blankLine()]);
  const [draft, setDraft] = useState<{ id: string; version: number } | null>(null);
  const [savedSig, setSavedSig] = useState<string | null>(null);
  const [justLoaded, setJustLoaded] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'submit'>(null);
  const [headerErrors, setHeaderErrors] = useState<string[]>([]);
  const [dateError, setDateError] = useState('');
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const saveSlot = useRef(new IntentSlot()).current;
  const submitSlot = useRef(new IntentSlot()).current;

  const hydrate = (r: Requisition) => {
    const input = toRequisitionInput(r);
    setDate(input.requisition_date);
    setMemo(input.memo);
    setLines(fromInput(input));
    setDraft({ id: r.id, version: r.version });
    setJustLoaded(true);
    setHeaderErrors([]);
  };

  const loaded = useRef(false);
  useEffect(() => {
    const r = existing.data;
    if (!r || loaded.current || r.status !== 'draft') return;
    loaded.current = true;
    hydrate(r);
  }, [existing.data]);

  const input = (): RequisitionDraftInput => ({
    requisition_date: date,
    memo,
    lines: lines.map((l) => ({
      item_id: l.item_id || undefined,
      description: l.description,
      account_id: l.account_id || undefined,
      quantity: l.quantity,
      estimated_unit_price: l.estimated_unit_price,
      needed_by: l.needed_by,
      dimensions: l.dimensions,
    })),
  });
  const contentSig = useMemo(
    () => JSON.stringify(toRequisitionRequest(input())),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [date, memo, lines],
  );
  const dirty = draft === null || savedSig !== contentSig;

  useEffect(() => {
    if (!justLoaded) return;
    setSavedSig(contentSig);
    setJustLoaded(false);
  }, [justLoaded, contentSig]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (lines.some((l) => l.description || l.estimated_unit_price)) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, lines]);

  const showError = (e: unknown) => {
    if (isSigningCancelled(e)) return;
    if (e instanceof ApiError && e.isVersionConflict) {
      setConflict({
        noun: 'requisition',
        serverVersion: e.serverVersion,
        localVersion: draft?.version,
        onClose: () => setConflict(null),
        onReload: () => {
          setConflict(null);
          if (draft) void existing.refetch();
        },
        onOverwrite:
          draft && typeof e.serverVersion === 'number'
            ? () => {
                setConflict(null);
                void save(e.serverVersion as number).then((r) => r && toast.success('Saved over the other change'));
              }
            : undefined,
      });
      return;
    }
    if (e instanceof ApiError && e.violations?.length) setHeaderErrors(e.violations.map(describePurchaseViolation));
    else if (e instanceof ApiError && e.isValidation) {
      const { header, byIndex } = splitDocFieldErrors(e.errors);
      setLines((prev) => prev.map((l, i) => ({ ...l, errors: byIndex.get(i) })));
      setHeaderErrors(header.map((h) => h.message));
      if (header.length === 0 && byIndex.size === 0) setHeaderErrors([describeError(e)]);
    } else setHeaderErrors([describeError(e)]);
  };

  /** Text shape only; the server decides everything else. */
  function localProblems(): boolean {
    setDateError(date ? '' : 'Choose a date.');
    let bad = !date;
    setLines((prev) =>
      prev.map((l) => {
        const err: Record<string, string> = {};
        if (!isQuantity(l.quantity) || !isPositiveQuantity(l.quantity)) err.quantity = 'Enter a quantity such as 1 or 2.5.';
        if (!l.item_id && !l.description.trim()) err.description = 'Choose an item or describe what you need.';
        if (Object.keys(err).length) bad = true;
        return { ...l, errors: Object.keys(err).length ? err : undefined };
      }),
    );
    return bad;
  }

  async function save(versionOverride?: number): Promise<Requisition | null> {
    setHeaderErrors([]);
    if (localProblems()) return null;
    setBusy('save');
    const version = draft ? (versionOverride ?? draft.version) : undefined;
    const body = toRequisitionRequest(input(), version);
    const intent = saveSlot.for(JSON.stringify([draft?.id ?? null, body]));
    try {
      const r = draft ? await actions.update(draft.id, body, intent) : await actions.create(body, intent);
      saveSlot.clear();
      setDraft({ id: r.id, version: r.version });
      setSavedSig(contentSig);
      return r;
    } catch (e) {
      showError(e);
      return null;
    } finally {
      setBusy(null);
    }
  }

  const onSave = async () => {
    const first = !editId;
    const r = await save();
    if (!r) return;
    toast.success('Draft saved');
    // The address now names the draft, so a reload or a shared link opens it.
    if (first) navigate(`/${co}/requisitions/${r.id}/edit`, { replace: true });
  };

  const onSubmit = async () => {
    let current = draft;
    if (dirty || !current) {
      const r = await save();
      if (!r) return;
      current = { id: r.id, version: r.version };
    }
    setBusy('submit');
    const { id, version } = current;
    const intent = submitSlot.for(`${id}:${version}`);
    try {
      const r = await run(() => actions.submit(id, version, intent));
      submitSlot.clear();
      toast.success(r.status === 'approved' ? `Approved as ${r.number ?? 'a numbered requisition'}` : 'Sent for approval');
      navigate(`/${co}/requisitions/${r.id}`);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  };

  if (editId && existing.isLoading) return <LoadingLine what="requisition" />;
  if (editId && existing.error) return <ErrorLine error={existing.error} onRetry={existing.refetch} />;
  if (editId && existing.data && existing.data.status !== 'draft') {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
        This requisition is already submitted, so it can no longer be edited.{' '}
        <button type="button" className="text-accent hover:underline" onClick={() => navigate(`/${co}/requisitions/${existing.data?.id}`)}>
          Open it
        </button>
      </div>
    );
  }

  const working = busy !== null;
  const expense = pickableAccounts(accounts.data, lines.map((l) => l.account_id)).filter((a) => a.is_active && a.is_postable && a.account_type === 'expense');
  const accountName = (id: string) => {
    const a = accounts.data.find((x) => x.id === id);
    return a ? `${a.code} ${a.name}` : '';
  };
  const setLine = (key: string, patch: Partial<FormLine>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch, errors: undefined } : l)));
  const pickItem = (key: string, itemId: string) => {
    const it = refs.items.find((i) => i.id === itemId);
    if (!it) return setLine(key, { item_id: '' });
    setLine(key, { item_id: it.id, description: it.name, account_id: it.purchase_account_id ?? '', estimated_unit_price: it.currency === base ? it.purchase_price : 0 });
  };
  const activeDims = dims.data.filter((d) => d.is_active);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumb={[{ label: 'Requisitions', to: `/${co}/requisitions` }, { label: draft ? 'Edit draft' : 'New requisition' }]}
        title={draft ? 'Edit draft requisition' : 'New requisition'}
        subtitle={draft ? (dirty ? 'Draft · unsaved changes' : 'Draft · saved') : 'Not saved yet'}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void onSave()} disabled={working || !dirty} className={BTN_GHOST}>
              <Save className="size-4 text-text-muted" />
              {busy === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            <button type="button" onClick={() => void onSubmit()} disabled={working} className={BTN_ACCENT}>
              <Send className="size-4" />
              {busy === 'submit' ? 'Submitting…' : 'Submit requisition'}
            </button>
          </div>
        }
      />

      {headerErrors.length > 0 && (
        <div role="alert" className="flex flex-col gap-1.5 rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs font-medium text-danger">
          {headerErrors.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              <span>{m}</span>
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 md:grid-cols-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="rq-date" className="text-xs font-medium text-text-secondary">Requisition date</label>
          <input id="rq-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          {dateError && <span className="text-[11px] text-danger">{dateError}</span>}
        </div>
        <div className="flex flex-col gap-1 md:col-span-3">
          <label htmlFor="rq-memo" className="text-xs font-medium text-text-secondary">Note</label>
          <input id="rq-memo" value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="What this is for" className={inputClass} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-text-primary">Lines</span>
        <div className="overflow-x-auto rounded-lg border border-border bg-surface">
          <table className="w-full min-w-[980px] text-left text-xs" data-testid="requisition-lines">
            <thead>
              <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                <th className="w-40 px-2 py-2">Item</th>
                <th className="px-2 py-2">Description</th>
                <th className="w-44 px-2 py-2">Account</th>
                <th className="w-20 px-2 py-2 text-right">Qty</th>
                <th className="w-32 px-2 py-2 text-right">Estimated price</th>
                <th className="w-36 px-2 py-2">Needed by</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {lines.map((l, i) => (
                <React.Fragment key={l.key}>
                  <tr className={cn(l.errors && 'bg-danger-soft/40')}>
                    <td className="px-2 py-1.5">
                      <select aria-label={`Item, line ${i + 1}`} value={l.item_id} onChange={(e) => pickItem(l.key, e.target.value)} className={cn(inputClass, 'w-full')}>
                        <option value="">None</option>
                        {refs.items.map((it) => (
                          <option key={it.id} value={it.id}>{it.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input aria-label={`Description, line ${i + 1}`} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} className={cn(inputClass, 'w-full')} />
                    </td>
                    <td className="px-2 py-1.5">
                      <select aria-label={`Account, line ${i + 1}`} value={l.account_id} onChange={(e) => setLine(l.key, { account_id: e.target.value })} className={cn(inputClass, 'w-full')}>
                        <option value="">Default account</option>
                        {expense.map((a) => (
                          <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                        ))}
                        {l.account_id && !expense.some((a) => a.id === l.account_id) && <option value={l.account_id}>{accountName(l.account_id) || 'Other account'}</option>}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <input aria-label={`Quantity, line ${i + 1}`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} className={cn(inputClass, 'w-full text-right tabular-nums')} />
                    </td>
                    <td className="px-2 py-1.5">
                      <MoneyInput value={l.estimated_unit_price} onChange={(v) => setLine(l.key, { estimated_unit_price: v })} currency={base} allowNegative={false} size="sm" />
                    </td>
                    <td className="px-2 py-1.5">
                      <input type="date" aria-label={`Needed by, line ${i + 1}`} value={l.needed_by} onChange={(e) => setLine(l.key, { needed_by: e.target.value })} className={cn(inputClass, 'w-full')} />
                    </td>
                    <td className="px-1 py-1.5 text-center">
                      <button type="button" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} className="rounded p-1 text-text-muted hover:bg-surface-neutral hover:text-danger disabled:opacity-30">
                        <Trash2 className="size-3.5" />
                      </button>
                    </td>
                  </tr>
                  {activeDims.length > 0 && (
                    <tr>
                      <td colSpan={7} className="px-2 pb-2">
                        <div className="flex flex-wrap items-center gap-2">
                          {activeDims.map((d) => (
                            <label key={d.id} className="flex items-center gap-1.5 text-[11px] text-text-muted">
                              {d.name}
                              <select
                                aria-label={`${d.name}, line ${i + 1}`}
                                value={l.dimensions[d.id] ?? ''}
                                onChange={(e) => {
                                  const next = { ...l.dimensions };
                                  if (e.target.value) next[d.id] = e.target.value;
                                  else delete next[d.id];
                                  setLine(l.key, { dimensions: next });
                                }}
                                className={cn(inputClass, 'w-40')}
                              >
                                <option value="">None</option>
                                {d.values.filter((v) => v.is_active).map((v) => (
                                  <option key={v.id} value={v.id}>{v.code} {v.name}</option>
                                ))}
                              </select>
                            </label>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                  {l.errors && (
                    <tr className="bg-danger-soft/40">
                      <td colSpan={7} className="px-3 pb-2 text-[11px] text-danger" data-testid={`line-error-${i + 1}`}>
                        Line {i + 1}: {Object.values(l.errors).join(' ')}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex items-center justify-between pt-1">
          <button type="button" onClick={() => setLines((prev) => [...prev, blankLine()])} className="flex h-8 items-center gap-1.5 rounded-md border border-dashed border-border px-3 text-[13px] text-text-secondary hover:bg-surface-neutral">
            <Plus className="size-4" /> Add a line
          </button>
          <span className="text-[11px] text-text-muted">Prices are estimates in {base}. The total is worked out by the server when the draft is saved.</span>
        </div>
      </div>

      {draft && !dirty && existing.data && (
        <section aria-label="Totals" className="ml-auto w-full max-w-sm rounded-lg border border-border bg-surface p-4 text-[13px]">
          <h3 className="mb-2 text-xs font-semibold text-text-muted">Estimated total</h3>
          <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums">{formatMoney(existing.data.total, existing.data.currency)}</span></div>
        </section>
      )}

      <SignDialog
        {...signProps}
        documentTitle={`Requisition: ${memo || 'draft'}`}
        actionTitle="Sign and approve"
        consequenceText="Nobody else needs to approve this requisition under your company rules, so it is approved now with the next number."
      />
      <ConflictDialog conflict={conflict} />
    </div>
  );
};

/** Keyed so opening another draft starts the form fresh. */
export const RequisitionForm: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  return <Inner key={id ?? 'new'} editId={id} />;
};
