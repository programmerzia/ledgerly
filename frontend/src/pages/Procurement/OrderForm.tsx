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
import { useContactDirectory } from '@/data/contacts';
import { useDimensions } from '@/data/dimensions';
import { useTradeRefs } from '@/data/tradeRefs';
import { useFetchOrder, useOrder, useOrderActions, useRevision, useRevisionActions } from '@/data/procurement';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { ApiError, type Violation } from '@/api/errors';
import { describeError } from '@/api/messages';
import { describePurchaseViolation } from '@/api/tradeViolations';
import { IntentSlot } from '@/api/intentSlot';
import { toApiDate } from '@/api/adapters/dates';
import { splitDocFieldErrors, splitDocViolations } from '@/api/adapters/invoice';
import {
  isPositiveQuantity,
  snapshotToLines,
  toOrderInput,
  toOrderRequest,
  toRevisionRequest,
  type OrderDraftInput,
  type OrderRevision,
  type PurchaseOrder,
} from '@/api/adapters/procurement';
import { BTN_ACCENT, BTN_GHOST, ErrorLine, LoadingLine, inputClass } from './parts';

interface FormLine {
  key: string;
  /** The line the order already has. Sent back on every save so what was received stays attached. */
  id?: string;
  item_id: string;
  account_id: string;
  description: string;
  quantity: string;
  unit_price_fc: number;
  tax_code_id: string;
  dimensions: Record<string, string>;
  errors?: Record<string, string>;
}

let seq = 0;
const blankLine = (over: Partial<FormLine> = {}): FormLine => ({
  key: `ol-${Date.now()}-${++seq}`,
  item_id: '',
  account_id: '',
  description: '',
  quantity: '1',
  unit_price_fc: 0,
  tax_code_id: '',
  dimensions: {},
  ...over,
});

const fromInput = (lines: OrderDraftInput['lines']): FormLine[] =>
  lines.map((l) =>
    blankLine({
      id: l.id,
      item_id: l.item_id ?? '',
      account_id: l.account_id,
      description: l.description,
      quantity: l.quantity,
      unit_price_fc: l.unit_price_fc,
      tax_code_id: l.tax_code_id ?? '',
      dimensions: l.dimensions ?? {},
    }),
  );

type Mode = 'order' | 'revision';

interface Saved {
  /** The order (order mode) or the revision (revision mode). */
  id: string;
  version: number;
  subtotal_fc: number | null;
  tax_total_fc: number | null;
  total_fc: number | null;
  lineTotals: Array<number | null>;
  currency: string;
}

const savedOfOrder = (o: PurchaseOrder): Saved => ({ id: o.id, version: o.version, subtotal_fc: o.subtotal_fc, tax_total_fc: o.tax_total_fc, total_fc: o.total_fc, lineTotals: o.lines.map((l) => l.line_total_fc), currency: o.currency });
const savedOfRevision = (r: OrderRevision, currency: string): Saved => ({
  id: r.id,
  version: r.version,
  subtotal_fc: r.proposed?.subtotal_fc ?? null,
  tax_total_fc: r.proposed?.tax_total_fc ?? null,
  total_fc: r.proposed?.total_fc ?? null,
  lineTotals: (r.proposed?.lines ?? []).map((l) => l.line_total_fc),
  currency,
});

/**
 * The purchase order form (the bill form's layout without a discount column) and, with `mode="revision"`, the revision form:
 * the same lines, with supplier, currency, rate and order date shown but locked, plus a required reason.
 */
