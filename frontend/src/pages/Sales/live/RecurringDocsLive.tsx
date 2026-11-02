import React, { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Pause, Play, Plus } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatDate, formatMoney } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useDocList, useDoc } from '@/data/invoices';
import { useContactDirectory } from '@/data/contacts';
import { useRecurringDocActions, useRecurringDocs } from '@/data/recurringDocs';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import { IntentSlot } from '@/api/intentSlot';
import { localDateISO } from '@/api/adapters/onboarding';
import { toScheduleRequest, type RecurringDoc, type ScheduleDraft } from '@/api/adapters/recurring';
import { BTN_ACCENT, BTN_GHOST, ErrorLine, LoadingLine, inputClass, tradeVerdictText } from './parts';
import { SIDES, type Side } from './side';

const FREQUENCY = { monthly: 'Monthly', quarterly: 'Every quarter', annual: 'Every year' } as const;

const Field: React.FC<{ id: string; label: string; error?: string; hint?: string; children: React.ReactNode }> = ({ id, label, error, hint, children }) => (
  <div className="flex flex-col gap-1">
    <label htmlFor={id} className="text-xs font-medium text-text-secondary">{label}</label>
    {children}
    {hint && !error && <span className="text-[11px] text-text-muted">{hint}</span>}
    {error && <span className="text-[11px] text-danger">{error}</span>}
  </div>
);

