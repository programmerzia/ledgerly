import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Plus, Trash2, ArrowUp, ArrowDown } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatDate } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useAccounts } from '@/data/accounts';
import { useAllTaxCodes, useTaxActions, useTaxGroups } from '@/data/tax';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import { IntentSlot } from '@/api/intentSlot';
import { TAX_KIND_LABEL, fractionToPercent, percentToFraction, toGroupRequest, toRateRequest, toTaxCodeReplace, type LiveTaxCode, type LiveTaxGroup } from '@/api/adapters/tax';
import { localDateISO } from '@/api/adapters/onboarding';
import { BTN_ACCENT, BTN_GHOST, ErrorLine, LoadingLine, TableCard, inputClass } from '@/pages/Sales/live/parts';

const KINDS = ['vat', 'gst', 'sales', 'wht', 'compound', 'exempt', 'zero', 'reverse_charge'] as const;
const NO_RATE_KINDS = new Set(['exempt', 'zero']);
const CANCEL = 'h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral';
const SAVE = 'h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50';

const Field: React.FC<{ id: string; label: string; hint?: string; error?: string; children: React.ReactNode }> = ({ id, label, hint, error, children }) => (
  <div className="flex flex-col gap-1">
    <label htmlFor={id} className="text-xs font-medium text-text-secondary">{label}</label>
    {children}
    {hint && !error && <span className="text-[11px] text-text-muted">{hint}</span>}
    {error && <span className="text-[11px] text-danger">{error}</span>}
  </div>
);

/** Turns what a write refused into field messages and a banner. */
function problemsOf(e: unknown): { fields: Record<string, string>; banner: string } {
  if (e instanceof ApiError && e.isValidation && e.errors) return { fields: Object.fromEntries(Object.entries(e.errors).map(([k, v]) => [k, v[0] ?? ''])), banner: Object.keys(e.errors).length ? '' : describeError(e) };
  if (e instanceof ApiError && e.violations?.length) {
    const v = e.violations[0];
    if (v.code === 'tax_code_taken') return { fields: { code: 'That code is already used in this company.' }, banner: '' };
    return { fields: {}, banner: e.violations.map((x) => x.message).join(' ') || describeError(e) };
  }
  return { fields: {}, banner: describeError(e) };
}

/* ----------------------------------------------------------------- tax code dialog */

