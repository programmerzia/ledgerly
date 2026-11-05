/** Settings → Approvals: who has to approve a document before it posts, by document type and amount range. */
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/api/errors';
import { IntentSlot } from '@/api/intentSlot';
import { fieldError } from '@/api/messages';
import type { ApiSettings, ApiWorkflow } from '@/api/live/admin';
import { parseAmountInput } from '@/api/adapters/banking';
import { describeProblem } from '@/api/live/writeProblems';
import {
  minorToInput,
  DOCUMENT_TYPES, SOURCES, blankWorkflow, currencyDigits, describeRange, describeSteps, documentTypeLabel, sourceLabel,
  toWorkflowForm, toWorkflowRequest, type WorkflowForm,
} from '@/api/adapters/admin';
import { isSigningCancelled } from '@/data/signing';
import { useAdminActions, useSettings, useWorkflows } from '@/data/admin';
import { useCurrentCompany, useRoles } from '@/data/team';
import { Field, LoadError, Loading, field, primary, secondary } from '@/components/live/form';
import { SettingsCard } from '../settings-ui';

export const LiveWorkflows: React.FC = () => {
  const company = useCurrentCompany();
  const settings = useSettings(company.id);
  const workflows = useWorkflows(company.id);
  const actions = useAdminActions(company.id);
  const [editing, setEditing] = useState<ApiWorkflow | 'new' | null>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const offSlot = useRef(new IntentSlot()).current;
  const currency = company.base_currency;
  const canEdit = settings.data?.can.update ?? false;

  if (workflows.isPending) return <Loading what="Loading approvals" />;
  if (workflows.isError) {
    return workflows.error instanceof ApiError && workflows.error.status === 403
      ? <SettingsCard title="Approvals"><p role="alert" className="text-[13px] text-text-secondary">You do not have permission to see the approval settings.</p></SettingsCard>
      : <LoadError error={workflows.error} onRetry={() => void workflows.refetch()} />;
  }

  const reload = () => { setConflict(null); void workflows.refetch(); };
  const turnOff = async (w: ApiWorkflow) => {
    setBusyId(w.id);
    try {
      await actions.deactivateWorkflow(w.id, w.version, offSlot.for(`${w.id}:${w.version}`));
      offSlot.clear();
      toast.success(`"${w.name}" is off.`);
    } catch (e) {
      if (e instanceof ApiError && e.isVersionConflict) {
        setConflict({ noun: 'workflow', serverVersion: e.serverVersion, localVersion: w.version, onReload: reload, onClose: reload });
      } else if (!isSigningCancelled(e)) toast.error(describeProblem(e));
    } finally {
      setBusyId(null);
    }
  };

  const active = workflows.data.filter((w) => w.is_active);
  const off = workflows.data.filter((w) => !w.is_active);

  return (
    <div className="flex flex-col gap-5">
      {settings.data && <BankThresholdCard key={settings.data.version} settings={settings.data} currency={currency} canEdit={canEdit} />}
      <SettingsCard
        title="Approval workflows"
        description={`When a document is submitted and its amount (in ${currency}) falls in a workflow's range, it waits for the approvers listed instead of posting at once. The person who submitted it cannot approve it.`}
      >
        {active.length === 0 ? (
          <p className="text-[13px] text-text-muted" data-testid="no-workflows">No approvals are required. Documents post as soon as they are submitted.</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="workflow-list">
            {active.map((w) => (
              <li key={w.id} data-workflow={w.name} className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-text-primary">{w.name}</div>
                  <div className="text-xs text-text-muted">
                    {documentTypeLabel(w.document_type)} · {describeRange(w, currency)} · {sourceLabel(w.source)}
                  </div>
                  <div className="text-xs text-text-secondary">Approved by {describeSteps(w)}</div>
                  {w.remind_after_hours != null && <div className="text-xs text-text-muted">Reminds after {w.remind_after_hours} hour{w.remind_after_hours === 1 ? '' : 's'}</div>}
                </div>
                {w.can.update && (
                  <button type="button" className={`${secondary} h-7 px-2.5 text-xs`} onClick={() => setEditing(w)}>Edit</button>
                )}
                {w.can.deactivate && (
                  <button type="button" disabled={busyId === w.id} className={`${secondary} h-7 px-2.5 text-xs`} onClick={() => void turnOff(w)}>Turn off</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="mt-4 border-t border-border pt-4">
            <button type="button" className={`${primary} h-8 px-3 text-[13px]`} onClick={() => setEditing('new')}>New workflow</button>
          </div>
        )}
      </SettingsCard>

      {off.length > 0 && (
        <SettingsCard title="Turned off" description="Kept for the record. A turned-off workflow no longer applies.">
          <ul className="divide-y divide-border text-[13px] text-text-muted">
            {off.map((w) => <li key={w.id} className="py-2 first:pt-0 last:pb-0">{w.name} · {documentTypeLabel(w.document_type)} · {describeRange(w, currency)}</li>)}
          </ul>
        </SettingsCard>
      )}

      {editing && <WorkflowDialog target={editing} companyId={company.id} currency={currency} onClose={() => setEditing(null)} onConflict={setConflict} reload={reload} />}
      <ConflictDialog conflict={conflict} />
    </div>
  );
};

const WorkflowDialog: React.FC<{
  target: ApiWorkflow | 'new';
  companyId: string;
  currency: string;
  onClose: () => void;
  onConflict: (c: VersionConflict | null) => void;
  reload: () => void;
}> = ({ target, companyId, currency, onClose, onConflict, reload }) => {
  const digits = currencyDigits(currency);
  const roles = useRoles(companyId);
  const actions = useAdminActions(companyId);
  const slot = useRef(new IntentSlot()).current;
  const existing = target === 'new' ? null : target;
  const [form, setForm] = useState<WorkflowForm>(() => (existing ? toWorkflowForm(existing, digits) : blankWorkflow()));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const send = async (version?: number) => {
    const built = toWorkflowRequest(form, digits, existing ? (version ?? existing.version) : undefined);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    setErrors({});
    setServerError(null);
    setBusy(true);
    try {
      const sig = JSON.stringify(built.body);
      if (existing) await actions.updateWorkflow(existing.id, built.body, slot.for(sig));
      else await actions.createWorkflow(built.body, slot.for(sig));
      slot.clear();
      toast.success(existing ? 'Workflow saved.' : 'Workflow added.');
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.isVersionConflict && existing) {
        const server = typeof e.serverVersion === 'number' ? e.serverVersion : undefined;
        onConflict({
          noun: 'workflow', serverVersion: e.serverVersion, localVersion: existing.version,
          onReload: () => { reload(); onClose(); },
          onOverwrite: server === undefined ? undefined : () => { onConflict(null); void send(server); },
          onClose: () => reload(),
        });
      } else if (!isSigningCancelled(e)) setServerError(e);
    } finally {
      setBusy(false);
    }
  };

  const set = (k: keyof WorkflowForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });
  const setStep = (i: number, patch: Partial<WorkflowForm['steps'][number]>) => setForm({ ...form, steps: form.steps.map((s, j) => (j === i ? { ...s, ...patch } : s)) });

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-xl p-6">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit workflow' : 'New workflow'}</DialogTitle>
          <DialogDescription>Documents of this type with an amount in the range wait for these approvers before they post.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); void send(); }} className="flex flex-col gap-4">
          <Field id="wf-name" label="Name" error={errors.name ?? fieldError(serverError, 'name')}>
            <input id="wf-name" className={field} value={form.name} onChange={set('name')} maxLength={255} autoFocus />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field id="wf-type" label="Applies to" error={fieldError(serverError, 'document_type')}>
              <select id="wf-type" className={field} value={form.document_type} onChange={set('document_type')}>
                {DOCUMENT_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </Field>
            <Field id="wf-source" label="Created by" error={fieldError(serverError, 'source')}>
              <select id="wf-source" className={field} value={form.source} onChange={set('source')}>
                {SOURCES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </Field>
            <Field id="wf-min" label={`From amount (${currency})`} hint="Counts itself. 0 means every amount." error={errors.min ?? fieldError(serverError, 'min_amount')}>
              <input id="wf-min" className={`${field} text-right tabular-nums`} inputMode="decimal" value={form.min} onChange={set('min')} />
            </Field>
            <Field id="wf-max" label={`Below amount (${currency})`} hint="Leave empty for no upper limit." error={errors.max ?? fieldError(serverError, 'max_amount')}>
              <input id="wf-max" className={`${field} text-right tabular-nums`} inputMode="decimal" value={form.max} onChange={set('max')} />
            </Field>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-[13px] font-medium text-text-primary">Approvals, in order</legend>
            {form.steps.map((s, i) => (
              <div key={i} className="flex flex-col gap-1" data-step={i}>
                <div className="flex items-center gap-2">
                  <span className="w-12 text-xs text-text-muted">Step {i + 1}</span>
                  <select aria-label={`Role for step ${i + 1}`} className={`${field} flex-1`} value={s.role} onChange={(e) => setStep(i, { role: e.target.value })}>
                    <option value="">Choose a role…</option>
                    {(roles.data ?? []).map((r) => <option key={r.id} value={r.name}>{r.name}</option>)}
                  </select>
                  <input aria-label={`People needed for step ${i + 1}`} className={`${field} w-16 text-right`} inputMode="numeric" value={s.count} onChange={(e) => setStep(i, { count: e.target.value })} />
                  <span className="text-xs text-text-muted">to sign</span>
                  {form.steps.length > 1 && (
                    <button type="button" aria-label={`Remove step ${i + 1}`} className="text-text-muted hover:text-danger cursor-pointer" onClick={() => setForm({ ...form, steps: form.steps.filter((_, j) => j !== i) })}>×</button>
                  )}
                </div>
                {errors[`step${i}`] && <span role="alert" className="pl-14 text-xs text-danger">{errors[`step${i}`]}</span>}
              </div>
            ))}
            {fieldError(serverError, 'steps') && <span role="alert" className="text-xs text-danger">{fieldError(serverError, 'steps')}</span>}
            {form.steps.length < 10 && (
              <button type="button" className="self-start text-[13px] text-accent hover:underline cursor-pointer" onClick={() => setForm({ ...form, steps: [...form.steps, { role: '', count: '1' }] })}>Add a step</button>
            )}
          </fieldset>
          <Field id="wf-remind" label="Remind approvers after (hours)" hint="If a document waits this long on a step, the approvers are reminded in the bell and by email, then again every time this many hours pass. Leave empty for no reminders." error={errors.remind ?? fieldError(serverError, 'remind_after_hours')}>
            <input id="wf-remind" className={`${field} w-28 text-right tabular-nums`} inputMode="numeric" value={form.remind} onChange={set('remind')} />
          </Field>
          {serverError != null && <p role="alert" className="text-[13px] text-danger">{describeProblem(serverError)}</p>}
          <DialogFooter className="gap-2">
            <button type="button" className={secondary} disabled={busy} onClick={onClose}>Cancel</button>
            <button type="submit" className={primary} disabled={busy}>{busy ? 'Saving…' : existing ? 'Save workflow' : 'Add workflow'}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

/** The amount above which recording a bank line needs a journal workflow to cover it. */
const BankThresholdCard: React.FC<{ settings: ApiSettings; currency: string; canEdit: boolean }> = ({ settings, currency, canEdit }) => {
  const actions = useAdminActions(settings.company_id);
  const digits = currencyDigits(currency);
  const limit = settings.journal_threshold?.amount;
  const saved = limit == null ? '' : minorToInput(limit, digits);
  const [text, setText] = useState(saved);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const slot = useRef(new IntentSlot()).current;

  const save = async () => {
    const parsed = parseAmountInput(text, digits);
    if (!parsed.ok || (parsed.minor !== null && parsed.minor < 0)) {
      setError('Enter an amount such as 1,000.00, or leave it empty for no limit.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      await actions.saveSettings({ journal_threshold: parsed.minor, version: settings.version }, slot.for(`${settings.version}:${parsed.minor}`));
      slot.clear();
      toast.success('Bank approval limit saved.');
    } catch (e) {
      setError(describeProblem(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SettingsCard
      title="Bank transaction limit"
      description={`Recording a bank line above this amount (in ${currency}) is refused unless a journal workflow covers it. Empty means no limit.`}
    >
      <div className="flex items-end gap-3">
        <label className="flex flex-col gap-1 text-[13px] text-text-secondary">
          Limit
          <input aria-label="Bank transaction limit" value={text} disabled={!canEdit} onChange={(e) => setText(e.target.value)} className={`${field} w-48 text-right tabular-nums`} />
        </label>
        {canEdit && <button type="button" className={primary} disabled={busy || text === saved} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>}
      </div>
      {error && <p role="alert" className="mt-2 text-[13px] text-danger">{error}</p>}
    </SettingsCard>
  );
};
