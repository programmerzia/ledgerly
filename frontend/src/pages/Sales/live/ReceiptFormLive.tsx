import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Eye, Save, Send } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/domain/PageHeader';
import { SignDialog } from '@/components/domain/SignDialog';
import { MoneyInput } from '@/components/domain/MoneyInput';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRouteCompany } from '@/data/session';
import { useAccounts } from '@/data/accounts';
import { useContactDirectory } from '@/data/contacts';
import { useOpenDocs } from '@/data/invoices';
import { useCreditSources, useFetchSettlement, useSettlement, useSettlementActions } from '@/data/settlements';
import { useTradeRefs } from '@/data/tradeRefs';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import { describePurchaseViolation, describeTradeViolation } from '@/api/tradeViolations';
import { IntentSlot } from '@/api/intentSlot';
import { toApiDate } from '@/api/adapters/dates';
import { toDocPreview, type DocPreview } from '@/api/adapters/invoice';
import { toSettlementRequest, type LiveSettlement, type SettlementDraftInput } from '@/api/adapters/settlement';
import { BTN_ACCENT, BTN_GHOST, ErrorLine, LoadingLine, inputClass } from './parts';
import { SIDES, type Side } from './side';

/**
 * Record money received from a customer and say which invoices it pays. What is left over stays as credit on account.
 * Every amount is typed or comes from the server; the server checks the allocations and works out the rest.
 */
