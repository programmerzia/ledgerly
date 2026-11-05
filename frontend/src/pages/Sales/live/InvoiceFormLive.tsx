import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Eye, Plus, Save, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/domain/PageHeader';
import { SignDialog } from '@/components/domain/SignDialog';
import { MoneyInput } from '@/components/domain/MoneyInput';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRouteCompany } from '@/data/session';
import { useAccounts } from '@/data/accounts';
import { pickableAccounts } from '@/api/adapters/account';
import { useContactDirectory } from '@/data/contacts';
import { useDoc, useDocActions, useDocList, useFetchDoc } from '@/data/invoices';
import { useTradeRefs } from '@/data/tradeRefs';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import { describePurchaseViolation, describeTradeViolation } from '@/api/tradeViolations';
import { IntentSlot } from '@/api/intentSlot';
import { toApiDate } from '@/api/adapters/dates';
import {
  isDiscount,
  isQuantity,
  splitDocFieldErrors,
  splitDocViolations,
  toDocPreview,
  toDraftInput,
  toInvoiceRequest,
  type DocDraftInput,
  type DocPreview,
  type LiveDoc,
} from '@/api/adapters/invoice';
import { matchOverrideRefusal, matchRefusal, type MatchRefusal } from '@/api/adapters/procurement';
import { MatchRefusalNotice } from '@/pages/Purchases/live/MatchPanels';
import type { InvoiceKind } from '@/types';
import type { Violation } from '@/api/errors';
import { BTN_ACCENT, BTN_GHOST, ErrorLine, LoadingLine, inputClass } from './parts';
import { SIDES, type Side, type SideConfig } from './side';

interface FormLine {
  key: string;
  item_id: string;
  account_id: string;
  description: string;
  quantity: string;
  unit_price_fc: number;
  discount_pct: string;
  tax_code_id: string;
  dimensions: Record<string, string>;
  /** Carried untouched so a save does not drop the link to an order (a PUT replaces the lines). */
  purchase_order_line_id: string;
  goods_receipt_line_id: string;
  errors?: Record<string, string>;
}

let lineSeq = 0;
const blankLine = (over: Partial<FormLine> = {}): FormLine => ({
  key: `l-${Date.now()}-${++lineSeq}`,
  item_id: '',
  account_id: '',
  description: '',
  quantity: '1',
  unit_price_fc: 0,
  discount_pct: '',
  tax_code_id: '',
  dimensions: {},
  purchase_order_line_id: '',
  goods_receipt_line_id: '',
  ...over,
});

const nounOf = (S: SideConfig, kind: InvoiceKind): { one: string; title: string } => (kind === S.creditKind ? { one: S.credit, title: S.credit } : { one: S.main, title: S.main });

function fromDraft(d: DocDraftInput): FormLine[] {
  return d.lines.map((l) =>
    blankLine({
      item_id: l.item_id ?? '',
      account_id: l.account_id,
      description: l.description,
      quantity: l.quantity,
      unit_price_fc: l.unit_price_fc,
      discount_pct: l.discount_pct,
      tax_code_id: l.tax_code_id ?? '',
      dimensions: l.dimensions ?? {},
      purchase_order_line_id: l.purchase_order_line_id ?? '',
      goods_receipt_line_id: l.goods_receipt_line_id ?? '',
    }),
  );
}

