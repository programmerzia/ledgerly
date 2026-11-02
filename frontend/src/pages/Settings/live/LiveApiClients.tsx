/** Settings → API access: clients for integrations, each with tokens. A token is shown once, when it is created. */
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { IntentSlot } from '@/api/intentSlot';
import { fieldError } from '@/api/messages';
import type { ApiClient } from '@/api/live/admin';
import { describeProblem } from '@/api/live/writeProblems';
import { API_ABILITIES, expiryToApi, groupAbilities } from '@/api/adapters/admin';
import { formatDate } from '@/lib/format';
import { isSigningCancelled } from '@/data/signing';
import { useAdminActions, useApiClients } from '@/data/admin';
import { useCompanyList } from '@/data/session';
import { useCurrentCompany } from '@/data/team';
import { SecretOnce } from '@/components/live/SecretOnce';
import { Field, FormError, LoadError, Loading, field, primary, secondary } from '@/components/live/form';
import { SettingsCard } from '../settings-ui';

const GROUPS = groupAbilities(API_ABILITIES);

export const LiveApiClients: React.FC = () => {
  const company = useCurrentCompany();
  const clients = useApiClients();
  const actions = useAdminActions(company.id);
  const companies = useCompanyList().companies;
  const [reveal, setReveal] = useState<{ title: string; token: string } | null>(null);
  const [adding, setAdding] = useState<{ client: ApiClient | null } | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const revokeSlot = useRef(new IntentSlot()).current;

  if (clients.isPending) return <Loading what="Loading API clients" />;
  if (clients.isError) {
    return clients.error instanceof ApiError && clients.error.status === 403
      ? <SettingsCard title="API access"><p role="alert" className="text-[13px] text-text-secondary">Only owners and administrators can manage API access.</p></SettingsCard>
      : <LoadError error={clients.error} onRetry={() => void clients.refetch()} />;
  }

  const companyName = (id: string) => companies.find((c) => c.id === id)?.name ?? 'a company';
  const revoke = async (c: ApiClient) => {
    try {
      await actions.revokeApiClient(c.id, revokeSlot.for(c.id));
      revokeSlot.clear();
      setConfirm(null);
      toast.success(`"${c.name}" is revoked. Its tokens stopped working.`);
    } catch (e) {
      if (!isSigningCancelled(e)) toast.error(describeProblem(e));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {reveal && <SecretOnce title={reveal.title} value={reveal.token} note="Copy it now. It cannot be shown again, and we do not keep a readable copy. If you lose it, make a new token." onDone={() => setReveal(null)} />}
      <SettingsCard title="API clients" description="An integration signs in with a token instead of a person. A token only reaches the companies and actions you choose, and it can never approve a document.">
        {clients.data.length === 0 ? (
          <p className="text-[13px] text-text-muted" data-testid="no-clients">No API clients yet.</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="client-list">
            {clients.data.map((c) => (
              <li key={c.id} data-client={c.name} data-active={c.is_active ? 'true' : 'false'} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] font-medium text-text-primary">
                      {c.name}
                      {!c.is_active && <span className="ml-2 rounded bg-surface-neutral px-1.5 py-0.5 text-[11px] text-text-muted">Revoked {c.revoked_at ? formatDate(c.revoked_at.slice(0, 10)) : ''}</span>}
                    </div>
                    <div className="text-xs text-text-muted">
                      {c.company_ids.map(companyName).join(', ')} · {c.last_used_at ? `last used ${formatDate(c.last_used_at.slice(0, 10))}` : 'never used'}
                    </div>
                  </div>
                  {c.can.issue_token && c.is_active && <button type="button" className={`${secondary} h-7 px-2.5 text-xs`} onClick={() => setAdding({ client: c })}>New token</button>}
                  {c.can.revoke && c.is_active && (
                    confirm === c.id ? (
                      <span className="flex items-center gap-2 text-xs">
                        <span className="text-text-secondary">Its tokens stop working at once.</span>
                        <button type="button" className={`${secondary} h-7 px-2.5 text-xs text-danger`} onClick={() => void revoke(c)}>Revoke</button>
                        <button type="button" className={`${secondary} h-7 px-2.5 text-xs`} onClick={() => setConfirm(null)}>Keep</button>
                      </span>
                    ) : (
                      <button type="button" className={`${secondary} h-7 px-2.5 text-xs`} onClick={() => setConfirm(c.id)}>Revoke</button>
                    )
                  )}
                </div>
                {c.tokens.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-1 text-xs text-text-secondary">
                    {c.tokens.map((t, i) => (
                      <li key={i}>
                        <span className="font-medium text-text-primary">{t.name}</span> · {t.abilities.length} permission{t.abilities.length === 1 ? '' : 's'}
                        {t.expires_at ? ` · expires ${formatDate(t.expires_at.slice(0, 10))}` : ' · no expiry'}
                        {t.last_used_at ? ` · used ${formatDate(t.last_used_at.slice(0, 10))}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
        {!adding && (
          <div className="mt-4 border-t border-border pt-4">
            <button type="button" className={`${primary} h-8 px-3 text-[13px]`} onClick={() => setAdding({ client: null })}>New API client</button>
          </div>
        )}
      </SettingsCard>
      {adding && (
        <ClientForm
          client={adding.client}
          choices={companies.map((c) => ({ id: c.id, name: c.name }))}
          currentCompanyId={company.id}
          onCancel={() => setAdding(null)}
          onCreated={(title, token) => { setAdding(null); setReveal({ title, token }); }}
        />
      )}
    </div>
  );
};

const ClientForm: React.FC<{
  client: ApiClient | null;
  choices: { id: string; name: string }[];
  currentCompanyId: string;
  onCancel: () => void;
  onCreated: (title: string, token: string) => void;
}> = ({ client, choices, currentCompanyId, onCancel, onCreated }) => {
  const actions = useAdminActions(currentCompanyId);
  const slot = useRef(new IntentSlot()).current;
  const [name, setName] = useState('');
  const [tokenName, setTokenName] = useState('');
  const [expires, setExpires] = useState('');
  const [companyIds, setCompanyIds] = useState<string[]>([currentCompanyId]);
  const [abilities, setAbilities] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (list: string[], v: string) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client && !name.trim()) return setProblem('Give the client a name.');
    if (!client && companyIds.length === 0) return setProblem('Choose at least one company.');
    if (abilities.length === 0) return setProblem('Choose at least one permission.');
    setProblem(null);
    setError(null);
    setBusy(true);
    try {
      const expires_at = expiryToApi(expires);
      const sig = JSON.stringify([client?.id, name, tokenName, expires_at, companyIds, abilities]);
      const result = client
        ? await actions.issueApiToken(client.id, { token_name: tokenName.trim() || null, abilities, expires_at }, slot.for(sig))
        : await actions.createApiClient({ name: name.trim(), company_ids: companyIds, token_name: tokenName.trim() || null, abilities: abilities as never, expires_at }, slot.for(sig));
      slot.clear();
      if (!result.token) throw new Error('The server did not return a token.');
      onCreated(client ? `Token for ${client.name}` : `Token for ${result.name}`, result.token);
    } catch (err) {
      if (!isSigningCancelled(err)) setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} aria-label="New API client" className="flex flex-col gap-4">
      <SettingsCard title={client ? `New token for ${client.name}` : 'New API client'} description="You will see the token once, right after you create it.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {!client && (
            <Field id="cl-name" label="Name" hint="What it is for, for example Payroll export." error={fieldError(error, 'name')}>
              <input id="cl-name" className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={255} />
            </Field>
          )}
          <Field id="cl-token" label="Token name" hint="Optional. Helps you tell tokens apart." error={fieldError(error, 'token_name')}>
            <input id="cl-token" className={field} value={tokenName} onChange={(e) => setTokenName(e.target.value)} maxLength={100} />
          </Field>
          <Field id="cl-exp" label="Expires on" hint="Optional. At most two years ahead." error={fieldError(error, 'expires_at')}>
            <input id="cl-exp" type="date" className={field} value={expires} onChange={(e) => setExpires(e.target.value)} />
          </Field>
        </div>
        {!client && (
          <fieldset className="mt-4">
            <legend className="text-[13px] font-medium text-text-primary">Companies it can reach</legend>
            <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5">
              {choices.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-[13px] text-text-primary">
                  <input type="checkbox" checked={companyIds.includes(c.id)} onChange={() => setCompanyIds(toggle(companyIds, c.id))} /> {c.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <fieldset className="mt-4">
          <legend className="text-[13px] font-medium text-text-primary">What it may do</legend>
          <div className="mt-2 grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
            {GROUPS.map((g) => (
              <div key={g.resource}>
                <div className="text-xs font-medium text-text-secondary">{g.label}</div>
                {g.abilities.map((a) => (
                  <label key={a.value} className="mt-1 flex items-center gap-2 text-[13px] text-text-primary">
                    <input type="checkbox" checked={abilities.includes(a.value)} onChange={() => setAbilities(toggle(abilities, a.value))} aria-label={`${g.label}: ${a.label}`} /> {a.label}
                  </label>
                ))}
              </div>
            ))}
          </div>
        </fieldset>
      </SettingsCard>
      {problem && <p role="alert" className="text-[13px] text-danger">{problem}</p>}
      <FormError error={error} />
      <div className="flex gap-2">
        <button type="submit" className={primary} disabled={busy}>{busy ? 'Creating…' : client ? 'Create token' : 'Create client'}</button>
        <button type="button" className={secondary} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
};