const CodeDialog: React.FC<{ code?: LiveTaxCode; onClose: () => void; onConflict: (c: VersionConflict | null) => void }> = ({ code, onClose, onConflict }) => {
  const accounts = useAccounts();
  const actions = useTaxActions();
  const [form, setForm] = useState({
    code: code?.code ?? '',
    name: code?.name ?? '',
    kind: code?.kind ?? 'vat',
    percent: '',
    from: localDateISO(),
    recoverable: code?.is_recoverable ?? true,
    collect: code?.collect_account_id ?? '',
    pay: code?.pay_account_id ?? '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [busy, setBusy] = useState(false);
  const slot = useRef(new IntentSlot()).current;
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const postable = accounts.data.filter((a) => a.is_active && a.is_postable);

  async function save(version?: number) {
    setErrors({});
    setBanner('');
    const local: Record<string, string> = {};
    if (!code && !/^[A-Za-z0-9._-]{1,32}$/.test(form.code)) local.code = 'Use letters, numbers, dots, dashes or underscores (up to 32).';
    if (!form.name.trim()) local.name = 'Give the tax code a name.';
    const rate = NO_RATE_KINDS.has(form.kind) ? '0' : percentToFraction(form.percent);
    if (!code && rate === null) local.percent = 'Enter a rate between 0 and 100, for example 5 or 7.5.';
    if (Object.keys(local).length) return setErrors(local);

    const edit = { name: form.name, kind: form.kind, collect_account_id: form.collect, pay_account_id: form.pay, is_recoverable: form.recoverable };
    const body: Record<string, unknown> = code
      ? toTaxCodeReplace(edit, version ?? code.version)
      : { code: form.code.trim(), name: form.name.trim(), kind: form.kind, collect_account_id: form.collect || null, pay_account_id: form.pay || null, is_recoverable: form.recoverable, rate, effective_from: form.from };
    const intent = slot.for(JSON.stringify([code?.id ?? null, body]));
    setBusy(true);
    try {
      if (code) await actions.updateCode(code.id, body, intent);
      else await actions.createCode(body, intent);
      slot.clear();
      toast.success(code ? 'Tax code saved' : `Tax code ${form.code.trim()} created`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.isVersionConflict && code) {
        const sv = e.serverVersion;
        onConflict({
          noun: 'tax code',
          serverVersion: sv,
          localVersion: code.version,
          onClose: () => onConflict(null),
          onReload: () => { onConflict(null); onClose(); toast.message('Closed without saving. Open the tax code again to see the latest.'); },
          onOverwrite: typeof sv === 'number' ? () => { onConflict(null); void save(sv); } : undefined,
        });
      } else {
        const p = problemsOf(e);
        setErrors(p.fields);
        setBanner(p.banner);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-xl rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-text-primary">{code ? `Edit ${code.code}` : 'New tax code'}</DialogTitle>
          <DialogDescription className="text-xs text-text-muted">{code ? 'The code and its rates stay as they are. Add a new rate from a date to change what is charged.' : 'The rate starts on the date you give. Add later rates from the list.'}</DialogDescription>
        </DialogHeader>
        <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Field id="tc-code" label="Code" error={errors.code}>
            <input id="tc-code" value={form.code} onChange={(e) => set('code', e.target.value)} disabled={Boolean(code)} placeholder="e.g. VAT10" className={inputClass} autoFocus={!code} />
          </Field>
          <Field id="tc-name" label="Name" error={errors.name}>
            <input id="tc-name" value={form.name} onChange={(e) => set('name', e.target.value)} className={inputClass} autoFocus={Boolean(code)} />
          </Field>
          <Field id="tc-kind" label="Kind" error={errors.kind}>
            <select id="tc-kind" value={form.kind} onChange={(e) => set('kind', e.target.value)} className={inputClass}>
              {KINDS.map((k) => (<option key={k} value={k}>{TAX_KIND_LABEL[k]}</option>))}
            </select>
          </Field>
          {!code && (
            <Field id="tc-percent" label="Rate (%)" error={errors.percent ?? errors.rate} hint={NO_RATE_KINDS.has(form.kind) ? 'Exempt and zero-rated codes carry a rate of 0.' : undefined}>
              <input id="tc-percent" inputMode="decimal" value={NO_RATE_KINDS.has(form.kind) ? '0' : form.percent} disabled={NO_RATE_KINDS.has(form.kind)} onChange={(e) => set('percent', e.target.value)} placeholder="e.g. 7.5" className={inputClass} />
            </Field>
          )}
          {!code && (
            <Field id="tc-from" label="Rate starts on" error={errors.effective_from}>
              <input id="tc-from" type="date" value={form.from} onChange={(e) => set('from', e.target.value)} className={inputClass} />
            </Field>
          )}
          <Field id="tc-collect" label="Sales tax account" hint="Optional. Left empty, the company’s posting account is used." error={errors.collect_account_id}>
            <select id="tc-collect" value={form.collect} onChange={(e) => set('collect', e.target.value)} className={inputClass}>
              <option value="">Company default</option>
              {postable.map((a) => (<option key={a.id} value={a.id}>{a.code} {a.name}</option>))}
            </select>
          </Field>
          <Field id="tc-pay" label="Purchase tax account" hint="Optional. Left empty, the company’s posting account is used." error={errors.pay_account_id}>
            <select id="tc-pay" value={form.pay} onChange={(e) => set('pay', e.target.value)} className={inputClass}>
              <option value="">Company default</option>
              {postable.map((a) => (<option key={a.id} value={a.id}>{a.code} {a.name}</option>))}
            </select>
          </Field>
          <label className="col-span-2 flex items-start gap-2 text-[13px] text-text-primary">
            <input type="checkbox" checked={form.recoverable} onChange={(e) => set('recoverable', e.target.checked)} className="mt-0.5" />
            <span>
              Tax paid on purchases can be claimed back
              <span className="block text-[11px] text-text-muted">Turn this off and the tax becomes part of the cost of what was bought.</span>
            </span>
          </label>
          {banner && <p role="alert" className="col-span-2 text-xs font-medium text-danger">{banner}</p>}
          <DialogFooter className="col-span-2 mt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={CANCEL}>Cancel</button>
            <button type="submit" disabled={busy} className={SAVE}>{busy ? 'Saving…' : code ? 'Save changes' : 'Create tax code'}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/* ------------------------------------------------------------------- rate dialog */

const RateDialog: React.FC<{ code: LiveTaxCode; onClose: () => void; onConflict: (c: VersionConflict | null) => void }> = ({ code, onClose, onConflict }) => {
  const actions = useTaxActions();
  const [percent, setPercent] = useState('');
  const [from, setFrom] = useState(localDateISO());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [busy, setBusy] = useState(false);
  const slot = useRef(new IntentSlot()).current;

  async function save(version?: number) {
    setErrors({});
    setBanner('');
    const body = toRateRequest(percent, from, version ?? code.version);
    if (!body) return setErrors({ percent: percentToFraction(percent) === null ? 'Enter a rate between 0 and 100, for example 5 or 7.5.' : '', effective_from: from ? '' : 'Choose a date.' });
    const intent = slot.for(JSON.stringify([code.id, body]));
    setBusy(true);
    try {
      await actions.addRate(code.id, body, intent);
      slot.clear();
      toast.success(`New rate for ${code.code} from ${formatDate(from)}`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.isVersionConflict) {
        const sv = e.serverVersion;
        onConflict({
          noun: 'tax code',
          serverVersion: sv,
          localVersion: code.version,
          onClose: () => onConflict(null),
          onReload: () => { onConflict(null); onClose(); toast.message('Closed without saving. Open the tax code again to see the latest.'); },
          onOverwrite: typeof sv === 'number' ? () => { onConflict(null); void save(sv); } : undefined,
        });
      } else {
        const p = problemsOf(e);
        setErrors(p.fields);
        setBanner(e instanceof ApiError && e.violations?.[0]?.code === 'tax_rate_overlap' ? 'These dates overlap a rate this code already has.' : p.banner);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-text-primary">New rate for {code.code}</DialogTitle>
          <DialogDescription className="text-xs text-text-muted">The new rate applies to documents dated from this day. Earlier documents keep the rate they had.</DialogDescription>
        </DialogHeader>
        {code.rates.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-md border border-border bg-surface p-3 text-xs" data-testid="rate-history">
            {code.rates.map((r) => (
              <li key={r.id} className="flex justify-between">
                <span className="tabular-nums text-text-primary">{fractionToPercent(r.rate)}</span>
                <span className="text-text-muted">{r.effective_from ? formatDate(r.effective_from) : '—'}{r.effective_to ? ` to ${formatDate(r.effective_to)}` : ' onwards'}</span>
              </li>
            ))}
          </ul>
        )}
        <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <Field id="rt-percent" label="Rate (%)" error={errors.percent ?? errors.rate}>
            <input id="rt-percent" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value)} placeholder="e.g. 7.5" className={inputClass} autoFocus />
          </Field>
          <Field id="rt-from" label="Starts on" error={errors.effective_from}>
            <input id="rt-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </Field>
          {banner && <p role="alert" className="col-span-2 text-xs font-medium text-danger">{banner}</p>}
          <DialogFooter className="col-span-2 mt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={CANCEL}>Cancel</button>
            <button type="submit" disabled={busy} className={SAVE}>{busy ? 'Saving…' : 'Add rate'}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/* ------------------------------------------------------------------ group dialog */

const GroupDialog: React.FC<{ group?: LiveTaxGroup; codes: LiveTaxCode[]; onClose: () => void; onConflict: (c: VersionConflict | null) => void }> = ({ group, codes, onClose, onConflict }) => {
  const actions = useTaxActions();
  const [code, setCode] = useState(group?.code ?? '');
  const [name, setName] = useState(group?.name ?? '');
  const [items, setItems] = useState<Array<{ tax_code_id: string; compound: boolean }>>(group?.items.map((i) => ({ tax_code_id: i.tax_code_id, compound: i.compound })) ?? [{ tax_code_id: '', compound: false }]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [busy, setBusy] = useState(false);
  const slot = useRef(new IntentSlot()).current;
  const usable = codes.filter((c) => c.is_active || items.some((i) => i.tax_code_id === c.id));
  const move = (i: number, d: -1 | 1) => setItems((p) => { const n = [...p]; const j = i + d; if (j < 0 || j >= n.length) return p; [n[i], n[j]] = [n[j], n[i]]; return n; });

  async function save(version?: number) {
    setErrors({});
    setBanner('');
    const local: Record<string, string> = {};
    if (!group && !/^[A-Za-z0-9._-]{1,32}$/.test(code)) local.code = 'Use letters, numbers, dots, dashes or underscores (up to 32).';
    if (!name.trim()) local.name = 'Give the group a name.';
    if (items.some((i) => !i.tax_code_id)) local.items = 'Choose a tax code for every row, or remove the empty one.';
    if (Object.keys(local).length) return setErrors(local);
    const body = toGroupRequest(code, name, items, group ? (version ?? group.version) : undefined);
    const intent = slot.for(JSON.stringify([group?.id ?? null, body]));
    setBusy(true);
    try {
      if (group) await actions.updateGroup(group.id, body, intent);
      else await actions.createGroup(body, intent);
      slot.clear();
      toast.success(group ? 'Tax group saved' : `Tax group ${code.trim()} created`);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.isVersionConflict && group) {
        const sv = e.serverVersion;
        onConflict({
          noun: 'tax group',
          serverVersion: sv,
          localVersion: group.version,
          onClose: () => onConflict(null),
          onReload: () => { onConflict(null); onClose(); toast.message('Closed without saving. Open the tax group again to see the latest.'); },
          onOverwrite: typeof sv === 'number' ? () => { onConflict(null); void save(sv); } : undefined,
        });
      } else {
        const p = problemsOf(e);
        setErrors(p.fields);
        setBanner(p.banner);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-xl rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-text-primary">{group ? `Edit ${group.code}` : 'New tax group'}</DialogTitle>
          <DialogDescription className="text-xs text-text-muted">A group applies several tax codes to a line in order. Mark a code “on top of the tax before it” when it is charged on the line plus the earlier tax.</DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="grid grid-cols-2 gap-3">
            <Field id="tg-code" label="Code" error={errors.code}>
              <input id="tg-code" value={code} onChange={(e) => setCode(e.target.value)} disabled={Boolean(group)} className={inputClass} autoFocus={!group} />
            </Field>
            <Field id="tg-name" label="Name" error={errors.name}>
              <input id="tg-name" value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
            </Field>
          </div>
          <div className="flex flex-col gap-2" data-testid="group-items">
            {items.map((it, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-5 text-right text-xs tabular-nums text-text-muted">{i + 1}</span>
                <select aria-label={`Tax code, row ${i + 1}`} value={it.tax_code_id} onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, tax_code_id: e.target.value } : x)))} className={cn(inputClass, 'flex-1')}>
                  <option value="">Choose a tax code</option>
                  {usable.map((c) => (<option key={c.id} value={c.id}>{c.code} · {fractionToPercent(c.rate)}</option>))}
                </select>
                <label className="flex items-center gap-1 text-xs text-text-secondary">
                  <input type="checkbox" aria-label={`On top of the tax before it, row ${i + 1}`} checked={it.compound} disabled={i === 0} onChange={(e) => setItems((p) => p.map((x, j) => (j === i ? { ...x, compound: e.target.checked } : x)))} />
                  On top of the tax before it
                </label>
                <button type="button" aria-label={`Move row ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)} className="rounded p-1 text-text-muted hover:bg-surface-neutral disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                <button type="button" aria-label={`Move row ${i + 1} down`} disabled={i === items.length - 1} onClick={() => move(i, 1)} className="rounded p-1 text-text-muted hover:bg-surface-neutral disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                <button type="button" aria-label={`Remove row ${i + 1}`} disabled={items.length === 1} onClick={() => setItems((p) => p.filter((_, j) => j !== i))} className="rounded p-1 text-text-muted hover:bg-surface-neutral hover:text-danger disabled:opacity-30"><Trash2 className="size-3.5" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setItems((p) => [...p, { tax_code_id: '', compound: false }])} className="flex h-8 w-fit items-center gap-1.5 rounded-md border border-dashed border-border px-3 text-[13px] text-text-secondary hover:bg-surface-neutral"><Plus className="size-4" /> Add a tax code</button>
            {errors.items && <span className="text-[11px] text-danger">{errors.items}</span>}
          </div>
          {banner && <p role="alert" className="text-xs font-medium text-danger">{banner}</p>}
          <DialogFooter className="mt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className={CANCEL}>Cancel</button>
            <button type="submit" disabled={busy} className={SAVE}>{busy ? 'Saving…' : group ? 'Save changes' : 'Create tax group'}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/* ------------------------------------------------------------------------ page */

type Tab = 'codes' | 'groups';

/** Tax codes with their dated rates, and tax groups. The tax return itself is under Reports. */
export const TaxLive: React.FC = () => {
  const company = useRouteCompany();
  const coSlug = company.slug;
  const codes = useAllTaxCodes();
  const groups = useTaxGroups();
  const actions = useTaxActions();
  const [tab, setTab] = useState<Tab>('codes');
  const [showInactive, setShowInactive] = useState(false);
  const [dialog, setDialog] = useState<null | { type: 'code'; code?: LiveTaxCode } | { type: 'rate'; code: LiveTaxCode } | { type: 'group'; group?: LiveTaxGroup } | { type: 'off-code'; code: LiveTaxCode } | { type: 'off-group'; group: LiveTaxGroup }>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const slot = useRef(new IntentSlot()).current;

  const codeName = (id: string) => codes.codes.find((c) => c.id === id)?.code ?? '—';
  const visibleCodes = codes.codes.filter((c) => showInactive || c.is_active);
  const visibleGroups = groups.groups.filter((g) => showInactive || g.is_active);

  async function turnOff() {
    if (!dialog || (dialog.type !== 'off-code' && dialog.type !== 'off-group')) return;
    const target = dialog.type === 'off-code' ? dialog.code : dialog.group;
    setBusy(true);
    setProblem('');
    try {
      const intent = slot.for(`${target.id}:${target.version}`);
      if (dialog.type === 'off-code') await actions.deactivateCode(target.id, target.version, intent);
      else await actions.deactivateGroup(target.id, target.version, intent);
      slot.clear();
      toast.success(`${target.code} turned off. Documents already using it are not changed.`);
      setDialog(null);
    } catch (e) {
      if (e instanceof ApiError && e.isVersionConflict) {
        setDialog(null);
        setConflict({ noun: dialog.type === 'off-code' ? 'tax code' : 'tax group', serverVersion: e.serverVersion, localVersion: target.version, onClose: () => setConflict(null), onReload: () => { setConflict(null); codes.refetch(); groups.refetch(); } });
      } else setProblem(problemsOf(e).banner || describeError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Tax"
        subtitle="The tax codes your documents use, with the rate in force on each date. The tax return is built from posted documents."
        actions={
          <div className="flex items-center gap-2">
            <Link to={`/${coSlug}/reports/tax-return`} className={BTN_GHOST}>Open the tax return</Link>
            <button type="button" onClick={() => setDialog(tab === 'codes' ? { type: 'code' } : { type: 'group' })} className={BTN_ACCENT}>
              <Plus className="size-4" /> {tab === 'codes' ? 'New tax code' : 'New tax group'}
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 border-b border-border" role="tablist">
          {([['codes', 'Tax codes'], ['groups', 'Tax groups']] as const).map(([v, label]) => (
            <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={cn('-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors', tab === v ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary')}>
              {label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show turned-off ones
        </label>
      </div>

      {tab === 'codes' && (
        <TableCard>
          {codes.isLoading ? (
            <LoadingLine what="tax codes" />
          ) : codes.error ? (
            <ErrorLine error={codes.error} onRetry={codes.refetch} />
          ) : visibleCodes.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <h3 className="text-sm font-semibold text-text-primary">No tax codes yet</h3>
              <p className="mt-1 max-w-sm text-[13px] text-text-muted">Add the taxes you charge and pay, then pick them on document lines.</p>
              <button type="button" onClick={() => setDialog({ type: 'code' })} className="mt-4 h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover">New tax code</button>
            </div>
          ) : (
            <table className="w-full text-left text-[13px]" data-testid="tax-codes-table">
              <thead>
                <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Kind</th>
                  <th className="px-3 py-2 text-right">Rate today</th>
                  <th className="px-3 py-2">Purchase tax</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleCodes.map((c) => (
                  <tr key={c.id} data-tax-code={c.code} className={cn(!c.is_active && 'text-text-muted')}>
                    <td className="px-3 py-2 font-semibold text-text-primary">
                      {c.code}
                      {!c.is_active && <span className="ml-2 rounded-[3px] bg-surface-neutral px-1.5 py-0.5 text-[11px] font-normal text-text-muted">Off</span>}
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{c.name}</td>
                    <td className="px-3 py-2 text-text-secondary">{TAX_KIND_LABEL[c.kind] ?? c.kind}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-text-primary" data-testid="rate-today">{fractionToPercent(c.rate)}</td>
                    <td className="px-3 py-2 text-text-secondary">{c.kind === 'wht' ? '—' : c.is_recoverable ? 'Claimed back' : 'Added to the cost'}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1.5">
                        {c.can.update && c.is_active && <button type="button" aria-label={`Edit ${c.code}`} onClick={() => setDialog({ type: 'code', code: c })} className={BTN_GHOST}>Edit</button>}
                        {c.can.update && c.is_active && <button type="button" aria-label={`Add a rate to ${c.code}`} onClick={() => setDialog({ type: 'rate', code: c })} className={BTN_GHOST}>New rate</button>}
                        {c.can.deactivate && c.is_active && <button type="button" aria-label={`Turn off ${c.code}`} onClick={() => { setProblem(''); setDialog({ type: 'off-code', code: c }); }} className={cn(BTN_GHOST, 'hover:border-danger/50 hover:text-danger')}>Turn off</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      )}

      {tab === 'groups' && (
        <TableCard>
          {groups.isLoading ? (
            <LoadingLine what="tax groups" />
          ) : groups.error ? (
            <ErrorLine error={groups.error} onRetry={groups.refetch} />
          ) : visibleGroups.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-14 text-center">
              <h3 className="text-sm font-semibold text-text-primary">No tax groups yet</h3>
              <p className="mt-1 max-w-sm text-[13px] text-text-muted">A group puts several codes together, for example a state tax and a city tax.</p>
              <button type="button" onClick={() => setDialog({ type: 'group' })} className="mt-4 h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover">New tax group</button>
            </div>
          ) : (
            <table className="w-full text-left text-[13px]" data-testid="tax-groups-table">
              <thead>
                <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  <th className="px-3 py-2">Code</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Applies, in order</th>
                  <th className="px-3 py-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {visibleGroups.map((g) => (
                  <tr key={g.id} data-tax-group={g.code} className={cn(!g.is_active && 'text-text-muted')}>
                    <td className="px-3 py-2 font-semibold text-text-primary">
                      {g.code}
                      {!g.is_active && <span className="ml-2 rounded-[3px] bg-surface-neutral px-1.5 py-0.5 text-[11px] font-normal text-text-muted">Off</span>}
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{g.name}</td>
                    <td className="px-3 py-2 text-text-secondary">{g.items.map((i) => `${codeName(i.tax_code_id)}${i.compound ? ' (on top)' : ''}`).join(', ')}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1.5">
                        {g.can.update && g.is_active && <button type="button" aria-label={`Edit ${g.code}`} onClick={() => setDialog({ type: 'group', group: g })} className={BTN_GHOST}>Edit</button>}
                        {g.can.deactivate && g.is_active && <button type="button" aria-label={`Turn off ${g.code}`} onClick={() => { setProblem(''); setDialog({ type: 'off-group', group: g }); }} className={cn(BTN_GHOST, 'hover:border-danger/50 hover:text-danger')}>Turn off</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </TableCard>
      )}

      {dialog?.type === 'code' && <CodeDialog code={dialog.code} onClose={() => setDialog(null)} onConflict={setConflict} />}
      {dialog?.type === 'rate' && <RateDialog code={dialog.code} onClose={() => setDialog(null)} onConflict={setConflict} />}
      {dialog?.type === 'group' && <GroupDialog group={dialog.group} codes={codes.codes} onClose={() => setDialog(null)} onConflict={setConflict} />}
      <Dialog open={dialog?.type === 'off-code' || dialog?.type === 'off-group'} onOpenChange={(o) => !o && !busy && setDialog(null)}>
        <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary">Turn off {dialog?.type === 'off-code' ? dialog.code.code : dialog?.type === 'off-group' ? dialog.group.code : ''}?</DialogTitle>
            <DialogDescription className="text-xs text-text-muted">It will no longer be offered on new documents. Documents that already use it stay exactly as they are.</DialogDescription>
          </DialogHeader>
          {problem && <p role="alert" className="text-xs font-medium text-danger">{problem}</p>}
          <DialogFooter className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setDialog(null)} disabled={busy} className={CANCEL}>Keep it on</button>
            <button type="button" disabled={busy} onClick={() => void turnOff()} className="h-8 rounded-md bg-danger px-3 text-[13px] font-medium text-white disabled:opacity-50">Turn off</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConflictDialog conflict={conflict} />
    </div>
  );
};
