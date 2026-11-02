/** Settings → Company: the profile and tax rounding. Country and base currency are fixed when the company is created. */
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { IntentSlot } from '@/api/intentSlot';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { ApiError } from '@/api/errors';
import type { ApiSettings } from '@/api/live/admin';
import { fieldError } from '@/api/messages';
import { isSigningCancelled } from '@/data/signing';
import { TAX_ROUNDING_LABEL, profilePatch, toProfileForm, type ProfileForm } from '@/api/adapters/admin';
import { settingsKey, useAdminActions, useSettings } from '@/data/admin';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentCompany } from '@/data/team';
import { Field, FormError, LoadError, Loading, field, primary, secondary } from '@/components/live/form';
import { SettingsCard } from '../settings-ui';

export const LiveGeneral: React.FC = () => {
  const company = useCurrentCompany();
  const settings = useSettings(company.id);
  if (settings.isPending) return <Loading what="Loading company settings" />;
  if (settings.isError) return <LoadError error={settings.error} onRetry={() => void settings.refetch()} />;
  return <GeneralForm key={settings.data.version} settings={settings.data} companyId={company.id} />;
};

const GeneralForm: React.FC<{ settings: ApiSettings; companyId: string }> = ({ settings: loaded, companyId }) => {
  const settings = { data: loaded };
  const actions = useAdminActions(companyId);
  const slot = useRef(new IntentSlot()).current;
  const saved = toProfileForm(loaded);
  const [form, setForm] = useState<ProfileForm>(saved);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const qc = useQueryClient();

  const canEdit = settings.data.can.update;
  const patch = profilePatch(saved, form);
  const dirty = Object.keys(patch).length > 0;
  const set = (k: keyof ProfileForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const version = settings.data.version;
      const next = await actions.saveSettings({ ...patch, version }, slot.for(`${version}:${JSON.stringify(patch)}`));
      slot.clear();
      setForm(toProfileForm(next));
      toast.success('Company details saved.');
    } catch (err) {
      if (err instanceof ApiError && err.isVersionConflict) {
        const reload = () => {
          setConflict(null);
          void qc.invalidateQueries({ queryKey: settingsKey(companyId) });
        };
        setConflict({ noun: 'company details', serverVersion: err.serverVersion, localVersion: settings.data.version, onReload: reload, onClose: () => setConflict(null) });
      } else if (!isSigningCancelled(err)) setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-5" aria-label="Company details">
      <SettingsCard title="Company" description="These details appear on your documents and reports.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field id="co-name" label="Name" error={fieldError(error, 'name')}>
            <input id="co-name" className={field} value={form.name} onChange={set('name')} disabled={!canEdit} required maxLength={255} />
          </Field>
          <Field id="co-legal" label="Legal name" hint="As registered with the tax authority." error={fieldError(error, 'legal_name')}>
            <input id="co-legal" className={field} value={form.legal_name} onChange={set('legal_name')} disabled={!canEdit} maxLength={255} />
          </Field>
          <Field id="co-tax" label="Tax number" error={fieldError(error, 'tax_id')}>
            <input id="co-tax" className={field} value={form.tax_id} onChange={set('tax_id')} disabled={!canEdit} maxLength={64} />
          </Field>
          <Field id="co-tz" label="Time zone" hint="For example Europe/Sofia. Decides which day a posting falls on." error={fieldError(error, 'timezone')}>
            <input id="co-tz" className={field} value={form.timezone} onChange={set('timezone')} disabled={!canEdit} />
          </Field>
          <Field id="co-locale" label="Language and format" hint="For example en or bg-BG." error={fieldError(error, 'locale')}>
            <input id="co-locale" className={field} value={form.locale} onChange={set('locale')} disabled={!canEdit} maxLength={16} />
          </Field>
          <Field id="co-round" label="Round tax" error={fieldError(error, 'tax_rounding')}>
            <select id="co-round" className={field} value={form.tax_rounding} onChange={set('tax_rounding')} disabled={!canEdit}>
              {Object.entries(TAX_ROUNDING_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 text-[13px] md:grid-cols-3">
          <div><dt className="text-xs text-text-muted">Country</dt><dd className="text-text-primary">{settings.data.country}</dd></div>
          <div><dt className="text-xs text-text-muted">Currency of the books</dt><dd className="text-text-primary">{settings.data.base_currency}</dd></div>
          <div className="col-span-2 text-xs text-text-muted md:col-span-1">Country and currency are set when the company is created and cannot change, because every posted amount is in that currency.</div>
        </dl>
      </SettingsCard>
      <FormError error={error} />
      {canEdit ? (
        <div className="flex gap-2">
          <button type="submit" className={primary} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          <button type="button" className={secondary} disabled={!dirty || busy} onClick={() => { setForm(saved); setError(null); }}>Discard</button>
        </div>
      ) : (
        <p className="text-[13px] text-text-muted">You can read these details but not change them.</p>
      )}
      <ConflictDialog conflict={conflict} />
    </form>
  );
};
