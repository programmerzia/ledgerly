/** Settings → Posting accounts: the accounts the books post to by themselves. Empty ones are flagged. */
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { IntentSlot } from '@/api/intentSlot';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { ApiError } from '@/api/errors';
import { eligibleAccounts, postingPatch, toPostingRows, unsetPostingKeys } from '@/api/adapters/admin';
import { isSigningCancelled } from '@/data/signing';
import { settingsKey, useAdminActions, useSettings } from '@/data/admin';
import { useQueryClient } from '@tanstack/react-query';
import { useChartAccounts } from '@/data/banking';
import { useCurrentCompany } from '@/data/team';
import { FormError, LoadError, Loading, field, primary, secondary } from '@/components/live/form';
import { SettingsCard } from '../settings-ui';

export const LivePosting: React.FC = () => {
  const company = useCurrentCompany();
  const settings = useSettings(company.id);
  const accounts = useChartAccounts();
  const actions = useAdminActions(company.id);
  const slot = useRef(new IntentSlot()).current;
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const qc = useQueryClient();

  if (settings.isPending || accounts.isLoading) return <Loading what="Loading posting accounts" />;
  if (settings.isError) return <LoadError error={settings.error} onRetry={() => void settings.refetch()} />;
  if (accounts.error) return <LoadError error={accounts.error} onRetry={accounts.refetch} />;

  const rows = toPostingRows(settings.data);
  const canEdit = settings.data.can.update;
  const unset = unsetPostingKeys(rows);
  const patch = postingPatch(rows, chosen);
  const dirty = Object.keys(patch).length > 0;
  const stillEmpty = unset.filter((r) => (chosen[r.key] ?? '') === '').length;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const version = settings.data.version;
      await actions.saveSettings({ posting_accounts: patch, version }, slot.for(`${version}:${JSON.stringify(patch)}`));
      slot.clear();
      setChosen({});
      toast.success('Posting accounts saved.');
    } catch (err) {
      if (err instanceof ApiError && err.isVersionConflict) {
        const reload = () => {
          setConflict(null);
          setChosen({});
          void qc.invalidateQueries({ queryKey: settingsKey(company.id) });
        };
        setConflict({ noun: 'list of posting accounts', serverVersion: err.serverVersion, localVersion: settings.data.version, onReload: reload, onClose: () => setConflict(null) });
      } else if (!isSigningCancelled(err)) setError(err);
    } finally {
      setBusy(false);
    }
  };


  return (
    <div className="flex flex-col gap-5">
      {stillEmpty > 0 ? (
        <div role="status" data-testid="posting-unset" className="rounded-lg border border-warning/40 bg-warning-soft px-4 py-3 text-[13px] text-text-primary">
          {stillEmpty === 1 ? '1 account is' : `${stillEmpty} accounts are`} not set. A posting that needs one is refused until you choose it. These are marked below.
        </div>
      ) : (
        <div role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-[13px] text-text-secondary">Every posting account is set.</div>
      )}
      <SettingsCard title="Posting accounts" description="Invoices, bills, payments and the year-end close post to these accounts by themselves. Each one must be an active account that accepts postings.">
        <ul className="divide-y divide-border">
          {rows.map((r) => {
            const value = chosen[r.key] ?? r.accountId ?? '';
            const options = eligibleAccounts(accounts.data, r);
            const missing = r.accountId === null && value === '';
            // An account saved earlier may have been deactivated since; keep it visible rather than blank.
            const hasValue = value === '' || options.some((a) => a.id === value);
            return (
              <li key={r.key} data-posting={r.key} data-unset={missing ? 'true' : 'false'} className="grid grid-cols-1 gap-2 py-4 first:pt-0 last:pb-0 md:grid-cols-[1fr_18rem] md:gap-6">
                <div>
                  <label htmlFor={`pa-${r.key}`} className="text-[13px] font-medium text-text-primary">
                    {r.label}
                    {missing && <span className="ml-2 rounded bg-warning-soft px-1.5 py-0.5 text-[11px] font-medium text-warning">Not set</span>}
                  </label>
                  <p className="mt-0.5 text-xs text-text-muted">{r.help}</p>
                </div>
                <select id={`pa-${r.key}`} className={field} value={value} disabled={!canEdit || busy} onChange={(e) => setChosen({ ...chosen, [r.key]: e.target.value })}>
                  <option value="">Not set</option>
                  {!hasValue && <option value={value}>{r.accountLabel ?? 'Current account'} (no longer available)</option>}
                  {options.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                </select>
              </li>
            );
          })}
        </ul>
      <ConflictDialog conflict={conflict} />
      </SettingsCard>
      <FormError error={error} />
      {canEdit ? (
        <div className="flex gap-2">
          <button type="button" className={primary} disabled={!dirty || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save posting accounts'}</button>
          <button type="button" className={secondary} disabled={!dirty || busy} onClick={() => { setChosen({}); setError(null); }}>Discard</button>
        </div>
      ) : (
        <p className="text-[13px] text-text-muted">You can read these accounts but not change them.</p>
      )}
    </div>
  );
};