const ScheduleDialog: React.FC<{ side: Side; schedule?: RecurringDoc; onClose: () => void; onConflict: (c: VersionConflict | null) => void }> = ({ side, schedule, onClose, onConflict }) => {
  const S = SIDES[side];
  const actions = useRecurringDocActions();
  const contacts = useContactDirectory(S.contactKind, true);
  const templates = useDocList({ kind: S.mainKind, status: 'posted' }, S.resource);
  const [draft, setDraft] = useState<ScheduleDraft>(() => ({
    name: schedule?.name ?? '',
    template_id: schedule?.template_id ?? '',
    frequency: schedule?.frequency ?? 'monthly',
    next_date: schedule?.next_date ?? localDateISO(),
    end_date: schedule?.end_date ?? '',
  }));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [busy, setBusy] = useState(false);
  const slot = useRef(new IntentSlot()).current;
  const set = <K extends keyof ScheduleDraft>(k: K, v: ScheduleDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  async function save(version?: number) {
    setErrors({});
    setBanner('');
    const local: Record<string, string> = {};
    if (!draft.name.trim()) local.name = 'Give the schedule a name.';
    if (!draft.template_id) local.template_id = `Choose the ${S.main} to copy.`;
    if (!draft.next_date) local.next_date = 'Choose the first date.';
    if (Object.keys(local).length) return setErrors(local);
    const body = toScheduleRequest(draft, schedule ? (version ?? schedule.version) : undefined);
    const intent = slot.for(JSON.stringify([schedule?.id ?? null, body]));
    setBusy(true);
    try {
      if (schedule) await actions.update(schedule.id, body, intent);
      else await actions.create(body, intent);
      slot.clear();
      toast.success(schedule ? 'Schedule saved' : 'Schedule created. It makes a draft on each date; nothing posts by itself.');
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.isVersionConflict && schedule) {
        const sv = e.serverVersion;
        onConflict({
          noun: 'schedule',
          serverVersion: sv,
          localVersion: schedule.version,
          onClose: () => onConflict(null),
          onReload: () => { onConflict(null); onClose(); toast.message('Closed without saving. Open the schedule again to see the latest.'); },
          onOverwrite: typeof sv === 'number' ? () => { onConflict(null); void save(sv); } : undefined,
        });
      } else if (e instanceof ApiError && e.isValidation) {
        setErrors(Object.fromEntries(Object.entries(e.errors ?? {}).map(([k, v]) => [k, v[0] ?? ''])));
        setBanner(Object.keys(e.errors ?? {}).length ? '' : describeError(e));
      } else setBanner(tradeVerdictText(e, side === 'purchases'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-text-primary">{schedule ? `Edit ${schedule.name}` : `New recurring ${S.main}`}</DialogTitle>
          <DialogDescription className="text-xs text-text-muted">Each date makes a draft copy of a posted {S.main}. You check it and submit it yourself.</DialogDescription>
        </DialogHeader>
        <form className="grid grid-cols-2 gap-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div className="col-span-2">
            <Field id="rc-name" label="Name" error={errors.name}>
              <input id="rc-name" value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder={side === 'sales' ? 'e.g. Monthly retainer' : 'e.g. Office rent'} className={inputClass} autoFocus />
            </Field>
          </div>
          <div className="col-span-2">
            <Field id="rc-template" label={`${S.Main} to copy`} error={errors.template_id} hint={schedule ? 'The copied document cannot be swapped. Make a new schedule for a different one.' : `Only posted ${S.mains} can be copied.`}>
              <select id="rc-template" value={draft.template_id} onChange={(e) => set('template_id', e.target.value)} disabled={Boolean(schedule)} className={inputClass}>
                <option value="">Choose a {S.main}</option>
                {templates.rows.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.number} · {contacts.byId.get(d.contact_id)?.name ?? S.Contact} · {formatMoney(d.total_fc, d.currency)}
                  </option>
                ))}
                {draft.template_id && !templates.rows.some((d) => d.id === draft.template_id) && <option value={draft.template_id}>The {S.main} it copies</option>}
              </select>
            </Field>
          </div>
          <Field id="rc-freq" label="Repeats" error={errors.frequency}>
            <select id="rc-freq" value={draft.frequency} onChange={(e) => set('frequency', e.target.value as ScheduleDraft['frequency'])} className={inputClass}>
              {(Object.keys(FREQUENCY) as Array<keyof typeof FREQUENCY>).map((f) => (<option key={f} value={f}>{FREQUENCY[f]}</option>))}
            </select>
          </Field>
          <Field id="rc-next" label="Next draft on" error={errors.next_date}>
            <input id="rc-next" type="date" value={draft.next_date} onChange={(e) => set('next_date', e.target.value)} className={inputClass} />
          </Field>
          <Field id="rc-end" label="Stops after (optional)" error={errors.end_date}>
            <input id="rc-end" type="date" value={draft.end_date} onChange={(e) => set('end_date', e.target.value)} className={inputClass} />
          </Field>
          {banner && <p role="alert" className="col-span-2 text-xs font-medium text-danger">{banner}</p>}
          <DialogFooter className="col-span-2 mt-1 flex justify-end gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral">Cancel</button>
            <button type="submit" disabled={busy} className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50">{busy ? 'Saving…' : schedule ? 'Save changes' : 'Create schedule'}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

const TemplateLink: React.FC<{ side: Side; id: string; coSlug: string }> = ({ side, id, coSlug }) => {
  const S = SIDES[side];
  const d = useDoc(id, S.resource);
  return (
    <Link to={`/${coSlug}/${S.docsPath}/${id}`} className="text-xs text-accent hover:underline">
      {d.data?.number ? `View ${d.data.number}, the ${S.main} it copies` : `View the ${S.main} it copies`}
    </Link>
  );
};

/** Schedules that copy a posted invoice (or bill) on a date. They only ever make drafts. */
export const RecurringDocsLive: React.FC<{ side?: Side }> = ({ side = 'sales' }) => {
  const S = SIDES[side];
  const navigate = useNavigate();
  const company = useRouteCompany();
  const coSlug = company.slug;
  const list = useRecurringDocs(side === 'sales' ? 'invoice' : 'bill');
  const actions = useRecurringDocActions();
  const [dialog, setDialog] = useState<null | { schedule?: RecurringDoc }>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const slots = useRef(new Map<string, IntentSlot>());
  const slot = (k: string) => {
    let s = slots.current.get(k);
    if (!s) slots.current.set(k, (s = new IntentSlot()));
    return s;
  };

  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.isVersionConflict) {
      setConflict({ noun: 'schedule', serverVersion: e.serverVersion, onClose: () => setConflict(null), onReload: () => { setConflict(null); list.refetch(); } });
      return;
    }
    toast.error(tradeVerdictText(e, side === 'purchases'));
  };

  const toggle = async (s: RecurringDoc) => {
    setBusy(s.id);
    const sl = slot(`toggle-${s.id}`);
    try {
      await actions.toggle(s, sl.for(`${s.id}:${s.version}:${s.is_active}`));
      sl.clear();
      toast.success(s.is_active ? 'Paused. No drafts are made until you resume it.' : 'Resumed');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const runNow = async (scheduleId?: string) => {
    const key = scheduleId ? `run-${scheduleId}` : 'run';
    setBusy(key);
    const sl = slot(key);
    try {
      const r = await actions.runNow(sl.for(key), scheduleId);
      sl.clear();
      const mine = r.created.filter((c) => c.document_type === (side === 'sales' ? 'invoice' : 'bill')).length;
      const others = r.created.length - mine;
      const made = r.created.length;
      toast.success(made === 0 ? 'Nothing is due yet.' : `Made ${mine} draft ${mine === 1 ? S.main : S.mains}${others ? ` and ${others} other draft${others === 1 ? '' : 's'}` : ''}.${r.failures.length ? ` ${r.failures.length} could not be made.` : ''}`, {
        action: made ? { label: `View ${S.mains}`, onClick: () => navigate(`/${coSlug}/${S.docsPath}`) } : undefined,
      });
      if (r.failures.length) toast.error(r.failures.join(' '));
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={`Recurring ${S.mains}`}
        subtitle={`Set up a ${S.main} you raise on a schedule. Each date makes a draft; nothing posts by itself.`}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void runNow()} disabled={busy === 'run'} className={BTN_GHOST}>
              {busy === 'run' ? 'Making drafts…' : 'Make all due drafts'}
            </button>
            <button type="button" onClick={() => setDialog({})} className={BTN_ACCENT}>
              <Plus className="size-4" /> New recurring {S.main}
            </button>
          </div>
        }
      />

      {list.isLoading ? (
        <LoadingLine what={`recurring ${S.mains}`} />
      ) : list.error ? (
        <ErrorLine error={list.error} onRetry={list.refetch} />
      ) : list.rows.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-border bg-surface px-6 py-14 text-center">
          <h3 className="text-sm font-semibold text-text-primary">No recurring {S.mains} yet</h3>
          <p className="mt-1 max-w-sm text-[13px] text-text-muted">Pick a posted {S.main} to copy on a schedule, such as rent or a monthly retainer.</p>
          <button type="button" onClick={() => setDialog({})} className="mt-4 h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover">New recurring {S.main}</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="recurring-docs">
          {list.rows.map((s) => (
            <div key={s.id} data-schedule={s.name} className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-surface p-5">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="rounded-[3px] bg-surface-neutral px-1.5 py-px text-xs font-medium text-text-secondary">{FREQUENCY[s.frequency]}</span>
                  <span className={cn('rounded-[3px] px-1.5 py-px text-xs font-medium', s.is_active ? 'bg-success-soft text-success' : 'bg-surface-neutral text-text-muted')} data-testid="schedule-state">{s.is_active ? 'Active' : 'Paused'}</span>
                </div>
                <h3 className="text-sm font-semibold text-text-primary">{s.name}</h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <dt className="text-text-muted">Next draft</dt>
                  <dd className="text-right tabular-nums text-text-primary">{s.next_date ? formatDate(s.next_date) : '—'}</dd>
                  <dt className="text-text-muted">Last run</dt>
                  <dd className="text-right tabular-nums text-text-primary">{s.last_run_on ? formatDate(s.last_run_on) : 'Never'}</dd>
                  <dt className="text-text-muted">Drafts made</dt>
                  <dd className="text-right tabular-nums text-text-primary" data-testid="generated-count">{s.generated_count}</dd>
                  {s.end_date && (
                    <>
                      <dt className="text-text-muted">Stops after</dt>
                      <dd className="text-right tabular-nums text-text-primary">{formatDate(s.end_date)}</dd>
                    </>
                  )}
                </dl>
                {s.last_error && <p className="text-xs text-warning">Last problem: {s.last_error}</p>}
              </div>
              <div className="flex flex-col gap-3 border-t border-border pt-3">
                {s.template_id && <TemplateLink side={side} id={s.template_id} coSlug={coSlug} />}
                <div className="flex flex-wrap items-center gap-2">
                  {s.can.update && <button type="button" onClick={() => setDialog({ schedule: s })} className={BTN_GHOST}>Edit</button>}
                  {s.is_active && (
                    <button type="button" onClick={() => void runNow(s.id)} disabled={busy === `run-${s.id}`} className={BTN_GHOST}>
                      {busy === `run-${s.id}` ? 'Making…' : 'Make due draft'}
                    </button>
                  )}
                  {(s.is_active ? s.can.pause : s.can.resume) && (
                    <button type="button" onClick={() => void toggle(s)} disabled={busy === s.id} className={BTN_GHOST}>
                      {s.is_active ? <Pause className="size-3.5 text-text-muted" /> : <Play className="size-3.5 text-text-muted" />}
                      {s.is_active ? 'Pause' : 'Resume'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {dialog && <ScheduleDialog side={side} schedule={dialog.schedule} onClose={() => setDialog(null)} onConflict={setConflict} />}
      <ConflictDialog conflict={conflict} />
    </div>
  );
};