/** Raise or edit an invoice or a credit note against the API: a server draft, the server's totals and preview, a signed submit. */
const InvoiceFormInner: React.FC<{ side: Side }> = ({ side }) => {
  const S = SIDES[side];
  const describeV = side === 'purchases' ? describePurchaseViolation : describeTradeViolation;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const draftParam = params.get('draft') ?? undefined;
  const kindParam: InvoiceKind = params.get('kind') === 'credit_note' || params.get('kind') === 'debit_note' ? S.creditKind : S.mainKind;
  const relatedParam = params.get('invoice') ?? undefined;
  const contactParam = params.get('contactId') ?? undefined;
  const company = useRouteCompany();
  const coSlug = company.slug;
  const base = company.base_currency;
  const accounts = useAccounts();
  const customers = useContactDirectory(S.contactKind);
  const refs = useTradeRefs();
  const existing = useDoc(draftParam, S.resource);
  const related = useDoc(draftParam ? undefined : relatedParam, S.resource);
  const fetchDoc = useFetchDoc(S.resource);
  const actions = useDocActions(S.resource);
  const { run, signProps } = useSignedRun();

  const [kind, setKind] = useState<InvoiceKind>(kindParam);
  const [contactId, setContactId] = useState(contactParam ?? '');
  const [issueDate, setIssueDate] = useState(() => toApiDate(new Date()));
  const [dueDate, setDueDate] = useState('');
  const [currency, setCurrency] = useState(base);
  const [fxRate, setFxRate] = useState('');
  const [reference, setReference] = useState('');
  const [memo, setMemo] = useState('');
  const [relatedId, setRelatedId] = useState(relatedParam ?? '');
  const [whtCodeId, setWhtCodeId] = useState('');
  const [lines, setLines] = useState<FormLine[]>([blankLine()]);
  const [draft, setDraft] = useState<{ id: string; version: number } | null>(null);
  const [saved, setSaved] = useState<LiveDoc | null>(null);
  const [savedSig, setSavedSig] = useState<string | null>(null);

  const [busy, setBusy] = useState<null | 'save' | 'preview' | 'submit'>(null);
  const [preview, setPreview] = useState<DocPreview | null>(null);
  const [headerErrors, setHeaderErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [justLoaded, setJustLoaded] = useState(false);
  // `sig` is the bill as it was submitted: editing it makes the refusal out of date, and it is not shown any more.
  const [refusal, setRefusal] = useState<(MatchRefusal & { sig: string }) | null>(null);

  const saveSlot = useRef(new IntentSlot()).current;
  const submitSlot = useRef(new IntentSlot()).current;
  const previewSlot = useRef(new IntentSlot()).current;

  const noun = nounOf(S, kind);
  const customerOptions = customers.contacts;
  const contact = customers.byId.get(contactId);

  function hydrate(d: LiveDoc, asDraft: boolean) {
    const input = toDraftInput(d);
    setKind(d.kind);
    setContactId(input.contact_id);
    setIssueDate(input.issue_date);
    setDueDate(asDraft ? input.due_date : '');
    setCurrency(input.currency);
    setFxRate(input.currency !== base ? input.fx_rate : '');
    setReference(input.reference);
    setMemo(input.memo);
    setRelatedId(input.related_invoice_id ?? '');
    setWhtCodeId(input.wht_code_id ?? '');
    setLines(fromDraft(input));
    if (asDraft) {
      setDraft({ id: d.id, version: d.version });
      setSaved(d);
      setJustLoaded(true);
    }
    setPreview(null);
    setHeaderErrors([]);
  }

  const loaded = useRef(false);
  useEffect(() => {
    const d = existing.data;
    if (!d || loaded.current || d.status !== 'draft') return;
    loaded.current = true;
    hydrate(d, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  // A credit note started from an invoice begins as a copy of its lines; the person trims it to what is being credited.
  const copied = useRef(false);
  useEffect(() => {
    const d = related.data;
    if (!d || copied.current || kindParam !== S.creditKind) return;
    copied.current = true;
    // A credit or debit note is never linked to an order, so the copy starts without the bill's links.
    hydrate({ ...d, kind: S.creditKind, due_date: '', reference: '', memo: '', related_invoice_id: d.id, wht_code_id: null, lines: d.lines.map((l) => ({ ...l, purchase_order_line_id: null, goods_receipt_line_id: null })) }, false);
    setRelatedId(d.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [related.data]);

  // Choosing a customer sets the currency and what a new line starts with: the customer's own defaults.
  const onPickContact = (id: string) => {
    setContactId(id);
    setRelatedId('');
    const c = customers.byId.get(id);
    if (c && !draft) {
      setCurrency(c.default_currency);
      setLines((prev) =>
        prev.map((l) => (l.account_id || l.tax_code_id || l.description || l.unit_price_fc ? l : { ...l, account_id: c.default_account_id ?? '', tax_code_id: c.default_tax_code_id ?? '' })),
      );
    }
  };

  const draftInput = (): DocDraftInput => ({
    kind,
    contact_id: contactId,
    issue_date: issueDate,
    due_date: dueDate,
    currency,
    fx_rate: fxRate,
    reference,
    memo,
    related_invoice_id: relatedId || undefined,
    ...(side === 'purchases' && kind === S.mainKind ? { wht_code_id: whtCodeId } : {}),
    lines: lines.map((l) => ({
      item_id: l.item_id || undefined,
      account_id: l.account_id,
      description: l.description,
      quantity: l.quantity,
      unit_price_fc: l.unit_price_fc,
      discount_pct: l.discount_pct,
      tax_code_id: l.tax_code_id || undefined,
      dimensions: l.dimensions,
      purchase_order_line_id: l.purchase_order_line_id || undefined,
      goods_receipt_line_id: l.goods_receipt_line_id || undefined,
    })),
  });
  const contentSig = useMemo(
    () => JSON.stringify(toInvoiceRequest(draftInput(), base)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [kind, contactId, issueDate, dueDate, currency, fxRate, reference, memo, relatedId, whtCodeId, lines],
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
      if (lines.some((l) => l.description || l.unit_price_fc)) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, lines]);

  /* ----------------------------------------------------------- showing verdicts */

  const clearErrors = () => {
    setFieldErrors({});
    setLines((prev) => prev.map((l) => ({ ...l, errors: undefined })));
  };

  const showViolations = (violations: Violation[]) => {
    const { header, byLine } = splitDocViolations(violations);
    setLines((prev) =>
      prev.map((l, i) => {
        const vs = byLine.get(i + 1);
        return vs ? { ...l, errors: Object.fromEntries(vs.map((v) => [v.code, describeV(v)])) } : { ...l, errors: undefined };
      }),
    );
    const texts = header.map((v) => describeV(v));
    if (violations.length > 0 && header.length === 0) texts.push(`This ${noun.one} cannot be posted yet. See the highlighted lines.`);
    setHeaderErrors(texts);
  };

  const showFieldErrors = (e: ApiError) => {
    const { header, byIndex } = splitDocFieldErrors(e.errors);
    setLines((prev) => prev.map((l, i) => ({ ...l, errors: byIndex.get(i) })));
    const named: Record<string, string> = {};
    const rest: string[] = [];
    for (const h of header) {
      if (['contact_id', 'issue_date', 'due_date', 'currency', 'fx_rate', 'related_invoice_id', 'reference', 'memo', 'wht_code_id'].includes(h.field)) named[h.field] = h.message;
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
    const refused = side === 'purchases' ? matchRefusal(e) : null;
    if (refused) {
      // Highlight the lines, and say what to do about it: fix the bill, or pass it with a reason if allowed.
      setRefusal({ ...refused, sig: contentSig });
      showViolations(refused.violations);
      // The notice below carries the line detail; a second generic banner would only repeat it.
      setHeaderErrors([]);
      return;
    }
    const overrideRefused = matchOverrideRefusal(e);
    if (overrideRefused) {
      setHeaderErrors([describeV({ code: overrideRefused, message: '' })]);
      return;
    }
    if (e instanceof ApiError && e.violations?.length) showViolations(e.violations);
    else if (e instanceof ApiError && e.isValidation) showFieldErrors(e);
    else setHeaderErrors([describeError(e)]);
  };

  /** The things the browser can see are wrong before it asks: text shape only, no arithmetic. */
  function localProblems(): boolean {
    const header: string[] = [];
    const field: Record<string, string> = {};
    if (!contactId) field.contact_id = `Choose a ${S.contact}.`;
    if (!issueDate) field.issue_date = 'Choose a date.';
    let bad = false;
    const next = lines.map((l) => {
      const e: Record<string, string> = {};
      if (!isQuantity(l.quantity)) e.quantity = 'Enter a quantity such as 1 or 2.5.';
      if (!isDiscount(l.discount_pct)) e.discount_pct = 'Enter a percentage such as 10 or 7.5.';
      if (Object.keys(e).length) bad = true;
      return { ...l, errors: Object.keys(e).length ? e : undefined };
    });
    setLines(next);
    setFieldErrors(field);
    setHeaderErrors(header);
    return bad || Object.keys(field).length > 0;
  }

  /* ------------------------------------------------------------------- actions */

  async function save(versionOverride?: number): Promise<LiveDoc | null> {
    clearErrors();
    setHeaderErrors([]);
    if (localProblems()) return null;
    setBusy('save');
    const version = draft ? (versionOverride ?? draft.version) : undefined;
    const body = toInvoiceRequest(draftInput(), base, version);
    const intent = saveSlot.for(JSON.stringify([draft?.id ?? null, body]));
    try {
      const d = draft ? await actions.update(draft.id, body, intent) : await actions.create(body, intent);
      saveSlot.clear();
      setDraft({ id: d.id, version: d.version });
      setSaved(d);
      setSavedSig(contentSig);
      setPreview(null);
      return d;
    } catch (e) {
      showError(e);
      return null;
    } finally {
      setBusy(null);
    }
  }

  const onSaveClick = async () => {
    setAttempted(true);
    const d = await save();
    if (d) toast.success('Draft saved');
  };

  async function previewNow(): Promise<{ doc: { id: string; version: number }; preview: DocPreview } | null> {
    let current = draft;
    if (dirty || !current) {
      const d = await save();
      if (!d) return null;
      current = { id: d.id, version: d.version };
    }
    setBusy('preview');
    try {
      const p = toDocPreview(await actions.preview(current.id, previewSlot.for(`${current.id}:${current.version}`)));
      previewSlot.clear();
      setPreview(p);
      if (p.valid) {
        setHeaderErrors([]);
        setLines((prev) => prev.map((l) => ({ ...l, errors: undefined })));
      } else showViolations(p.violations);
      return { doc: current, preview: p };
    } catch (e) {
      showError(e);
      return null;
    } finally {
      setBusy(null);
    }
  }

  const onPreviewClick = async () => {
    setAttempted(true);
    await previewNow();
  };

  const onSubmitClick = async () => {
    setAttempted(true);
    const res = await previewNow();
    if (res?.preview.valid) setReviewOpen(true);
  };

  const confirmSubmit = async (matchOverrideReason?: string) => {
    if (!draft) return;
    setReviewOpen(false);
    setBusy('submit');
    const { id, version } = draft;
    const intent = submitSlot.for(`${id}:${version}:${matchOverrideReason ?? ''}`);
    try {
      const d = await run(() => actions.submit(id, version, intent, matchOverrideReason));
      submitSlot.clear();
      setRefusal(null);
      toast.success(d.status === 'posted' ? `Posted as ${d.number ?? `a numbered ${noun.one}`}` : 'Sent for approval. It posts when an approver signs it.');
      navigate(`/${coSlug}/${S.docsPath}/${d.id}`);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  };

  /* ------------------------------------------------------------------ conflicts */

  function openConflict(e: ApiError) {
    const serverVersion = e.serverVersion;
    setConflict({
      noun: noun.one,
      serverVersion,
      localVersion: draft?.version,
      onClose: () => setConflict(null),
      onReload: () => {
        setConflict(null);
        if (!draft) return;
        void fetchDoc(draft.id)
          .then((d) => {
            hydrate(d, true);
            toast.success('Loaded the saved version');
          })
          .catch(showError);
      },
      onOverwrite:
        draft && typeof serverVersion === 'number'
          ? () => {
              setConflict(null);
              void save(serverVersion).then((d) => d && toast.success('Saved over the other change'));
            }
          : undefined,
      onKeepBoth: async () => {
        setConflict(null);
        try {
          const d = await actions.create(toInvoiceRequest(draftInput(), base), new IntentSlot().for('copy'));
          toast.success('Your version was saved as a new draft');
          navigate(`/${coSlug}/${S.docsPath}/new?draft=${d.id}`);
        } catch (err) {
          showError(err);
        }
      },
    });
  }

  /* --------------------------------------------------------------------- render */

  if (draftParam && existing.isLoading) return <LoadingLine what="draft" />;
  if (draftParam && existing.error) return <ErrorLine error={existing.error} onRetry={existing.refetch} />;
  if (draftParam && existing.data && existing.data.status !== 'draft') {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
        This {nounOf(S, existing.data.kind).one} is {existing.data.status.replace('_', ' ')}, so it can no longer be edited.{' '}
        <button type="button" className="text-accent hover:underline" onClick={() => navigate(`/${coSlug}/${S.docsPath}/${existing.data?.id}`)}>
          Open it
        </button>
      </div>
    );
  }
  if (!draftParam && relatedParam && related.isLoading) return <LoadingLine what={S.main} />;

  const working = busy !== null;
  const revenue = pickableAccounts(accounts.data, lines.map((l) => l.account_id)).filter((a) => a.is_active && a.is_postable && a.account_type === S.lineAccountType);
  const accountName = (id: string) => {
    const a = accounts.data.find((x) => x.id === id);
    return a ? `${a.code} ${a.name}` : '';
  };
  const setLine = (key: string, patch: Partial<FormLine>) => setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch, errors: undefined } : l)));
  const pickItem = (key: string, itemId: string) => {
    const it = refs.items.find((i) => i.id === itemId);
    if (!it) return setLine(key, { item_id: '' });
    setLine(key, {
      item_id: it.id,
      description: it.name,
      account_id: (side === 'purchases' ? it.purchase_account_id : it.sales_account_id) ?? '',
      unit_price_fc: it.currency === currency ? (side === 'purchases' ? it.purchase_price : it.sales_price) : 0,
      tax_code_id: it.tax_code_id ?? '',
    });
  };
  const periodWarning = preview?.period && preview.period.status && preview.period.status !== 'open' ? preview.period : null;
  // Display-only: a running sum of what the person typed would need arithmetic on quantity text, so there is none.
  const staleTotals = saved && dirty;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumb={[{ label: kind === S.creditKind ? S.Credits : S.Mains, to: `/${coSlug}/${S.docsPath}` }, { label: draft ? 'Edit draft' : `New ${noun.one}` }]}
        title={draft ? `Edit draft ${noun.title}` : `New ${noun.one}`}
        subtitle={draft ? (dirty ? 'Draft · unsaved changes' : 'Draft · saved') : 'Not saved yet'}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void onSaveClick()} disabled={working || !dirty} className={BTN_GHOST}>
              <Save className="size-4 text-text-muted" />
              {busy === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            <button type="button" onClick={() => void onPreviewClick()} disabled={working} className={BTN_GHOST}>
              <Eye className="size-4 text-text-muted" />
              {busy === 'preview' ? 'Checking…' : 'Preview posting'}
            </button>
            <button type="button" onClick={() => void onSubmitClick()} disabled={working} className={BTN_ACCENT}>
              <Send className="size-4" />
              {busy === 'submit' ? 'Submitting…' : `Submit ${noun.one}`}
            </button>
          </div>
        }
      />

      {attempted && headerErrors.length > 0 && (
        <div role="alert" data-testid="doc-errors" className="flex flex-col gap-1.5 rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs font-medium text-danger">
          {headerErrors.map((m, i) => (
            <div key={i} className="flex items-center gap-2">
              <AlertTriangle className="size-4 shrink-0" />
              <span>{m}</span>
            </div>
          ))}
        </div>
      )}
      {refusal && refusal.sig === contentSig && <MatchRefusalNotice refusal={refusal} canOverride={Boolean(saved?.can.override_match)} busy={working} onSubmitAnyway={(reason) => void confirmSubmit(reason)} />}
      {periodWarning && (
        <div className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-xs text-danger">
          <span className="font-semibold">{periodWarning.name}</span> is {String(periodWarning.status).replace('_', ' ')}. The server will not post to it unless the period is reopened.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 md:grid-cols-4">
        <div className="flex flex-col gap-1 md:col-span-2">
          <label htmlFor="d-customer" className="text-xs font-medium text-text-secondary">{S.Contact}</label>
          <select id="d-customer" value={contactId} onChange={(e) => onPickContact(e.target.value)} disabled={Boolean(draft)} className={inputClass}>
            <option value="">Choose a {S.contact}</option>
            {customerOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.code})
              </option>
            ))}
          </select>
          {fieldErrors.contact_id && <span className="text-[11px] text-danger">{fieldErrors.contact_id}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="d-date" className="text-xs font-medium text-text-secondary">{kind === S.creditKind ? `${S.Credit} date` : `${S.Main} date`}</label>
          <input id="d-date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} className={inputClass} />
          {fieldErrors.issue_date && <span className="text-[11px] text-danger">{fieldErrors.issue_date}</span>}
        </div>
        {kind === S.mainKind && (
          <div className="flex flex-col gap-1">
            <label htmlFor="d-due" className="text-xs font-medium text-text-secondary">Due date</label>
            <input id="d-due" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
            <span className="text-[11px] text-text-muted">{dueDate ? '' : contact ? `Empty: ${contact.payment_terms_days} days from the ${S.main} date` : `Empty: from the ${S.contact}’s terms`}</span>
            {fieldErrors.due_date && <span className="text-[11px] text-danger">{fieldErrors.due_date}</span>}
          </div>
        )}
        {kind === S.creditKind && (
          <RelatedInvoicePicker S={S} contactId={contactId} value={relatedId} onChange={setRelatedId} error={fieldErrors.related_invoice_id} />
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="d-cur" className="text-xs font-medium text-text-secondary">Currency</label>
          <input id="d-cur" value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))} className={inputClass} maxLength={3} />
          {fieldErrors.currency && <span className="text-[11px] text-danger">{fieldErrors.currency}</span>}
        </div>
        {currency !== base && (
          <div className="flex flex-col gap-1">
            <label htmlFor="d-fx" className="text-xs font-medium text-text-secondary">Exchange rate (1 {currency} = ? {base})</label>
            <input id="d-fx" inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="Empty: the stored rate" className={inputClass} />
            {fieldErrors.fx_rate && <span className="text-[11px] text-danger">{fieldErrors.fx_rate}</span>}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="d-ref" className="text-xs font-medium text-text-secondary">Reference</label>
          <input id="d-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder={side === 'purchases' ? "The supplier’s own number" : "e.g. PO-4471"} className={inputClass} />
        </div>
        {side === 'purchases' && kind === S.mainKind && (
          <div className="flex flex-col gap-1">
            <label htmlFor="d-wht" className="text-xs font-medium text-text-secondary">Tax withheld when paid</label>
            <select id="d-wht" value={whtCodeId} onChange={(e) => setWhtCodeId(e.target.value)} className={inputClass}>
              <option value="">None</option>
              {refs.taxCodes.filter((t) => t.kind === 'wht').map((t) => (
                <option key={t.id} value={t.id}>{t.code} · {t.name}</option>
              ))}
            </select>
            <span className="text-[11px] text-text-muted">Held back from the payment and owed to the tax office.</span>
            {fieldErrors.wht_code_id && <span className="text-[11px] text-danger">{fieldErrors.wht_code_id}</span>}
          </div>
        )}
        <div className="flex flex-col gap-1 md:col-span-4">
          <label htmlFor="d-memo" className="text-xs font-medium text-text-secondary">{side === 'purchases' ? 'Note' : 'Note to the customer'}</label>
          <input id="d-memo" value={memo} onChange={(e) => setMemo(e.target.value)} className={inputClass} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-text-primary">Lines</span>
        {accounts.error ? (
          <ErrorLine error={accounts.error} onRetry={accounts.refetch} />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[980px] text-left text-xs" data-testid="doc-lines">
              <thead>
                <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  <th className="w-40 px-2 py-2">Item</th>
                  <th className="px-2 py-2">Description</th>
                  <th className="w-44 px-2 py-2">Account</th>
                  <th className="w-20 px-2 py-2 text-right">Qty</th>
                  <th className="w-32 px-2 py-2 text-right">Unit price</th>
                  <th className="w-20 px-2 py-2 text-right">Disc. %</th>
                  <th className="w-36 px-2 py-2">Tax</th>
                  <th className="w-28 px-2 py-2 text-right">{staleTotals ? 'Net (saved)' : 'Net'}</th>
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((l, i) => {
                  const savedLine = !dirty ? saved?.lines[i] : undefined;
                  return (
                    <React.Fragment key={l.key}>
                      <tr className={cn(l.errors && 'bg-danger-soft/40')}>
                        <td className="px-2 py-1.5">
                          <select aria-label={`Item, line ${i + 1}`} value={l.item_id} onChange={(e) => pickItem(l.key, e.target.value)} className={cn(inputClass, 'w-full')}>
                            <option value="">None</option>
                            {refs.items.map((it) => (
                              <option key={it.id} value={it.id}>
                                {it.name}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input aria-label={`Description, line ${i + 1}`} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value })} className={cn(inputClass, 'w-full')} />
                          {l.purchase_order_line_id && <div className="mt-0.5 text-[11px] text-text-muted">From a purchase order</div>}
                        </td>
                        <td className="px-2 py-1.5">
                          <select aria-label={`Account, line ${i + 1}`} value={l.account_id} onChange={(e) => setLine(l.key, { account_id: e.target.value })} className={cn(inputClass, 'w-full')}>
                            <option value="">Default account</option>
                            {revenue.map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.code} {a.name}
                              </option>
                            ))}
                            {l.account_id && !revenue.some((a) => a.id === l.account_id) && <option value={l.account_id}>{accountName(l.account_id) || 'Other account'}</option>}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input aria-label={`Quantity, line ${i + 1}`} inputMode="decimal" value={l.quantity} onChange={(e) => setLine(l.key, { quantity: e.target.value })} className={cn(inputClass, 'w-full text-right tabular-nums')} />
                        </td>
                        <td className="px-2 py-1.5">
                          <MoneyInput value={l.unit_price_fc} onChange={(v) => setLine(l.key, { unit_price_fc: v })} currency={currency} allowNegative={false} size="sm" />
                        </td>
                        <td className="px-2 py-1.5">
                          <input aria-label={`Discount percent, line ${i + 1}`} inputMode="decimal" value={l.discount_pct} onChange={(e) => setLine(l.key, { discount_pct: e.target.value })} className={cn(inputClass, 'w-full text-right tabular-nums')} />
                        </td>
                        <td className="px-2 py-1.5">
                          <select aria-label={`Tax code, line ${i + 1}`} value={l.tax_code_id} onChange={(e) => setLine(l.key, { tax_code_id: e.target.value })} className={cn(inputClass, 'w-full')}>
                            <option value="">No tax</option>
                            {refs.taxCodes.filter((t) => side === 'sales' || t.kind !== 'wht').map((t) => (
                              <option key={t.id} value={t.id}>
                                {t.code}
                                {side === 'purchases' && !t.is_recoverable ? ' (not claimable)' : ''}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums text-text-primary">{savedLine ? formatMoney(savedLine.line_total_fc, currency) : '—'}</td>
                        <td className="px-1 py-1.5 text-center">
                          <button type="button" aria-label={`Remove line ${i + 1}`} disabled={lines.length === 1} onClick={() => setLines((prev) => prev.filter((x) => x.key !== l.key))} className="rounded p-1 text-text-muted hover:bg-surface-neutral hover:text-danger disabled:opacity-30">
                            <Trash2 className="size-3.5" />
                          </button>
                        </td>
                      </tr>
                      {l.errors && (
                        <tr className="bg-danger-soft/40">
                          <td colSpan={9} className="px-3 pb-2 text-[11px] text-danger" data-testid={`line-error-${i + 1}`}>
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
          <span className="text-[11px] text-text-muted">Totals and tax are worked out by the server when the draft is saved.</span>
        </div>
      </div>

      {saved && (
        <section aria-label="Totals" data-testid="doc-totals" className="ml-auto w-full max-w-sm rounded-lg border border-border bg-surface p-4 text-[13px]">
          <h3 className="mb-2 text-xs font-semibold text-text-muted">{staleTotals ? 'Totals as last saved' : 'Totals'}</h3>
          <dl className="flex flex-col gap-1.5">
            <div className="flex justify-between"><dt className="text-text-secondary">Subtotal</dt><dd className="tabular-nums">{formatMoney(saved.subtotal_fc, saved.currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-text-secondary">Tax</dt><dd className="tabular-nums">{formatMoney(saved.tax_total_fc, saved.currency)}</dd></div>
            <div className="flex justify-between border-t border-border pt-1.5 font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(saved.total_fc, saved.currency)}</dd></div>
            {side === 'purchases' && saved.wht_code_id && (
              <div className="flex justify-between text-text-secondary"><dt>Withheld when paid</dt><dd className="tabular-nums" data-testid="doc-wht">{formatMoney(saved.wht_amount_fc, saved.currency)}</dd></div>
            )}
            {saved.currency !== base && (
              <div className="flex justify-between text-text-muted"><dt>In {base}</dt><dd className="tabular-nums">{formatMoney(saved.total, base)}</dd></div>
            )}
          </dl>
        </section>
      )}

      {preview && (
        <section aria-label="Posting preview" data-testid="posting-preview" className="rounded-lg border border-border bg-surface p-4 text-[13px]">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-primary">Posting preview</h3>
            {preview.valid ? (
              <span className="flex items-center gap-1 text-xs font-medium text-success"><CheckCircle2 className="size-3.5" /> The server would accept this</span>
            ) : (
              <span className="text-xs font-medium text-danger">The server would refuse this</span>
            )}
          </div>
          <p className="mt-1 text-xs text-text-muted">Period: {preview.period?.name ? `${preview.period.name} (${String(preview.period.status ?? '').replace('_', ' ')})` : 'none found for this date'}</p>
          {preview.lines.length > 0 && (
            <table className="mt-3 w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border text-[10px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  <th className="px-2 py-1">Account</th>
                  <th className="px-2 py-1">What it is</th>
                  <th className="w-28 px-2 py-1 text-right">Debit</th>
                  <th className="w-28 px-2 py-1 text-right">Credit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.lines.map((pl) => (
                  <tr key={pl.line_no}>
                    <td className="px-2 py-1.5">{accountName(pl.account_id)}</td>
                    <td className="px-2 py-1.5 text-text-secondary">{pl.description}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{pl.debit > 0 ? formatMoney(pl.debit, preview.currency) : ''}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{pl.credit > 0 ? formatMoney(pl.credit, preview.currency) : ''}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="px-2 py-1.5" colSpan={2}>Total</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(preview.totalDebit, preview.currency)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{formatMoney(preview.totalCredit, preview.currency)}</td>
                </tr>
              </tbody>
            </table>
          )}
          {preview.violations.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 text-xs text-danger">
              {preview.violations.map((v, i) => (
                <li key={i}>
                  {typeof v.line_no === 'number' ? `Line ${v.line_no}: ` : ''}
                  {describeV(v)}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader className="gap-1.5 border-b border-border pb-2">
            <DialogTitle className="text-base font-semibold text-text-primary">Submit this {noun.one}</DialogTitle>
            <DialogDescription className="text-xs text-text-muted">
              If your company has an approval rule it goes to an approver. Otherwise it posts now with the next number and asks for your PIN. A posted {noun.one} cannot be edited, only reversed.
            </DialogDescription>
          </DialogHeader>
          {saved && preview && (
            <div className="flex flex-col gap-2 text-xs text-text-secondary" data-testid="submit-review">
              <div className="flex justify-between"><span>{S.Contact}</span><span className="text-text-primary">{contact?.name ?? '—'}</span></div>
              <div className="flex justify-between"><span>Period</span><span className="text-text-primary">{preview.period?.name ?? '—'}</span></div>
              <div className="flex justify-between"><span>Total</span><span className="tabular-nums text-text-primary">{formatMoney(saved.total_fc, saved.currency)}</span></div>
              <div className="flex justify-between"><span>Posts to the books as</span><span className="tabular-nums text-text-primary">{formatMoney(preview.totalDebit, preview.currency)}</span></div>
            </div>
          )}
          <DialogFooter className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setReviewOpen(false)} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral">Cancel</button>
            <button type="button" onClick={() => void confirmSubmit()} className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover">Submit {noun.one}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SignDialog
        {...signProps}
        documentTitle={`${kind === S.creditKind ? S.Credit : S.Main}: ${contact?.name ?? ''}`}
        amount={saved?.total}
        currency={base}
        periodName={preview?.period?.name ?? undefined}
        actionTitle="Sign and post"
        consequenceText={`Nobody else needs to approve this ${noun.one} under your company rules, so it posts now with the next number. Mistakes are fixed later with a reversal.`}
      />
      <ConflictDialog conflict={conflict} />
    </div>
  );
};

/** The posted invoice a credit note refers to. The server checks the pairing and the amount when the note is posted. */
const RelatedInvoicePicker: React.FC<{ S: SideConfig; contactId: string; value: string; onChange: (id: string) => void; error?: string }> = ({ S, contactId, value, onChange, error }) => {
  const list = useDocList({ contact_id: contactId, kind: S.mainKind, status: 'posted' }, S.resource);
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor="d-related" className="text-xs font-medium text-text-secondary">{S.side === 'sales' ? 'Credits invoice' : 'Refers to bill'}</label>
      <select id="d-related" value={value} onChange={(e) => onChange(e.target.value)} disabled={!contactId} className={inputClass}>
        <option value="">None (credit on account)</option>
        {list.rows.map((d) => (
          <option key={d.id} value={d.id}>
            {d.number} · {formatMoney(d.total_fc, d.currency)}
          </option>
        ))}
        {value && !list.rows.some((d) => d.id === value) && <option value={value}>The {S.main} being {S.side === 'sales' ? 'credited' : 'corrected'}</option>}
      </select>
      {error && <span className="text-[11px] text-danger">{error}</span>}
    </div>
  );
};

/** Keyed so moving to another draft (keep both) starts the form fresh. */
export const InvoiceFormLive: React.FC<{ side?: Side }> = ({ side = 'sales' }) => {
  const [params] = useSearchParams();
  return <InvoiceFormInner side={side} key={`${params.get('draft') ?? 'new'}:${params.get('kind') ?? ''}:${params.get('invoice') ?? ''}`} />;
};

/** `credit-notes/new` is the invoice form with the kind set; an `?invoice=` is passed through. */
export const NewCreditNoteLive: React.FC<{ side?: Side }> = ({ side = 'sales' }) => {
  const { co } = useParams();
  const [params] = useSearchParams();
  const S = SIDES[side];
  const next = new URLSearchParams(params);
  next.set('kind', S.creditKind);
  return <Navigate to={`/${co}/${S.docsPath}/new?${next.toString()}`} replace />;
};
