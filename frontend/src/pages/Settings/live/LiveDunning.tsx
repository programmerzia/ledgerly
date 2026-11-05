/** Settings → General → Overdue invoice reminders (3c.7): off by default; stages in days after the due date; what is due tomorrow. */
import React, { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { IntentSlot } from '@/api/intentSlot';
import { describeError } from '@/api/messages';
import type { DunningSettings } from '@/api/live/dunning';
import { MAX_STAGES, blankStage, describeStageDays, toDunningForm, toDunningRequest, type DunningForm } from '@/api/adapters/dunning';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { Field, FormError, LoadError, Loading, field, primary, secondary } from '@/components/live/form';
import { dunningKey, useDunning, useDunningPreview, useSaveDunning } from '@/data/dunning';
import { formatMoney } from '@/lib/format';
import { useQueryClient } from '@tanstack/react-query';
import { SettingsCard } from '../settings-ui';

const area = `${field} h-auto py-2 leading-relaxed`;

export const LiveDunning: React.FC<{ companyId: string }> = ({ companyId }) => {
  const query = useDunning(companyId);
  if (query.isPending) return <Loading what="Loading reminder settings" />;
  if (query.isError) return <LoadError error={query.error} onRetry={() => void query.refetch()} />;
  return <DunningCard key={query.data.version} settings={query.data} companyId={companyId} />;
};

const DunningCard: React.FC<{ settings: DunningSettings; companyId: string }> = ({ settings, companyId }) => {
  const save = useSaveDunning(companyId);
  const qc = useQueryClient();
  const slot = useRef(new IntentSlot()).current;
  const { co } = useParams();
  const [form, setForm] = useState<DunningForm>(() => toDunningForm(settings));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const canEdit = settings.can.update;
  const preview = useDunningPreview(companyId, settings.enabled);
  const allowed = Object.keys(settings.placeholders);
  const dirty = JSON.stringify(form) !== JSON.stringify(toDunningForm(settings));

  const setStage = (i: number, patch: Partial<DunningForm['stages'][number]>) => setForm({ ...form, stages: form.stages.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const built = toDunningRequest(form, settings.version, allowed);
    if (!built.ok) return setErrors(built.errors);
    setErrors({});
    setServerError(null);
    try {
      await save.mutateAsync({ body: built.body, intent: slot.for(JSON.stringify(built.body)) });
      slot.clear();
      toast.success('Reminder settings saved.');
    } catch (err) {
      if (err instanceof ApiError && err.isVersionConflict) {
        setConflict({
          noun: 'reminder settings', serverVersion: err.serverVersion, localVersion: settings.version, onClose: () => setConflict(null),
          onReload: () => { setConflict(null); void qc.invalidateQueries({ queryKey: dunningKey(companyId) }); },
        });
      } else setServerError(err);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-5" aria-label="Overdue invoice reminders">
      <SettingsCard
        title="Overdue invoice reminders"
        description="Email customers a reminder, with the invoice attached, when an invoice stays unpaid after its due date. Off until you switch it on. Only posted invoices with a balance are chased, never one that is paid, voided or reversed, and never a customer you have opted out."
      >
        <label className="flex items-center gap-2 text-[13px] font-medium text-text-primary">
          <input type="checkbox" checked={form.enabled} disabled={!canEdit} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
          Send overdue reminders
        </label>
        {errors.stages && <p role="alert" className="mt-2 text-xs text-danger">{errors.stages}</p>}

        <div className="mt-4 flex flex-col gap-5">
          {form.stages.map((s, i) => (
            <fieldset key={s.id ?? `new-${i}`} className="flex flex-col gap-2 rounded-md border border-border p-3" data-stage={i}>
              <legend className="px-1 text-[13px] font-semibold text-text-primary">Stage {i + 1}</legend>
              <div className="flex items-end gap-3">
                <Field id={`dn-${i}-days`} label="Send after (days past due)" error={errors[`days${i}`]}>
                  <input id={`dn-${i}-days`} className={`${field} w-24 text-right tabular-nums`} inputMode="numeric" value={s.days} disabled={!canEdit} onChange={(e) => setStage(i, { days: e.target.value })} />
                </Field>
                {canEdit && (
                  <button type="button" className="mb-2 text-xs text-text-muted hover:text-danger disabled:cursor-not-allowed disabled:opacity-50" disabled={s.sentCount > 0} title={s.sentCount > 0 ? 'Already used for invoices, so it stays. Change its wording instead.' : undefined} onClick={() => setForm({ ...form, stages: form.stages.filter((_, j) => j !== i) })}>
                    Remove stage
                  </button>
                )}
                {s.sentCount > 0 && <span className="mb-2 text-xs text-text-muted">Sent for {s.sentCount} invoice{s.sentCount === 1 ? '' : 's'}</span>}
              </div>
              <Field id={`dn-${i}-subject`} label="Subject">
                <input id={`dn-${i}-subject`} className={field} value={s.subject} disabled={!canEdit} maxLength={200} onChange={(e) => setStage(i, { subject: e.target.value })} />
              </Field>
              <Field id={`dn-${i}-body`} label="Message" error={errors[`text${i}`]}>
                <textarea id={`dn-${i}-body`} rows={7} className={area} value={s.body} disabled={!canEdit} maxLength={5000} onChange={(e) => setStage(i, { body: e.target.value })} />
              </Field>
            </fieldset>
          ))}
          {canEdit && form.stages.length < MAX_STAGES && (
            <button type="button" className="self-start text-[13px] text-accent hover:underline cursor-pointer" onClick={() => setForm({ ...form, stages: [...form.stages, blankStage(nextDays(form))] })}>
              Add a stage
            </button>
          )}
          <div className="rounded-md bg-surface-neutral p-3 text-xs text-text-secondary">
            <p className="mb-1.5 font-medium text-text-primary">Placeholders you can use</p>
            <ul className="grid gap-x-6 gap-y-1 md:grid-cols-2">
              {Object.entries(settings.placeholders).map(([name, what]) => <li key={name}><code className="rounded bg-surface px-1 py-0.5 text-text-primary">{`{{ ${name} }}`}</code> {String(what)}</li>)}
            </ul>
            <p className="mt-2">Dates follow the company&apos;s own timezone. A stage is sent on its day, or up to three days late if a run was missed; older stages are never sent afterwards.</p>
          </div>
        </div>

        <FormError error={serverError} />
        {canEdit ? (
          <div className="mt-4 flex gap-2">
            <button type="submit" className={primary} disabled={!dirty || save.isPending}>{save.isPending ? 'Saving…' : 'Save reminders'}</button>
            <button type="button" className={secondary} disabled={!dirty || save.isPending} onClick={() => { setForm(toDunningForm(settings)); setErrors({}); setServerError(null); }}>Discard</button>
          </div>
        ) : (
          <p className="mt-4 text-[13px] text-text-muted">You can read these settings but not change them.</p>
        )}
      </SettingsCard>

      {settings.enabled && (
        <SettingsCard title="Due tomorrow" description="What the next run would send, by the company's calendar. A customer with no email address is flagged and skipped.">
          {preview.isPending && <p role="status" className="text-[13px] text-text-muted">Loading…</p>}
          {preview.isError && <p role="alert" className="text-[13px] text-danger">{describeError(preview.error)}</p>}
          {preview.data && preview.data.rows.length === 0 && <p className="text-[13px] text-text-muted" data-testid="dunning-none">Nothing is due on {preview.data.date}.</p>}
          {preview.data && preview.data.rows.length > 0 && (
            <table className="w-full text-[13px]" data-testid="dunning-preview">
              <thead className="text-left text-xs text-text-muted"><tr><th className="py-1 pr-3 font-medium">Invoice</th><th className="py-1 pr-3 font-medium">Customer</th><th className="py-1 pr-3 font-medium">Stage</th><th className="py-1 pr-3 text-right font-medium">Balance</th><th className="py-1 font-medium">Goes to</th></tr></thead>
              <tbody>
                {preview.data.rows.map((r) => (
                  <tr key={r.invoice_id} className="border-t border-border">
                    <td className="py-1.5 pr-3"><Link className="text-accent hover:underline" to={`/${co}/invoices/${r.invoice_id}`}>{r.number ?? 'Invoice'}</Link></td>
                    <td className="py-1.5 pr-3">{r.contact_name}</td>
                    <td className="py-1.5 pr-3">{describeStageDays(r.stage_days)} ({r.days_overdue} overdue)</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{formatMoney(r.amount_due.amount, r.amount_due.currency)}</td>
                    <td className="py-1.5">{r.will_send ? r.email : <span className="font-medium text-warning">No email address, will be skipped</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SettingsCard>
      )}
      <ConflictDialog conflict={conflict} />
    </form>
  );
};

/** A sensible next stage: a week after the last one, or 7 for the first. */
const nextDays = (f: DunningForm): number => {
  const last = Math.max(0, ...f.stages.map((s) => (/^\d+$/.test(s.days) ? Number(s.days) : 0)));
  return Math.min(365, last + 7);
};
