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
import { useAllOpenDocs } from '@/data/invoices';
import { useFetchPaymentRun, usePaymentRun, usePaymentRunActions } from '@/data/paymentRuns';
import { useTradeRefs } from '@/data/tradeRefs';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import { describePurchaseViolation } from '@/api/tradeViolations';
import { IntentSlot } from '@/api/intentSlot';
import { toApiDate } from '@/api/adapters/dates';
import { toDocPreview, type DocPreview } from '@/api/adapters/invoice';
import { toRunRequest, type LivePaymentRun, type RunDraftInput } from '@/api/adapters/paymentRun';
import { BTN_ACCENT, BTN_GHOST, ErrorLine, LoadingLine, inputClass } from '@/pages/Sales/live/parts';

/**
 * Pay several bills in one go: choose the bank account and date, tick the bills and edit what each one gets. Saving makes
 * a draft; the server works out the withholding and the totals. Submitting posts one payment per supplier (or waits for
 * approval). The only sum in the browser is the labelled "as typed" line, which gates nothing.
 */
const RunFormInner: React.FC = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const draftParam = params.get('draft') ?? undefined;
  const company = useRouteCompany();
  const coSlug = company.slug;
  const base = company.base_currency;
  const accounts = useAccounts();
  const suppliers = useContactDirectory('supplier', true);
  const refs = useTradeRefs();
  const bills = useAllOpenDocs('purchase_bill', 'bills');
  const existing = usePaymentRun(draftParam);
  const fetchRun = useFetchPaymentRun();
  const actions = usePaymentRunActions();
  const { run, signProps } = useSignedRun();

  const [bankId, setBankId] = useState('');
  const [date, setDate] = useState(() => toApiDate(new Date()));
  const [fxRate, setFxRate] = useState('');
  const [reference, setReference] = useState('');
  const [memo, setMemo] = useState('');
  const [dueBy, setDueBy] = useState('');
  const [supplierFilter, setSupplierFilter] = useState('');
  const [pay, setPay] = useState<Record<string, number>>({});
  const [draft, setDraft] = useState<{ id: string; version: number } | null>(null);
  const [saved, setSaved] = useState<LivePaymentRun | null>(null);
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

  const bank = refs.bankAccounts.find((b) => b.id === bankId);
  const currency = bank?.currency ?? base;

  function hydrate(r: LivePaymentRun) {
    setBankId(r.bank_account_id ?? '');
    setDate(r.run_date);
    setFxRate(r.currency !== base ? r.fx_rate : '');
    setReference(r.reference);
    setMemo(r.memo);
    setPay(Object.fromEntries(r.items.map((i) => [i.invoice_id, i.amount_fc])));
    setDraft({ id: r.id, version: r.version });
    setSaved(r);
    setPreview(null);
    setHeaderErrors([]);
    setJustLoaded(true);
  }

  const loaded = useRef(false);
  useEffect(() => {
    const r = existing.data;
    if (!r || loaded.current || r.status !== 'draft') return;
    loaded.current = true;
    hydrate(r);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  useEffect(() => {
    if (!bankId && !draftParam && refs.bankAccounts.length === 1) setBankId(refs.bankAccounts[0].id);
  }, [refs.bankAccounts, bankId, draftParam]);

  const input = (): RunDraftInput => ({
    cash_account_id: bank?.account_id ?? '',
    bank_account_id: bankId,
    run_date: date,
    currency,
    fx_rate: fxRate,
    reference,
    memo,
    items: Object.entries(pay).map(([invoice_id, amount_fc]) => ({ invoice_id, amount_fc })),
  });
  const contentSig = useMemo(
    () => JSON.stringify(toRunRequest(input(), base)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bankId, date, currency, fxRate, reference, memo, pay, bank],
  );
  const dirty = draft === null || savedSig !== contentSig;
  useEffect(() => {
    if (!justLoaded) return;
    setSavedSig(contentSig);
    setJustLoaded(false);
  }, [justLoaded, contentSig]);

  const chosen = Object.values(pay).filter((v) => v > 0).length;
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      if (chosen > 0) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty, chosen]);

  const showError = (e: unknown) => {
    if (isSigningCancelled(e)) return;
    if (e instanceof ApiError && e.isVersionConflict) return openConflict(e);
    if (e instanceof ApiError && e.violations?.length) setHeaderErrors(e.violations.map((v) => describePurchaseViolation(v)));
    else if (e instanceof ApiError && e.isValidation) {
      const named: Record<string, string> = {};
      const rest: string[] = [];
      for (const [k, v] of Object.entries(e.errors ?? {})) {
        if (['cash_account_id', 'bank_account_id', 'run_date', 'fx_rate', 'currency'].includes(k)) named[k] = v[0] ?? '';
        else rest.push(v[0] ?? k);
      }
      setFieldErrors(named);
      setHeaderErrors(rest.length || Object.keys(named).length ? rest : [describeError(e)]);
    } else setHeaderErrors([describeError(e)]);
  };

  function localProblems(): boolean {
    const f: Record<string, string> = {};
    if (!bankId) f.bank_account_id = 'Choose the bank account the money leaves from.';
    if (!date) f.run_date = 'Choose a date.';
    if (chosen === 0) f.items = 'Pick at least one bill and enter what to pay.';
    setFieldErrors(f);
    return Object.keys(f).length > 0;
  }

  async function save(versionOverride?: number): Promise<LivePaymentRun | null> {
    setHeaderErrors([]);
    setFieldErrors({});
    if (localProblems()) return null;
    setBusy('save');
    const body = toRunRequest(input(), base, draft ? (versionOverride ?? draft.version) : undefined);
    const intent = saveSlot.for(JSON.stringify([draft?.id ?? null, body]));
    try {
      const r = draft ? await actions.update(draft.id, body, intent) : await actions.create(body, intent);
      saveSlot.clear();
      setDraft({ id: r.id, version: r.version });
      setSaved(r);
      setSavedSig(contentSig);
      setPreview(null);
      return r;
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
      const r = await save();
      if (!r) return null;
      current = { id: r.id, version: r.version };
    }
    setBusy('preview');
    try {
      const p = toDocPreview(await actions.preview(current.id, previewSlot.for(`${current.id}:${current.version}`)));
      previewSlot.clear();
      setPreview(p);
      setHeaderErrors(p.valid ? [] : p.violations.map((v) => describePurchaseViolation(v)));
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
      const r = await run(() => actions.submit(id, version, intent));
      submitSlot.clear();
      toast.success(r.status === 'posted' ? `Payment run ${r.number ?? ''} posted` : 'Sent for approval. It posts when an approver signs it.');
      navigate(`/${coSlug}/payment-run/${r.id}`);
    } catch (e) {
      showError(e);
    } finally {
      setBusy(null);
    }
  };

  function openConflict(e: ApiError) {
    const serverVersion = e.serverVersion;
    setConflict({
      noun: 'payment run',
      serverVersion,
      localVersion: draft?.version,
      onClose: () => setConflict(null),
      onReload: () => {
        setConflict(null);
        if (draft) void fetchRun(draft.id).then(hydrate).catch(showError);
      },
      onOverwrite:
        draft && typeof serverVersion === 'number'
          ? () => {
              setConflict(null);
              void save(serverVersion).then((r) => r && toast.success('Saved over the other change'));
            }
          : undefined,
    });
  }

  if (draftParam && existing.isLoading) return <LoadingLine what="draft" />;
  if (draftParam && existing.error) return <ErrorLine error={existing.error} onRetry={existing.refetch} />;
  if (draftParam && existing.data && existing.data.status !== 'draft') {
    return (
      <div className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
        This payment run is {existing.data.status.replace('_', ' ')}, so it can no longer be edited.{' '}
        <button type="button" className="text-accent hover:underline" onClick={() => navigate(`/${coSlug}/payment-run/${existing.data?.id}`)}>
          Open it
        </button>
      </div>
    );
  }

  const working = busy !== null;
  const typedTotal = Object.values(pay).reduce((s, v) => s + (v || 0), 0);
  const accountName = (aid: string) => {
    const a = accounts.data.find((x) => x.id === aid);
    return a ? `${a.code} ${a.name}` : '';
  };
  const candidates = bills.docs.filter((d) => (!supplierFilter || d.contact_id === supplierFilter) && (!dueBy || (d.due_date !== '' && d.due_date <= dueBy)));
  const openOf = (d: (typeof bills.docs)[number]) => d.amount_due_fc;
  const wholeBill = (id: string, whole: number | null) => setPay((p) => ({ ...p, [id]: whole ?? 0 }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumb={[{ label: 'Pay bills', to: `/${coSlug}/payment-run` }, { label: draft ? 'Edit draft run' : 'New run' }]}
        title={draft ? 'Edit draft payment run' : 'Pay bills'}
        subtitle={draft ? (dirty ? 'Draft · unsaved changes' : 'Draft · saved') : 'Not saved yet'}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={async () => { setAttempted(true); const r = await save(); if (r) toast.success('Draft saved'); }} disabled={working || !dirty} className={BTN_GHOST}>
              <Save className="size-4 text-text-muted" /> {busy === 'save' ? 'Saving…' : 'Save draft'}
            </button>
            <button type="button" onClick={async () => { setAttempted(true); await previewNow(); }} disabled={working} className={BTN_GHOST}>
              <Eye className="size-4 text-text-muted" /> {busy === 'preview' ? 'Checking…' : 'Preview posting'}
            </button>
            <button type="button" onClick={() => void onSubmitClick()} disabled={working} className={BTN_ACCENT}>
              <Send className="size-4" /> {busy === 'submit' ? 'Submitting…' : 'Submit run'}
            </button>
          </div>
        }
      />

      {attempted && headerErrors.length > 0 && (
        <div role="alert" data-testid="doc-errors" className="flex flex-col gap-1.5 rounded-lg border border-danger/30 bg-danger-soft p-3 text-xs font-medium text-danger">
          {headerErrors.map((m, i) => (
            <div key={i} className="flex items-center gap-2"><AlertTriangle className="size-4 shrink-0" /><span>{m}</span></div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-surface p-5 md:grid-cols-4">
        <div className="flex flex-col gap-1 md:col-span-2">
          <label htmlFor="pr-bank" className="text-xs font-medium text-text-secondary">Paid from</label>
          <select id="pr-bank" value={bankId} onChange={(e) => { const next = refs.bankAccounts.find((x) => x.id === e.target.value); if (next?.currency !== currency) setPay({}); setBankId(e.target.value); }} className={inputClass}>
            <option value="">Choose a bank account</option>
            {refs.bankAccounts.map((b) => (<option key={b.id} value={b.id}>{b.name} · {b.currency}</option>))}
          </select>
          {fieldErrors.bank_account_id && <span className="text-[11px] text-danger">{fieldErrors.bank_account_id}</span>}
          {fieldErrors.cash_account_id && <span className="text-[11px] text-danger">{fieldErrors.cash_account_id}</span>}
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="pr-date" className="text-xs font-medium text-text-secondary">Payment date</label>
          <input id="pr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
          {fieldErrors.run_date && <span className="text-[11px] text-danger">{fieldErrors.run_date}</span>}
        </div>
        {currency !== base ? (
          <div className="flex flex-col gap-1">
            <label htmlFor="pr-fx" className="text-xs font-medium text-text-secondary">Exchange rate (1 {currency} = ? {base})</label>
            <input id="pr-fx" inputMode="decimal" value={fxRate} onChange={(e) => setFxRate(e.target.value)} placeholder="Empty: the stored rate" className={inputClass} />
            {fieldErrors.fx_rate && <span className="text-[11px] text-danger">{fieldErrors.fx_rate}</span>}
          </div>
        ) : (
          <div />
        )}
        <div className="flex flex-col gap-1 md:col-span-2">
          <label htmlFor="pr-ref" className="text-xs font-medium text-text-secondary">Reference</label>
          <input id="pr-ref" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. Friday run" className={inputClass} />
        </div>
        <div className="flex flex-col gap-1 md:col-span-2">
          <label htmlFor="pr-memo" className="text-xs font-medium text-text-secondary">Note</label>
          <input id="pr-memo" value={memo} onChange={(e) => setMemo(e.target.value)} className={inputClass} />
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <span className="text-sm font-semibold text-text-primary">Which bills?</span>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-text-muted">
              Supplier
              <select aria-label="Filter by supplier" value={supplierFilter} onChange={(e) => setSupplierFilter(e.target.value)} className={inputClass}>
                <option value="">All suppliers</option>
                {suppliers.contacts.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
              </select>
            </label>
            <label className="flex items-center gap-1.5 text-xs text-text-muted">
              Due on or before
              <input type="date" aria-label="Due on or before" value={dueBy} onChange={(e) => setDueBy(e.target.value)} className={inputClass} />
            </label>
          </div>
        </div>
        {!bankId ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-[13px] text-text-muted">Choose the bank account first. A run pays bills in that account’s currency.</p>
        ) : bills.isLoading ? (
          <LoadingLine what="open bills" />
        ) : bills.error ? (
          <ErrorLine error={bills.error} onRetry={bills.refetch} />
        ) : candidates.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface p-4 text-[13px] text-text-muted" data-testid="no-open-bills">No posted bills are waiting to be paid{supplierFilter || dueBy ? ' with these filters' : ''}.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-border bg-surface">
            <table className="w-full text-left text-xs" data-testid="run-bills">
              <thead>
                <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  <th className="px-3 py-2">Bill</th>
                  <th className="px-3 py-2">Supplier</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2 text-right">Total</th>
                  <th className="px-3 py-2 text-right">To pay</th>
                  <th className="w-56 px-3 py-2 text-right">Pay now ({currency})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {candidates.map((d) => {
                  const fits = d.currency === currency;
                  const whole = openOf(d);
                  return (
                    <tr key={d.id} className={cn(!fits && 'opacity-60')}>
                      <td className="px-3 py-2 font-semibold text-text-primary">{d.number}</td>
                      <td className="px-3 py-2 text-text-secondary">{suppliers.byId.get(d.contact_id)?.name ?? '—'}</td>
                      <td className="px-3 py-2 tabular-nums text-text-muted">{d.due_date ? formatDate(d.due_date) : '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(d.total_fc, d.currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatMoney(d.amount_due_fc, d.currency)}</td>
                      <td className="px-3 py-2">
                        {fits ? (
                          <div className="flex items-center justify-end gap-2">
                            {whole != null && (
                              <button type="button" aria-label={`Pay ${d.number} in full`} onClick={() => wholeBill(d.id, whole)} className="rounded border border-border px-2 py-1 text-[11px] hover:bg-surface-neutral">Full</button>
                            )}
                            <div className="w-32">
                              <MoneyInput value={pay[d.id] ?? 0} onChange={(v) => setPay((p) => ({ ...p, [d.id]: v }))} currency={currency} allowNegative={false} size="sm" />
                            </div>
                          </div>
                        ) : (
                          <span className="block text-right text-text-muted">In {d.currency}; this run is in {currency}</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {fieldErrors.items && <span className="text-[11px] text-danger">{fieldErrors.items}</span>}
        <div className="flex flex-wrap items-center justify-end gap-2 pt-1 text-xs text-text-secondary">
          <span>Bills chosen: <span className="tabular-nums text-text-primary">{chosen}</span></span>
          <span className="text-text-muted">·</span>
          <span>To be paid (as typed) <span className="tabular-nums text-text-primary" data-testid="typed-total">{formatMoney(typedTotal, currency)}</span></span>
        </div>
      </div>

      {saved && (
        <section aria-label="Totals" data-testid="run-totals" className="ml-auto w-full max-w-sm rounded-lg border border-border bg-surface p-4 text-[13px]">
          <h3 className="mb-2 text-xs font-semibold text-text-muted">{dirty ? 'Totals as last saved' : 'Totals'}</h3>
          <dl className="flex flex-col gap-1.5">
            <div className="flex justify-between"><dt className="text-text-secondary">Bills settled</dt><dd className="tabular-nums" data-testid="run-gross">{formatMoney(saved.total_gross, saved.currency)}</dd></div>
            <div className="flex justify-between"><dt className="text-text-secondary">Tax withheld already</dt><dd className="tabular-nums" data-testid="run-wht">{formatMoney(saved.total_wht, saved.currency)}</dd></div>
            <div className="flex justify-between border-t border-border pt-1.5 font-semibold"><dt>Cash paid out</dt><dd className="tabular-nums" data-testid="run-net">{formatMoney(saved.total_net, saved.currency)}</dd></div>
            {saved.currency !== base && <div className="flex justify-between text-text-muted"><dt>In {base}</dt><dd className="tabular-nums">{formatMoney(saved.total, base)}</dd></div>}
          </dl>
          <p className="mt-2 text-[11px] text-text-muted">Tax is held back when a bill posts, so the cash paid is already net of it.</p>
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
                {preview.lines.map((pl, i) => (
                  <tr key={i}>
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
              {preview.violations.map((v, i) => (<li key={i}>{describePurchaseViolation(v)}</li>))}
            </ul>
          )}
        </section>
      )}

      <Dialog open={reviewOpen} onOpenChange={setReviewOpen}>
        <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader className="gap-1.5 border-b border-border pb-2">
            <DialogTitle className="text-base font-semibold text-text-primary">Submit this payment run</DialogTitle>
            <DialogDescription className="text-xs text-text-muted">If your company has an approval rule it goes to an approver. Otherwise it posts now, one payment per supplier, and asks for your PIN.</DialogDescription>
          </DialogHeader>
          {saved && (
            <div className="flex flex-col gap-2 text-xs text-text-secondary" data-testid="submit-review">
              <div className="flex justify-between"><span>Bills</span><span className="tabular-nums text-text-primary">{saved.items.length}</span></div>
              <div className="flex justify-between"><span>Cash paid out</span><span className="tabular-nums text-text-primary">{formatMoney(saved.total_net, saved.currency)}</span></div>
            </div>
          )}
          <DialogFooter className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setReviewOpen(false)} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral">Cancel</button>
            <button type="button" onClick={() => void confirmSubmit()} className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover">Submit run</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SignDialog
        {...signProps}
        documentTitle={`Payment run${saved?.number ? ` ${saved.number}` : ''}`}
        amount={saved?.total}
        currency={base}
        periodName={preview?.period?.name ?? undefined}
        actionTitle="Sign and post"
        consequenceText="Nobody else needs to approve this run under your company rules, so it posts now: one payment per supplier, with the next numbers. Mistakes are fixed later by reversing a payment."
      />
      <ConflictDialog conflict={conflict} />
    </div>
  );
};

export const PaymentRunFormLive: React.FC = () => {
  const [params] = useSearchParams();
  return <RunFormInner key={params.get('draft') ?? 'new'} />;
};
