/**
 * /org/settings (plan 3c.26): the organisation's profile and its companies, each linking into the company. Security policy, feature flags
 * and data export are Phase 4 and are not here. Live mode only; it sits outside any one company, so it has its own plain header.
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchOrganisation, renameOrganisation } from '@/api/live/organisation';
import { describeError } from '@/api/messages';
import { formatDate } from '@/lib/format';
import { useHomePath, useMe } from '@/data/session';
import { currentTenant } from '@/api/adapters/session';
import { BrandMark } from '@/layouts/shell/Sidebar';
import { Field, field, FormError, LoadError, Loading, primary } from '@/components/live/form';
import { SettingsCard } from '@/pages/Settings/settings-ui';

const orgKey = (tenantId: string) => ['organisation', tenantId] as const;

export const OrgSettings: React.FC = () => {
  const me = useMe();
  const home = useHomePath();
  const qc = useQueryClient();
  const tenantId = (me.data ? currentTenant(me.data)?.id : undefined) ?? 'none';
  const org = useQuery({ queryKey: orgKey(tenantId), queryFn: fetchOrganisation, retry: false });
  const [name, setName] = useState('');
  useEffect(() => { if (org.data) setName(org.data.name); }, [org.data]);
  const rename = useMutation({
    mutationFn: (value: string) => renameOrganisation(value),
    onSuccess: async () => {
      toast.success('Organisation renamed');
      await Promise.all([qc.invalidateQueries({ queryKey: orgKey(tenantId) }), qc.invalidateQueries({ queryKey: ['me'] })]);
    },
  });

  return (
    <div className="min-h-screen bg-canvas">
      <header className="flex h-14 items-center gap-2 border-b border-border bg-sidebar px-5">
        <BrandMark />
        <span className="text-[15px] font-semibold text-text-primary">Ledgerly</span>
        {home && <Link to={home} className="ml-auto text-[13px] text-accent hover:underline">Back to your books</Link>}
      </header>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6">
        <h1 className="text-xl font-semibold text-text-primary">Organisation</h1>
        {org.isPending ? <Loading what="Loading the organisation" /> : org.isError ? (
          <LoadError error={org.error} onRetry={() => void org.refetch()} />
        ) : (
          <>
            <SettingsCard title="Profile" description="The name people see in invitations and emails. Your address stays the same when you rename.">
              <form
                className="flex max-w-md flex-col gap-4"
                onSubmit={(e) => { e.preventDefault(); rename.mutate(name); }}
              >
                <Field id="org-name" label="Organisation name">
                  <input id="org-name" className={field} value={name} maxLength={120} disabled={!org.data.can.update} onChange={(e) => setName(e.target.value)} />
                </Field>
                <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-[13px]">
                  <dt className="text-text-muted">Address name</dt><dd className="text-text-primary">{org.data.slug}</dd>
                  <dt className="text-text-muted">People</dt><dd className="text-text-primary">{org.data.members}</dd>
                  {org.data.created_at && <><dt className="text-text-muted">Created</dt><dd className="text-text-primary">{formatDate(org.data.created_at.slice(0, 10))}</dd></>}
                </dl>
                <FormError error={rename.error} />
                {org.data.can.update ? (
                  <div><button type="submit" className={primary} disabled={rename.isPending || name.trim() === '' || name.trim() === org.data.name}>Save name</button></div>
                ) : (
                  <p className="text-[13px] text-text-muted">Only owners and administrators can change the organisation.</p>
                )}
              </form>
            </SettingsCard>

            <SettingsCard title="Companies" description="The companies you can open in this organisation.">
              {org.data.companies.length === 0 ? <p className="text-[13px] text-text-muted">No companies you can open yet.</p> : (
                <ul className="divide-y divide-border" data-testid="org-companies">
                  {org.data.companies.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 py-2.5 text-[13px]">
                      <div className="min-w-0 flex-1">
                        <Link to={`/${c.slug}/dashboard`} className="font-medium text-accent hover:underline">{c.name}</Link>
                        <div className="text-xs text-text-muted">{[c.legal_name, c.country, c.base_currency].filter(Boolean).join(' · ')}</div>
                      </div>
                      <Link to={`/${c.slug}/settings`} className="text-xs text-accent hover:underline">Settings</Link>
                      <Link to={`/${c.slug}/settings/team`} className="text-xs text-accent hover:underline">People and roles</Link>
                    </li>
                  ))}
                </ul>
              )}
            </SettingsCard>
          </>
        )}
      </main>
    </div>
  );
};
