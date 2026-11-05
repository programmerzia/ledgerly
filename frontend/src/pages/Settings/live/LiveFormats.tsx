/** Settings → Company → Dates and numbers (plan 3c.26b): how dates and amounts read on screens and printed documents. Text only, no translation. */
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';
import { IntentSlot } from '@/api/intentSlot';
import type { ApiSettings } from '@/api/live/admin';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { Field, FormError, field, primary } from '@/components/live/form';
import { settingsKey, useAdminActions } from '@/data/admin';
import { isSigningCancelled } from '@/data/signing';
import { SettingsCard } from '../settings-ui';

interface FormatState {
  date: string;
  number: string;
  date_chosen: string | null;
  number_chosen: string | null;
  date_options: { key: string; example: string }[];
  number_options: { key: string; example: string }[];
}

/** An empty value means "follow the company's country". */
const FOLLOW = '';

export const LiveFormats: React.FC<{ settings: ApiSettings; companyId: string }> = ({ settings, companyId }) => {
  const formats = (settings as unknown as { formats: FormatState }).formats;
  const actions = useAdminActions(companyId);
  const qc = useQueryClient();
  const slot = useRef(new IntentSlot()).current;
  const [date, setDate] = useState(formats.date_chosen ?? FOLLOW);
  const [number, setNumber] = useState(formats.number_chosen ?? FOLLOW);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);

  const canEdit = settings.can.update;
  const patch = {
    ...(date !== (formats.date_chosen ?? FOLLOW) ? { date_format: date === FOLLOW ? null : date } : {}),
    ...(number !== (formats.number_chosen ?? FOLLOW) ? { number_format: number === FOLLOW ? null : number } : {}),
  };
  const dirty = Object.keys(patch).length > 0;
  const example = (options: { key: string; example: string }[], key: string) => options.find((o) => o.key === key)?.example ?? '';

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const version = settings.version;
      await actions.saveSettings({ ...patch, version }, slot.for(`${version}:${JSON.stringify(patch)}`));
      slot.clear();
      toast.success('Date and number formats saved.');
    } catch (err) {
      if (err instanceof ApiError && err.isVersionConflict) {
        setConflict({
          noun: 'company settings', serverVersion: err.serverVersion, localVersion: settings.version, onClose: () => setConflict(null),
          onReload: () => { setConflict(null); void qc.invalidateQueries({ queryKey: settingsKey(companyId) }); },
        });
      } else if (!isSigningCancelled(err)) setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void save(e)} aria-label="Dates and numbers">
      <SettingsCard title="Dates and numbers" description={`How dates and amounts read on screens and printed documents. Exports for spreadsheets keep ISO dates and plain numbers. Now: ${example(formats.date_options, formats.date)} and ${example(formats.number_options, formats.number)}.`}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field id="co-datefmt" label="Date format">
            <select id="co-datefmt" className={field} value={date} onChange={(e) => setDate(e.target.value)} disabled={!canEdit}>
              <option value={FOLLOW}>Usual for {settings.country}</option>
              {formats.date_options.map((o) => <option key={o.key} value={o.key}>{o.example}</option>)}
            </select>
          </Field>
          <Field id="co-numfmt" label="Number format">
            <select id="co-numfmt" className={field} value={number} onChange={(e) => setNumber(e.target.value)} disabled={!canEdit}>
              <option value={FOLLOW}>Usual for {settings.country}</option>
              {formats.number_options.map((o) => <option key={o.key} value={o.key}>{o.example}</option>)}
            </select>
          </Field>
        </div>
        <FormError error={error} />
        {canEdit && (
          <div className="mt-4">
            <button type="submit" className={primary} disabled={busy || !dirty}>Save formats</button>
          </div>
        )}
      </SettingsCard>
      <ConflictDialog conflict={conflict} />
    </form>
  );
};