const Inner: React.FC<{ mode: Mode; orderId?: string }> = ({ mode, orderId }) => {
  const revising = mode === 'revision';
  const navigate = useNavigate();
  const company = useRouteCompany();
  const co = company.slug;
  const base = company.base_currency;
  const accounts = useAccounts();
  const suppliers = useContactDirectory('supplier');
  const refs = useTradeRefs();
  const dims = useDimensions();
  const orderQ = useOrder(orderId);
  const fetchOrder = useFetchOrder();
  const order = orderQ.data;
  const openRevisionId = revising ? (order?.open_revision_id ?? undefined) : undefined;
  const revisionQ = useRevision(openRevisionId);
  const orderActions = useOrderActions();
  const revisionActions = useRevisionActions();
  const { run, signProps } = useSignedRun();

  const [contactId, setContactId] = useState('');
  const [orderDate, setOrderDate] = useState(() => toApiDate(new Date()));
  const [expected, setExpected] = useState('');
  const [currency, setCurrency] = useState(base);
  const [fxRate, setFxRate] = useState('');
  const [reference, setReference] = useState('');
  const [memo, setMemo] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<FormLine[]>([blankLine()]);
  const [saved, setSaved] = useState<Saved | null>(null);
  const [savedSig, setSavedSig] = useState<string | null>(null);
  const [justLoaded, setJustLoaded] = useState(false);
  const [busy, setBusy] = useState<null | 'save' | 'submit'>(null);
  const [headerErrors, setHeaderErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const saveSlot = useRef(new IntentSlot()).current;
  const submitSlot = useRef(new IntentSlot()).current;

  const idByPosition = useMemo(() => new Map(dims.data.map((d) => [d.position, d.id])), [dims.data]);
  const noun = revising ? 'revision' : 'purchase order';

  /* ------------------------------------------------------------------- loading */

  const hydrateOrder = (o: PurchaseOrder, asDraft: boolean) => {
    const input = toOrderInput(o);
    setContactId(input.contact_id);
    setOrderDate(input.order_date);
    setExpected(input.expected_date);
    setCurrency(input.currency);
    setFxRate(input.currency !== base ? input.fx_rate : '');
    setReference(input.reference);
    setMemo(input.memo);
    setLines(fromInput(input.lines));
    if (asDraft) {
      setSaved(savedOfOrder(o));
      setJustLoaded(true);
    }
    setHeaderErrors([]);
  };

  const hydrateRevision = (o: PurchaseOrder, r: OrderRevision) => {
    hydrateOrder(o, false);
    const p = r.proposed;
    if (p) {
      setExpected(p.expected_date);
      setReference(p.reference);
      setMemo(p.memo);
      setLines(fromInput(snapshotToLines(p, idByPosition)));
    }
    setReason(r.reason);
    setSaved(savedOfRevision(r, o.currency));
    setJustLoaded(true);
  };

  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current || !order) return;
    if (!revising) {
      if (order.status !== 'draft') return;
      loaded.current = true;
      hydrateOrder(order, true);
      return;
    }
    // A revision starts from the order as it is, or from the open revision's proposal.
    if (order.open_revision_id) {
      if (!revisionQ.data || dims.isLoading) return;
      loaded.current = true;
      hydrateRevision(order, revisionQ.data);
    } else {
      loaded.current = true;
      hydrateOrder(order, false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order, revisionQ.data, dims.isLoading]);

  /* ------------------------------------------------------------------- the request */

  const draftInput = (): OrderDraftInput => ({
    contact_id: contactId,
    order_date: orderDate,
    expected_date: expected,
    currency,
    fx_rate: fxRate,
    reference,
    memo,
    lines: lines.map((l) => ({
      id: l.id,
      item_id: l.item_id || undefined,
      account_id: l.account_id,
      description: l.description,
      quantity: l.quantity,
      unit_price_fc: l.unit_price_fc,
      tax_code_id: l.tax_code_id || undefined,
      dimensions: l.dimensions,
    })),
  });
  const body = (version?: number) => (revising ? toRevisionRequest({ reason, expected_date: expected, reference, memo, lines: draftInput().lines }, version) : toOrderRequest(draftInput(), base, version));
  const contentSig = useMemo(
    () => JSON.stringify(body(0)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contactId, orderDate, expected, currency, fxRate, reference, memo, reason, lines],
  );
  const dirty = saved === null || savedSig !== contentSig;

  useEffect(() => {
    if (!justLoaded) return;
    setSavedSig(contentSig);
    setJustLoaded(false);
  }, [justLoaded, contentSig]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (lines.some((l) => l.description || l.unit_price_fc)) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, lines]);

  /* ---------------------------------------------------------- showing verdicts */

  const showViolations = (violations: Violation[]) => {
    const { header, byLine } = splitDocViolations(violations);
    setLines((prev) =>
      prev.map((l, i) => {
        const vs = byLine.get(i + 1);
        return vs ? { ...l, errors: Object.fromEntries(vs.map((v) => [v.code, describePurchaseViolation(v)])) } : { ...l, errors: undefined };
      }),
    );
    setHeaderErrors(header.map(describePurchaseViolation));
  };

  const showFieldErrors = (e: ApiError) => {
    const { header, byIndex } = splitDocFieldErrors(e.errors);
    setLines((prev) => prev.map((l, i) => ({ ...l, errors: byIndex.get(i) })));
    const named: Record<string, string> = {};
    const rest: string[] = [];
    for (const h of header) {
      if (['contact_id', 'order_date', 'expected_date', 'currency', 'fx_rate', 'reference', 'memo', 'reason'].includes(h.field)) named[h.field] = h.message;
      else rest.push(h.message);
    }
    setFieldErrors(named);
    setHeaderErrors(rest.length || Object.keys(named).length ? rest : [describeError(e)]);
  };

  const showError = (e: unknown) => {
    if (isSigningCancelled(e)) return;
    if (e instanceof ApiError && e.isVersionConflict) {
      openConflict(e);
      return;
    }
    if (e instanceof ApiError && e.violations?.length) showViolations(e.violations);
    else if (e instanceof ApiError && e.isValidation) showFieldErrors(e);
    else setHeaderErrors([describeError(e)]);
  };

  /** Text shape only; the server decides everything else. */
  function localProblems(): boolean {
    const field: Record<string, string> = {};
    if (!revising && !contactId) field.contact_id = 'Choose a supplier.';
    if (!revising && !orderDate) field.order_date = 'Choose a date.';
    if (revising && !reason.trim()) field.reason = 'Say why the order is being changed.';
    let bad = false;
    setLines((prev) =>
      prev.map((l) => {
        const err: Record<string, string> = {};
        if (!isPositiveQuantity(l.quantity)) err.quantity = 'Enter a quantity such as 1 or 2.5.';
        if (Object.keys(err).length) bad = true;
        return { ...l, errors: Object.keys(err).length ? err : undefined };
      }),
    );
    setFieldErrors(field);
    setHeaderErrors([]);
    return bad || Object.keys(field).length > 0;
  }

  /* ------------------------------------------------------------------- actions */

  async function save(versionOverride?: number): Promise<Saved | null> {
    if (localProblems()) return null;
    setBusy('save');
    const version = saved ? (versionOverride ?? saved.version) : undefined;
    // A new revision carries the order's version (optional); an existing one must carry its own.
    const b = body(saved ? version : revising ? order?.version : undefined);
    const intent = saveSlot.for(JSON.stringify([saved?.id ?? null, b]));
    try {
      let next: Saved;
      if (revising) {
        const r = saved ? await revisionActions.update(saved.id, b, intent) : await revisionActions.create(orderId as string, b, intent);
        next = savedOfRevision(r, currency);
      } else {
        const o = saved ? await orderActions.update(saved.id, b, intent) : await orderActions.create(b, intent);
        next = savedOfOrder(o);
      }
      saveSlot.clear();
      setSaved(next);
      setSavedSig(contentSig);
      return next;
    } catch (e) {
      showError(e);
      return null;
    } finally {
      setBusy(null);
    }
  }

  const onSave = async () => {
    const first = saved === null;
    const s = await save();
    if (!s) return;
    toast.success(revising ? 'Revision saved' : 'Draft saved');
    // The address now names the draft, so a reload or a shared link opens it.
    if (first && !revising) navigate(`/${co}/purchase-orders/${s.id}/edit`, { replace: true });
  };

  const onSubmit = async () => {
    let current = saved;
    if (dirty || !current) {
      const s = await save();
      if (!s) return;
      current = s;
    }
    setBusy('submit');
    const { id, version } = current;
    const intent = submitSlot.for(`${id}:${version}`);
    try {
      if (revising) {
        const r = await run(() => revisionActions.submit(id, version, intent));
        submitSlot.clear();
        toast.success(r.status === 'applied' ? 'Revision applied to the order' : 'Revision sent for approval');
        navigate(`/${co}/purchase-orders/${orderId}?tab=revisions`);
      } else {
        const o = await run(() => orderActions.submit(id, version, intent));
        submitSlot.clear();
        toast.success(o.status === 'approved' ? `Approved as ${o.number ?? 'a numbered order'}` : 'Sent for approval');
        navigate(`/${co}/purchase-orders/${o.id}`);
      }
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  };

  function openConflict(e: ApiError) {
    const serverVersion = e.serverVersion;
    setConflict({
      noun,
      serverVersion,
      localVersion: saved?.version,
      onClose: () => setConflict(null),
      onReload: () => {
        setConflict(null);
        if (!saved) return;
        if (revising) {
          void orderQ.refetch();
          void revisionQ.refetch();
          loaded.current = false;
          return;
        }
        void fetchOrder(saved.id)
          .then((o) => {
            hydrateOrder(o, true);
            toast.success('Loaded the saved version');
          })
          .catch(showError);
      },
      onOverwrite:
        saved && typeof serverVersion === 'number'
          ? () => {
              setConflict(null);
              void save(serverVersion).then((s) => s && toast.success('Saved over the other change'));
            }
          : undefined,
    });
  }

  /* -------------------------------------------------------------------- render */

  if (orderId && orderQ.isLoading) return <LoadingLine what="purchase order" />;
  if (orderId && orderQ.error) return <ErrorLine error={orderQ.error} onRetry={orderQ.refetch} />;
  if (revising && order?.open_revision_id && revisionQ.isLoading) return <LoadingLine what="revision" />;
  if (revising && revisionQ.error) return <ErrorLine error={revisionQ.error} onRetry={revisionQ.refetch} />;
  if (!revising && orderId && order && order.status !== 'draft') {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
        This order is {order.status.replace(/_/g, ' ')}, so it can no longer be edited. An approved order changes through a revision.{' '}
        <button type="button" className="text-accent hover:underline" onClick={() => navigate(`/${co}/purchase-orders/${order.id}`)}>
          Open it
        </button>
      </div>
    );
  }
  if (revising && order) {
    const revisionOpen = revisionQ.data;
    const mayEdit = revisionOpen ? revisionOpen.can.update : order.can.revise;
    if (!mayEdit) {
      return (
        <div className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
          {revisionOpen ? 'This revision can no longer be edited.' : 'This order cannot be revised right now.'}{' '}
          <button type="button" className="text-accent hover:underline" onClick={() => navigate(`/${co}/purchase-orders/${order.id}`)}>
            Back to the order
          </button>
        </div>
      );
    }
  }

  const working = busy !== null;
  const expenseAccounts = pickableAccounts(accounts.data, lines.map((l) => l.account_id)).filter((a) => a.is_active && a.is_postable && a.account_type === 'expense');
  const accountName = (id: string) => {
    const a = accounts.data.find((x) => x.id === id);
    return a ? `${a.code} ${a.name}` : '';
  };
  const contact = suppliers.byId.get(contactId);
  const setLine = (key: string, patch: Partial<FormLine>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch, errors: undefined } : l)));
  const pickItem = (key: string, itemId: string) => {
    const it = refs.items.find((i) => i.id === itemId);
    if (!it) return setLine(key, { item_id: '' });
    setLine(key, {
      item_id: it.id,
      description: it.name,
      account_id: it.purchase_account_id ?? '',
      unit_price_fc: it.currency === currency ? it.purchase_price : 0,
      tax_code_id: it.tax_code_id ?? '',
    });
  };
  const onPickSupplier = (id: string) => {
    setContactId(id);
    const c = suppliers.byId.get(id);
    if (c && !saved) {
      setCurrency(c.default_currency);
      setLines((prev) => prev.map((l) => (l.account_id || l.tax_code_id || l.description || l.unit_price_fc ? l : { ...l, account_id: c.default_account_id ?? '', tax_code_id: c.default_tax_code_id ?? '' })));
    }
  };
  const staleTotals = saved && dirty;
  const lockedHeader = revising;
  const title = revising ? (revisionQ.data ? 'Edit revision' : 'Revise order') : saved ? 'Edit draft purchase order' : 'New purchase order';
  const orderLabel = order?.number ?? 'Draft';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumb={
          revising
            ? [{ label: 'Purchase orders', to: `/${co}/purchase-orders` }, { label: orderLabel, to: `/${co}/purchase-orders/${orderId}` }, { label: revisionQ.data ? 'Edit revision' : 'Revise' }]
            : [{ label: 'Purchase orders', to: `/${co}/purchase-orders` }, { label: saved ? 'Edit draft' : 'New purchase order' }]
        }
        title={title}
        subtitle={revising ? `Changes to ${orderLabel} take effect when the revision is approved.` : saved ? (dirty ? 'Draft · unsaved changes' : 'Draft · saved') : 'Not saved yet'}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void onSave()} disabled={working || !dirty} className={BTN_GHOST}>
              <Save className="size-4 text-text-muted" />
              {busy === 'save' ? 'Saving…' : revising ? 'Save revision' : 'Save draft'}
            </button>
            <button type="button" onClick={() => void onSubmit()} disabled={working} className={BTN_ACCENT}>
              <Send className="size-4" />
              {busy === 'submit' ? 'Submitting…' : revising ? 'Submit revision' : 'Submit order'}
            </button>
          </div>
        }
      />

      {headerErrors.length > 0 && (
        <div role="alert" data-testid="doc-errors" className="flex flex-col gap-1.5 rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs font-medium text-danger">
          {headerErrors.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              <span>{m}</span>
            </div>
          ))}
        </div>
      )}

      {revising && (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-5">
          <label htmlFor="po-reason" className="text-xs font-medium text-text-secondary">
            Why is the order changing? <span className="text-danger">*</span>
          </label>
          <input id="po-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: the supplier raised the price" className={inputClass} />
          {fieldErrors.reason && <span className="text-[11px] text-danger">{fieldErrors.reason}</span>}
          <span className="text-[11px] text-text-muted">The order keeps working as it is until this revision is approved. What was received and billed stays on its line.</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 md:grid-cols-4">
        <div className="flex flex-col gap-1 md:col-span-2">
          <label htmlFor="po-supplier" className="text-xs font-medium text-text-secondary">Supplier</label>
          <select id="po-supplier" value={contactId} onChange={(e) => onPickSupplier(e.target.value)} disabled={Boolean(saved) || lockedHeader} className={inputClass}>
            <option value="">Choose a supplier</option>
            {suppliers.contacts.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({c.code})</option>
            ))}
            {contactId && !suppliers.byId.has(contactId) && <option value={contactId}>{order?.contact_name || 'This supplier'}</option>}
          </select>
          {fieldErrors.contact_id && <span className="text-[11px] text-danger">{fieldErrors.contact_id}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="po-date" className="text-xs font-medium text-text-secondary">Order date</label>
          <input id="po-date" type="date" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} disabled={lockedHeader} className={inputClass} />
          {fieldErrors.order_date && <span className="text-[11px] text-danger">{fieldErrors.order_date}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="po-expected" className="text-xs font-medium text-text-secondary">Expected on</label>
          <input id="po-expected" type="date" value={expected} onChange={(e) => setExpected(e.target.value)} className={inputClass} />
          {fieldErrors.expected_date && <span className="text-[11px] text-danger">{fieldErrors.expected_date}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="po-cur" className="text-xs font-medium text-text-secondary">Currency</label>
          <input id="po-cur" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} disabled={lockedHeader} className={inputClass} maxLength={3} />
          {fieldErrors.currency && <span className="text-[11px] text-danger">{fieldErrors.currency}</span>}
        </div>
        {currency !== base && (
          <div className="flex flex-col gap-1">
            <label htmlFor="po-fx" className="text-xs font-medium text-text-secondary">Exchange rate (1 {currency} = ? {base})</label>
            <input id="po-fx" inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} disabled={lockedHeader} placeholder="Empty: the stored rate" className={inputClass} />
            {fieldErrors.fx_rate && <span className="text-[11px] text-danger">{fieldErrors.fx_rate}</span>}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="po-ref" className="text-xs font-medium text-text-secondary">Reference</label>
          <input id="po-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="The supplier’s quote or order number" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1 md:col-span-4">
          <label htmlFor="po-memo" className="text-xs font-medium text-text-secondary">Note</label>
          <input id="po-memo" value={memo} onChange={(e) => setMemo(e.target.value)} className={inputClass} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-text-primary">Lines</span>
        {accounts.error ? (
          <ErrorLine error={accounts.error} onRetry={accounts.refetch} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[920px] text-left text-xs" data-testid="doc-lines">
              <thead>
                <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  <th className="w-40 px-2 py-2">Item</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="w-44 px-2 py-2">Account</th>
                  <th className="w-20 px-2 py-2 text-right">Qty</th>
                  <th className="w-32 px-2 py-2 text-right">Unit price</th>
                  <th className="w-36 px-2 py-2">Tax</th>
                  <th className="w-28 px-2 py-2 text-right">{staleTotals ? 'Net (saved)' : 'Net'}</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((l, i) => {
                  const savedTotal = !dirty ? saved?.lineTotals[i] : undefined;
                  return (
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
                            {expenseAccounts.map((a) => (
                              <option key={a.id} value={a.id}>{a.code} {a.name}</option>
                            ))}
                            {l.account_id && !expenseAccounts.some((a) => a.id === l.account_id) && <option value={l.account_id}>{accountName(l.account_id) || 'Other account'}</option>}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input aria-label={`Quantity, line ${i + 1}`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} className={cn(inputClass, 'w-full text-right tabular-nums')} />
                        </td>
                        <td className="px-2 py-1.5">
                          <MoneyInput value={l.unit_price_fc} onChange={(v) => setLine(l.key, { unit_price_fc: v })} currency={currency} allowNegative={false} size="sm" />
                        </td>
                        <td className="px-2 py-1.5">
                          <select aria-label={`Tax code, line ${i + 1}`} value={l.tax_code_id} onChange={(e) => setLine(l.key, { tax_code_id: e.target.value })} className={cn(inputClass, 'w-full')}>
                            <option value="">No tax</option>
                            {refs.taxCodes.filter((t) => t.kind !== 'wht').map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.code}
                                {!t.is_recoverable ? ' (not claimable)' : ''}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-text-primary">{savedTotal !== undefined && savedTotal !== null ? formatMoney(savedTotal, currency) : '—'}</td>
                        <td className="px-1 py-1.5 text-center">
                          <button type="button" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} className="rounded p-1 text-text-muted hover:bg-surface-neutral hover:text-danger disabled:opacity-30">
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                      {l.errors && (
                        <tr className="bg-danger-soft/40">
                          <td colSpan={8} className="px-3 pb-2 text-[11px] text-danger" data-testid={`line-error-${i + 1}`}>
                            Line {i + 1}: {Object.values(l.errors).join(' ')}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center justify-between pt-1">
          <button type="button" onClick={() => setLines((prev) => [...prev, blankLine({ account_id: contact?.default_account_id ?? '', tax_code_id: contact?.default_tax_code_id ?? '' })])} className="flex h-8 items-center gap-1.5 rounded-md border border-dashed border-border px-3 text-[13px] text-text-secondary hover:bg-surface-neutral">
            <Plus className="size-4" /> Add a line
          </button>
          <span className="text-[11px] text-text-muted">Totals and tax are worked out by the server when the {revising ? 'revision' : 'draft'} is saved.</span>
        </div>
      </div>

      {saved && saved.total_fc !== null && (
        <section aria-label="Totals" data-testid="doc-totals" className="ml-auto w-full max-w-sm rounded-lg border border-border bg-surface p-4 text-[13px]">
          <h3 className="mb-2 text-xs font-semibold text-text-muted">{staleTotals ? 'Totals as last saved' : 'Totals'}</h3>
          <dl className="flex flex-col gap-1.5">
            {saved.subtotal_fc !== null && <div className="flex justify-between"><dt className="text-text-secondary">Subtotal</dt><dd className="tabular-nums">{formatMoney(saved.subtotal_fc, saved.currency)}</dd></div>}
            {saved.tax_total_fc !== null && <div className="flex justify-between"><dt className="text-text-secondary">Tax</dt><dd className="tabular-nums">{formatMoney(saved.tax_total_fc, saved.currency)}</dd></div>}
            <div className="flex justify-between border-t border-border pt-1.5 font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(saved.total_fc, saved.currency)}</dd></div>
          </dl>
        </section>
      )}

      <SignDialog
        {...signProps}
        documentTitle={revising ? `Revision of ${orderLabel}` : `Purchase order: ${contact?.name ?? ''}`}
        currency={base}
        actionTitle={revising ? 'Sign and apply' : 'Sign and approve'}
        consequenceText={revising ? 'Nobody else needs to approve this revision under your company rules, so it is applied to the order now.' : 'Nobody else needs to approve this order under your company rules, so it is approved now with the next number.'}
      />
      <ConflictDialog conflict={conflict} />
    </div>
  );
};

/** Keyed so opening another draft starts the form fresh. */
export const OrderForm: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  return <Inner key={id ?? 'new'} mode="order" orderId={id} />;
};

export const RevisionForm: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  return <Inner key={`rev-${id}`} mode="revision" orderId={id} />;
};