const ReceiptFormInner: React.FC<{ side: Side }> = ({ side }) => {
  const S = SIDES[side];
  const describeV = side === 'purchases' ? describePurchaseViolation : describeTradeViolation;
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const draftParam = params.get('draft') ?? undefined;
  const contactParam = params.get('contactId') ?? undefined;
  const invoiceParam = params.get('invoiceId') ?? undefined;
  const company = useRouteCompany();
  const coSlug = company.slug;
  const base = company.base_currency;
  const accounts = useAccounts();
  const customers = useContactDirectory(S.contactKind);
  const refs = useTradeRefs();
  const existing = useSettlement(draftParam);
  const fetchSettlement = useFetchSettlement();
  const actions = useSettlementActions();
  const { run, signProps } = useSignedRun();

  // A supplier can also pay money back to us (a refund of a debit note or of credit on account).
  const [refund, setRefund] = useState(side === 'purchases' && params.get('kind') === 'supplier_refund');
  const [contactId, setContactId] = useState(contactParam ?? '');
  const [bankId, setBankId] = useState('');
  const [date, setDate] = useState(() => toApiDate(new Date()));
  const [amount, setAmount] = useState(0);
  const [fxRate, setFxRate] = useState('');
  const [reference, setReference] = useState('');
  const [memo, setMemo] = useState('');
  const [alloc, setAlloc] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<{ id: string; version: number } | null>(null);
  const [saved, setSaved] = useState<LiveSettlement | null>(null);
  const [savedSig, setSavedSig] = useState<string | null>(null);

  const [busy, setBusy] = useState<null | 'save' | 'preview' | 'submit'>(null);
  const [preview, setPreview] = useState<DocPreview | null>(null);
  const [headerErrors, setHeaderErrors] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [reviewOpen, setReviewOpen] = useState(false);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [justLoaded, setJustLoaded] = useState(false);

  const saveSlot = useRef(new IntentSlot()).current;
  const submitSlot = useRef(new IntentSlot()).current;
  const previewSlot = useRef(new IntentSlot()).current;

  const what = refund ? 'supplier refund' : S.settlement;
  const bank = refs.bankAccounts.find((b) => b.id === bankId);
  const currency = bank?.currency ?? base;
  const open = useOpenDocs(contactId || undefined, refund ? S.creditKind : S.mainKind, S.resource);
  const sources = useCreditSources(refund && contactId ? contactId : undefined, 'payment');
  const contact = customers.byId.get(contactId);

  function hydrate(s: LiveSettlement) {
    setRefund(s.kind === 'supplier_refund');
    setContactId(s.contact_id);
    setBankId(s.bank_account_id ?? '');
    setDate(s.settlement_date);
    setAmount(s.amount_fc);
    setFxRate(s.currency !== base ? s.fx_rate : '');
    setReference(s.reference);
    setMemo(s.memo);
    setAlloc(Object.fromEntries(s.allocations.filter((a) => a.invoice_id || a.source_settlement_id).map((a) => [a.invoice_id ?? `s:${a.source_settlement_id}`, a.amount_fc])));
    setDraft({ id: s.id, version: s.version });
    setSaved(s);
    setPreview(null);
    setHeaderErrors([]);
    setJustLoaded(true);
  }

  const loaded = useRef(false);
  useEffect(() => {
    const s = existing.data;
    if (!s || loaded.current || s.status !== 'draft') return;
    loaded.current = true;
    hydrate(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  // Coming from an invoice: its open amount (the server's figure) is the starting point, in the bank's own currency only.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || draftParam || !invoiceParam) return;
    const inv = open.docs.find((d) => d.id === invoiceParam);
    if (!inv || !bank || inv.currency !== bank.currency || inv.currency !== base) return;
    seeded.current = true;
    setAmount(inv.amount_due);
    setAlloc({ [inv.id]: inv.amount_due });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open.docs, bank]);

  // A single bank account is the obvious choice.
  useEffect(() => {
    if (!bankId && !draftParam && refs.bankAccounts.length === 1) setBankId(refs.bankAccounts[0].id);
  }, [refs.bankAccounts, bankId, draftParam]);

  const input = (): SettlementDraftInput => ({
    kind: refund ? 'supplier_refund' : S.settlementKind,
    contact_id: contactId,
    cash_account_id: bank?.account_id ?? '',
    bank_account_id: bankId,
    settlement_date: date,
    amount_fc: amount,
    currency,
    fx_rate: fxRate,
    reference,
    memo,
    allocations: Object.entries(alloc).map(([key, amount_fc]) => (key.startsWith('s:') ? { source_settlement_id: key.slice(2), amount_fc } : { invoice_id: key, amount_fc })),
  });
  const contentSig = useMemo(
    () => JSON.stringify(toSettlementRequest(input(), base)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refund, contactId, bankId, date, amount, currency, fxRate, reference, memo, alloc, bank],
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
      if (amount > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, amount]);

  const showError = (e: unknown) => {
    if (isSigningCancelled(e)) return;
    if (e instanceof ApiError && e.isVersionConflict) return openConflict(e);
    if (e instanceof ApiError && e.violations?.length) setHeaderErrors(e.violations.map((v) => describeV(v)));
    else if (e instanceof ApiError && e.isValidation) {
      const named: Record<string, string> = {};
      const rest: string[] = [];
      for (const [k, v] of Object.entries(e.errors ?? {})) {
        if (['contact_id', 'cash_account_id', 'bank_account_id', 'settlement_date', 'amount_fc', 'fx_rate', 'currency'].includes(k)) named[k] = v[0] ?? '';
        else rest.push(v[0] ?? k);
      }
      setFieldErrors(named);
      setHeaderErrors(rest.length || Object.keys(named).length ? rest : [describeError(e)]);
    } else setHeaderErrors([describeError(e)]);
  };

  function localProblems(): boolean {
    const f: Record<string, string> = {};
    if (!contactId) f.contact_id = `Choose a ${S.contact}.`;
    if (!bankId) f.bank_account_id = side === 'sales' ? 'Choose where the money went.' : refund ? 'Choose where the money came in.' : 'Choose where the money comes from.';
    if (!date) f.settlement_date = 'Choose a date.';
    if (amount <= 0) f.amount_fc = side === 'sales' ? 'Enter the amount received.' : refund ? 'Enter the amount refunded.' : 'Enter the amount paid.';
    setFieldErrors(f);
    return Object.keys(f).length > 0;
  }

  async function save(versionOverride?: number): Promise<LiveSettlement | null> {
    setHeaderErrors([]);
    setFieldErrors({});
    if (localProblems()) return null;
    setBusy('save');
    const body = toSettlementRequest(input(), base, draft ? (versionOverride ?? draft.version) : undefined);
    const intent = saveSlot.for(JSON.stringify([draft?.id ?? null, body]));
    try {
      const s = draft ? await actions.update(draft.id, body, intent) : await actions.create(body, intent);
      saveSlot.clear();
      setDraft({ id: s.id, version: s.version });
      setSaved(s);
      setSavedSig(contentSig);
      setPreview(null);
      return s;
    } catch (e) {
      showError(e);
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function previewNow(): Promise<{ preview: DocPreview } | null> {
    let current = draft;
    if (dirty || !current) {
      const s = await save();
      if (!s) return null;
      current = { id: s.id, version: s.version };
    }
    setBusy('preview');
    try {
      const p = toDocPreview(await actions.preview(current.id, previewSlot.for(`${current.id}:${current.version}`)));
      previewSlot.clear();
      setPreview(p);
      setHeaderErrors(p.valid ? [] : p.violations.map((v) => describeV(v)));
      return { preview: p };
    } catch (e) {
      showError(e);
      return null;
    } finally {
      setBusy(null);
    }
  }

  const onSubmitClick = async () => {
    setAttempted(true);
    const res = await previewNow();
    if (res?.preview.valid) setReviewOpen(true);
  };

  const confirmSubmit = async () => {
    if (!draft) return;
    setReviewOpen(false);
    setBusy('submit');
    const { id, version } = draft;
    const intent = submitSlot.for(`${id}:${version}`);
    try {
      const s = await run(() => actions.submit(id, version, intent));
      submitSlot.clear();
      toast.success(s.status === 'posted' ? `Posted as ${s.number ?? `a numbered ${what}`}` : 'Sent for approval. It posts when an approver signs it.');
      navigate(`/${coSlug}/${S.settlementPath}/${s.id}`);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  };

  function openConflict(e: ApiError) {
    const serverVersion = e.serverVersion;
    setConflict({
      noun: what,
      serverVersion,
      localVersion: draft?.version,
      onClose: () => setConflict(null),
      onReload: () => {
        setConflict(null);
        if (draft) void fetchSettlement(draft.id).then(hydrate).catch(showError);
      },
      onOverwrite:
        draft && typeof serverVersion === 'number'
          ? () => {
              setConflict(null);
              void save(serverVersion).then((s) => s && toast.success('Saved over the other change'));
            }
          : undefined,
    });
  }

  if (draftParam && existing.isLoading) return <LoadingLine what="draft" />;
  if (draftParam && existing.error) return <ErrorLine error={existing.error} onRetry={existing.refetch} />;
  if (draftParam && existing.data && existing.data.status !== 'draft') {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
        This {what} is {existing.data.status.replace('_', ' ')}, so it can no longer be edited.{' '}
        <button type="button" className="text-accent hover:underline" onClick={() => navigate(`/${coSlug}/${S.settlementPath}/${existing.data?.id}`)}>Open it</button>
      </div>
    );
  }

  const working = busy !== null;
  // Display-only: integer minor units, summed as typed. The server checks the allocations on preview and submit.
  const typedAllocated = Object.values(alloc).reduce((s, v) => s + (v || 0), 0);
  const accountName = (aid: string) => {
    const a = accounts.data.find((x) => x.id === aid);
    return a ? `${a.code} ${a.name}` : '';
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumb={[{ label: contact ? contact.name : S.Contacts, to: contact ? `/${coSlug}/${S.contactsPath}/${contact.id}` : `/${coSlug}/${S.contactsPath}` }, { label: draft ? `Edit ${what}` : `New ${what}` }]}
        title={draft ? `Edit draft ${what}` : side === 'sales' ? 'Receive money' : refund ? 'Record a supplier refund' : 'Pay a supplier'}
        subtitle={draft ? (dirty ? 'Draft · unsaved changes' : 'Draft · saved') : 'Not saved yet'}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={async () => { setAttempted(true); const s = await save(); if (s) toast.success('Draft saved'); }} disabled={working || !dirty} className={BTN_GHOST}>
              <Save className="size-4 text-text-muted" /> {busy === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            <button type="button" onClick={async () => { setAttempted(true); await previewNow(); }} disabled={working} className={BTN_GHOST}>
              <Eye className="size-4 text-text-muted" /> {busy === 'preview' ? 'Checking…' : 'Preview posting'}
            </button>
            <button type="button" onClick={() => void onSubmitClick()} disabled={working} className={BTN_ACCENT}>
              <Send className="size-4" /> {busy === 'submit' ? 'Submitting…' : `Submit ${what}`}
            </button>
          </div>
        }
      />

      {side === 'purchases' && !draft && (
        <div className="flex items-center gap-1 border-b border-border" role="tablist" aria-label="Kind of payment">
          {([[false, 'Pay a supplier'], [true, 'Supplier refund']] as const).map(([v, label]) => (
            <button key={label} type="button" role="tab" aria-selected={refund === v} onClick={() => { setRefund(v); setAlloc({}); setPreview(null); }} className={cn('-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors', refund === v ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary')}>
              {label}
            </button>
          ))}
        </div>
      )}

      {attempted && headerErrors.length > 0 && (
        <div role="alert" data-testid="doc-errors" className="flex flex-col gap-1.5 rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs font-medium text-danger">
          {headerErrors.map((m, i) => (
            <div key={i} className="flex items-center gap-2"><AlertTriangle className="size-4 shrink-0" /><span>{m}</span></div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 md:grid-cols-4">
        <div className="flex flex-col gap-1 md:col-span-2">
          <label htmlFor="r-customer" className="text-xs font-medium text-text-secondary">{side === 'sales' ? 'Received from' : refund ? 'Refunded by' : 'Paid to'}</label>
          <select id="r-customer" value={contactId} disabled={Boolean(draft)} onChange={(e) => { setContactId(e.target.value); setAlloc({}); }} className={inputClass}>
            <option value="">Choose a {S.contact}</option>
            {customers.contacts.map((c) => (<option key={c.id} value={c.id}>{c.name} ({c.code})</option>))}
          </select>
          {fieldErrors.contact_id && <span className="text-[11px] text-danger">{fieldErrors.contact_id}</span>}
        </div>
        <div className="flex flex-col gap-1 md:col-span-2">
          <label htmlFor="r-bank" className="text-xs font-medium text-text-secondary">{side === 'sales' || refund ? 'Paid into' : 'Paid from'}</label>
          <select id="r-bank" value={bankId} onChange={(e) => { const next = refs.bankAccounts.find((x) => x.id === e.target.value); if (next?.currency !== currency) setAlloc({}); setBankId(e.target.value); }} className={inputClass}>
            <option value="">Choose a bank account</option>
            {refs.bankAccounts.map((b) => (<option key={b.id} value={b.id}>{b.name} · {b.currency}</option>))}
          </select>
          {fieldErrors.bank_account_id && <span className="text-[11px] text-danger">{fieldErrors.bank_account_id}</span>}
          {fieldErrors.cash_account_id && <span className="text-[11px] text-danger">{fieldErrors.cash_account_id}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="r-date" className="text-xs font-medium text-text-secondary">{side === 'sales' || refund ? 'Date received' : 'Date paid'}</label>
          <input id="r-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          {fieldErrors.settlement_date && <span className="text-[11px] text-danger">{fieldErrors.settlement_date}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="r-amount" className="text-xs font-medium text-text-secondary">{side === 'sales' ? 'Amount received' : refund ? 'Amount refunded' : 'Amount paid'} ({currency})</label>
          <MoneyInput id="r-amount" value={amount} onChange={setAmount} currency={currency} allowNegative={false} size="sm" />
          {fieldErrors.amount_fc && <span className="text-[11px] text-danger">{fieldErrors.amount_fc}</span>}
        </div>
        {currency !== base && (
          <div className="flex flex-col gap-1">
            <label htmlFor="r-fx" className="text-xs font-medium text-text-secondary">Exchange rate (1 {currency} = ? {base})</label>
            <input id="r-fx" inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="Empty: the stored rate" className={inputClass} />
            {fieldErrors.fx_rate && <span className="text-[11px] text-danger">{fieldErrors.fx_rate}</span>}
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="r-ref" className="text-xs font-medium text-text-secondary">Reference</label>
          <input id="r-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. transfer number" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1 md:col-span-4">
          <label htmlFor="r-memo" className="text-xs font-medium text-text-secondary">Note</label>
          <input id="r-memo" value={memo} onChange={(e) => setMemo(e.target.value)} className={inputClass} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold text-text-primary">{side === 'sales' ? 'Which invoices does this pay?' : refund ? 'Which debit notes or credits does this pay back?' : 'Which bills does this pay?'}</span>
        {!contactId ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-[13px] text-text-muted">Choose a {S.contact} to see what {side === 'sales' ? 'they owe' : refund ? 'they owe you' : 'you owe them'}.</p>
        ) : open.isLoading ? (
          <LoadingLine what={refund ? 'open debit notes' : `open ${S.mains}`} />
        ) : open.error ? (
          <ErrorLine error={open.error} onRetry={open.refetch} />
        ) : open.docs.length === 0 && !refund ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-[13px] text-text-muted">This {S.contact} has no open {S.mains}. The whole amount will stay as credit on account.</p>
        ) : open.docs.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-[13px] text-text-muted" data-testid="no-open-credit">This supplier has no open debit notes.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <table className="w-full text-left text-xs" data-testid="allocation-table">
              <thead>
                <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  <th className="px-3 py-2">{refund ? 'Debit note' : S.Main}</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">{refund ? 'Left to refund' : side === 'sales' ? 'Owed' : 'To pay'}</th>
                  <th className="w-56 px-3 py-2 text-right">Apply ({currency})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {open.docs.map((d) => {
                  const fits = d.currency === currency;
                  return (
                    <tr key={d.id} className={cn(!fits && 'opacity-60')}>
                      <td className="px-3 py-2 font-semibold text-text-primary">{d.number}</td>
                      <td className="px-3 py-2 tabular-nums text-text-muted">{d.due_date ? formatDate(d.due_date) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(d.total_fc, d.currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(d.amount_due_fc, d.currency)}</td>
                      <td className="px-3 py-2">
                        {fits ? (
                          <div className="flex items-center justify-end gap-2">
                            <button type="button" onClick={() => setAlloc((a) => ({ ...a, [d.id]: d.amount_due_fc }))} className="rounded border border-border px-2 py-1 text-[11px] hover:bg-surface-neutral">Full</button>
                            <div className="w-32">
                              <MoneyInput value={alloc[d.id] ?? 0} onChange={(v) => setAlloc((a) => ({ ...a, [d.id]: v }))} currency={currency} allowNegative={false} size="sm" />
                            </div>
                          </div>
                        ) : (
                          <span className="block text-right text-text-muted">In {d.currency}; this {what} is in {currency}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {refund && contactId && sources.sources.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-border bg-surface" data-testid="credit-sources">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  <th className="px-3 py-2">Payment with credit on account</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2 text-right">Credit left</th>
                  <th className="w-56 px-3 py-2 text-right">Pay back ({currency})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {sources.sources.map((p) => {
                  const fits = p.currency === currency;
                  return (
                    <tr key={p.id} className={cn(!fits && 'opacity-60')}>
                      <td className="px-3 py-2 font-semibold text-text-primary">{p.number}</td>
                      <td className="px-3 py-2 tabular-nums text-text-muted">{formatDate(p.settlement_date)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(p.unallocated_fc, p.currency)}</td>
                      <td className="px-3 py-2">
                        {fits ? (
                          <div className="flex items-center justify-end gap-2">
                            <button type="button" onClick={() => setAlloc((a) => ({ ...a, [`s:${p.id}`]: p.unallocated_fc }))} className="rounded border border-border px-2 py-1 text-[11px] hover:bg-surface-neutral">Full</button>
                            <div className="w-32">
                              <MoneyInput value={alloc[`s:${p.id}`] ?? 0} onChange={(v) => setAlloc((a) => ({ ...a, [`s:${p.id}`]: v }))} currency={currency} allowNegative={false} size="sm" />
                            </div>
                          </div>
                        ) : (
                          <span className="block text-right text-text-muted">In {p.currency}; this refund is in {currency}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1 text-xs text-text-secondary">
          <span>Applied to {refund ? 'credits' : S.mains} (as typed) <span className="tabular-nums text-text-primary">{formatMoney(typedAllocated, currency)}</span></span>
          <span className="text-text-muted">·</span>
          <span className="text-text-muted">{refund ? 'A refund must pay back credit in full. The server checks the amounts.' : 'Whatever is not applied stays as credit on account. The server checks the amounts.'}</span>
        </div>
        {saved && !dirty && (
          <p className="text-right text-xs text-text-secondary" data-testid="saved-unallocated">
            Credit on account once posted, as the server worked it out: <span className="tabular-nums text-text-primary">{formatMoney(saved.unallocated_fc, saved.currency)}</span>
          </p>
        )}
      </div>

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
              </tbody>
            </table>
          )}
          {preview.violations.length > 0 && (
            <ul className="mt-3 flex flex-col gap-1 text-xs text-danger">
              {preview.violations.map((v, i) => (<li key={i}>{describeV(v)}</li>))}
            </ul>
          )}
        </section>
      )}

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader className="gap-1.5 border-b border-border pb-2">
            <DialogTitle className="text-base font-semibold text-text-primary">Submit this {what}</DialogTitle>
            <DialogDescription className="text-xs text-text-muted">If your company has an approval rule it goes to an approver. Otherwise it posts now and asks for your PIN.</DialogDescription>
          </DialogHeader>
          {saved && (
            <div className="flex flex-col gap-2 text-xs text-text-secondary" data-testid="submit-review">
              <div className="flex justify-between"><span>{side === 'sales' || refund ? 'From' : 'To'}</span><span className="text-text-primary">{contact?.name ?? '—'}</span></div>
              <div className="flex justify-between"><span>{side === 'sales' || refund ? 'Received' : 'Paid'}</span><span className="tabular-nums text-text-primary">{formatMoney(saved.amount_fc, saved.currency)}</span></div>
              <div className="flex justify-between"><span>Left as credit on account</span><span className="tabular-nums text-text-primary">{formatMoney(saved.unallocated_fc, saved.currency)}</span></div>
            </div>
          )}
          <DialogFooter className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setReviewOpen(false)} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral">Cancel</button>
            <button type="button" onClick={() => void confirmSubmit()} className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover">Submit {what}</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SignDialog
        {...signProps}
        documentTitle={`${refund ? 'Supplier refund' : S.Settlement}: ${contact?.name ?? ''}`}
        amount={saved?.amount}
        currency={base}
        periodName={preview?.period?.name ?? undefined}
        actionTitle="Sign and post"
        consequenceText={`Nobody else needs to approve this ${what} under your company rules, so it posts now with the next number${side === 'sales' ? ' and marks the invoices as paid' : refund ? '' : ' and marks the bills as paid'}. Mistakes are fixed later with a reversal.`}
      />
      <ConflictDialog conflict={conflict} />
    </div>
  );
};

export const ReceiptFormLive: React.FC<{ side?: Side }> = ({ side = 'sales' }) => {
  const [params] = useSearchParams();
  return <ReceiptFormInner side={side} key={`${params.get('kind') ?? ''}:${params.get('draft') ?? 'new'}:${params.get('contactId') ?? ''}:${params.get('invoiceId') ?? ''}`} />;
};
