/** Settings → Webhooks: endpoints that are told when something happens, their signing secret (shown once) and deliveries. */
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { ApiError } from '@/api/errors';
import { IntentSlot } from '@/api/intentSlot';
import { fieldError } from '@/api/messages';
import type { ApiWebhook, WebhookBody } from '@/api/live/admin';
import { describeProblem } from '@/api/live/writeProblems';
import { DELIVERY_STATUS_LABEL, WEBHOOK_EVENTS, eventLabel, groupEvents } from '@/api/adapters/admin';
import { formatDate, formatDateTime } from '@/lib/format';
import { isSigningCancelled } from '@/data/signing';
import { useAdminActions, useDeliveries, useWebhooks } from '@/data/admin';
import { useCurrentCompany } from '@/data/team';
import { SecretOnce } from '@/components/live/SecretOnce';
import { Field, FormError, LoadError, Loading, field, primary, secondary } from '@/components/live/form';
import { SettingsCard } from '../settings-ui';

const GROUPS = groupEvents(WEBHOOK_EVENTS);
const when = (iso: string | null) => (iso ? formatDateTime(iso) : '');

export const LiveWebhooks: React.FC = () => {
  const company = useCurrentCompany();
  const hooks = useWebhooks();
  const actions = useAdminActions(company.id);
  const [reveal, setReveal] = useState<{ title: string; secret: string } | null>(null);
  const [editing, setEditing] = useState<ApiWebhook | 'new' | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const toggleSlot = useRef(new IntentSlot()).current;
  const rotateSlot = useRef(new IntentSlot()).current;

  if (hooks.isPending) return <Loading what="Loading webhooks" />;
  if (hooks.isError) {
    return hooks.error instanceof ApiError && hooks.error.status === 403
      ? <SettingsCard title="Webhooks"><p role="alert" className="text-[13px] text-text-secondary">Only owners and administrators can manage webhooks.</p></SettingsCard>
      : <LoadError error={hooks.error} onRetry={() => void hooks.refetch()} />;
  }

  const run = async (fn: () => Promise<unknown>, done: string) => {
    try {
      await fn();
      toast.success(done);
    } catch (e) {
      if (!isSigningCancelled(e)) toast.error(describeProblem(e));
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {reveal && <SecretOnce title={reveal.title} value={reveal.secret} note="This signs every delivery so you can check it came from us. Copy it now. It cannot be shown again." onDone={() => setReveal(null)} />}
      <SettingsCard title="Webhook endpoints" description="We send a signed request to the address when one of the chosen events happens. A delivery that fails is tried again a few times.">
        {hooks.data.length === 0 ? (
          <p className="text-[13px] text-text-muted" data-testid="no-webhooks">No webhooks yet.</p>
        ) : (
          <ul className="divide-y divide-border" data-testid="webhook-list">
            {hooks.data.map((w) => (
              <li key={w.id} data-webhook={w.url} data-active={w.is_active ? 'true' : 'false'} className="py-4 first:pt-0 last:pb-0">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-text-primary">
                      {w.url}
                      {!w.is_active && <span className="ml-2 rounded bg-surface-neutral px-1.5 py-0.5 text-[11px] text-text-muted">Disabled</span>}
                    </div>
                    <div className="text-xs text-text-muted">
                      {w.description ? `${w.description} · ` : ''}{w.events.includes('*') ? 'Every event' : `${w.events.length} event${w.events.length === 1 ? '' : 's'}`}
                      {w.secret_rotated_at ? ` · secret changed ${formatDate(w.secret_rotated_at.slice(0, 10))}` : ''}
                    </div>
                    {!w.is_active && w.disabled_reason && <div className="text-xs text-warning">Switched off: {w.disabled_reason}</div>}
                  </div>
                  <button type="button" className={`${secondary} h-7 px-2.5 text-xs`} onClick={() => setOpen(open === w.id ? null : w.id)}>{open === w.id ? 'Hide deliveries' : 'Deliveries'}</button>
                  {w.can.update && (
                    <>
                      <button type="button" className={`${secondary} h-7 px-2.5 text-xs`} onClick={() => setEditing(w)}>Edit</button>
                      <button type="button" className={`${secondary} h-7 px-2.5 text-xs`} onClick={() => void run(async () => { const r = await actions.rotateSecret(w.id, rotateSlot.for(w.id)); rotateSlot.clear(); if (r.secret) setReveal({ title: `New secret for ${w.url}`, secret: r.secret }); }, 'Secret replaced. The old one no longer works.')}>New secret</button>
                      <button type="button" className={`${secondary} h-7 px-2.5 text-xs`} onClick={() => void run(async () => { await actions.setWebhookEnabled(w.id, !w.is_active, toggleSlot.for(`${w.id}:${w.is_active}`)); toggleSlot.clear(); }, w.is_active ? 'Webhook disabled.' : 'Webhook enabled.')}>{w.is_active ? 'Disable' : 'Enable'}</button>
                    </>
                  )}
                </div>
                {open === w.id && <Deliveries webhookId={w.id} canRedeliver={w.can.update} companyId={company.id} />}
              </li>
            ))}
          </ul>
        )}
        {!editing && (
          <div className="mt-4 border-t border-border pt-4">
            <button type="button" className={`${primary} h-8 px-3 text-[13px]`} onClick={() => setEditing('new')}>New webhook</button>
          </div>
        )}
      </SettingsCard>
      {editing && (
        <WebhookForm
          target={editing}
          companyId={company.id}
          onCancel={() => setEditing(null)}
          onSaved={(secret, url) => { setEditing(null); if (secret) setReveal({ title: `Signing secret for ${url}`, secret }); }}
          onConflict={setConflict}
          reload={() => { setConflict(null); setEditing(null); void hooks.refetch(); }}
        />
      )}
      <ConflictDialog conflict={conflict} />
    </div>
  );
};

const WebhookForm: React.FC<{
  target: ApiWebhook | 'new';
  companyId: string;
  onCancel: () => void;
  onSaved: (secret: string | undefined, url: string) => void;
  onConflict: (c: VersionConflict | null) => void;
  reload: () => void;
}> = ({ target, companyId, onCancel, onSaved, onConflict, reload }) => {
  const existing = target === 'new' ? null : target;
  const actions = useAdminActions(companyId);
  const slot = useRef(new IntentSlot()).current;
  const [url, setUrl] = useState(existing?.url ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [events, setEvents] = useState<string[]>(existing?.events ?? []);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const all = events.includes('*');

  const toggle = (e: string) => setEvents(events.includes(e) ? events.filter((x) => x !== e) : [...events, e]);

  const send = async (version?: number) => {
    if (!url.trim()) return setProblem('Enter the address to send to.');
    if (events.length === 0) return setProblem('Choose at least one event.');
    setProblem(null);
    setError(null);
    setBusy(true);
    const body = { url: url.trim(), description: description.trim() || null, events: (all ? ['*'] : events) as WebhookBody['events'], ...(existing ? { version: version ?? existing.version } : {}) };
    try {
      const sig = JSON.stringify(body);
      const result = existing ? await actions.updateWebhook(existing.id, body, slot.for(sig)) : await actions.createWebhook(body, slot.for(sig));
      slot.clear();
      toast.success(existing ? 'Webhook saved.' : 'Webhook added.');
      onSaved(result.secret, result.url);
    } catch (e) {
      if (e instanceof ApiError && e.isVersionConflict && existing) {
        const server = typeof e.serverVersion === 'number' ? e.serverVersion : undefined;
        onConflict({
          noun: 'webhook', serverVersion: e.serverVersion, localVersion: existing.version, onReload: reload, onClose: reload,
          onOverwrite: server === undefined ? undefined : () => { onConflict(null); void send(server); },
        });
      } else if (!isSigningCancelled(e)) setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => { e.preventDefault(); void send(); }} aria-label={existing ? 'Edit webhook' : 'New webhook'} className="flex flex-col gap-4">
      <SettingsCard title={existing ? 'Edit webhook' : 'New webhook'} description={existing ? undefined : 'The signing secret is shown once, right after you save.'}>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field id="wh-url" label="Address" hint="Must start with https://." error={fieldError(error, 'url')}>
            <input id="wh-url" className={field} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/hooks/ledgerly" maxLength={2048} />
          </Field>
          <Field id="wh-desc" label="Note" hint="Optional." error={fieldError(error, 'description')}>
            <input id="wh-desc" className={field} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={255} />
          </Field>
        </div>
        <fieldset className="mt-4">
          <legend className="text-[13px] font-medium text-text-primary">Tell it about</legend>
          <label className="mt-2 flex items-center gap-2 text-[13px] text-text-primary">
            <input type="checkbox" checked={all} onChange={() => setEvents(all ? [] : ['*'])} /> {eventLabel('*')}
          </label>
          {!all && (
            <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2">
              {GROUPS.map((g) => (
                <div key={g.group}>
                  <div className="text-xs font-medium text-text-secondary">{g.group}</div>
                  {g.events.map((e) => (
                    <label key={e} className="mt-1 flex items-center gap-2 text-[13px] text-text-primary">
                      <input type="checkbox" checked={events.includes(e)} onChange={() => toggle(e)} aria-label={e} /> {eventLabel(e)}
                    </label>
                  ))}
                </div>
              ))}
            </div>
          )}
          {fieldError(error, 'events') && <span role="alert" className="text-xs text-danger">{fieldError(error, 'events')}</span>}
        </fieldset>
      </SettingsCard>
      {problem && <p role="alert" className="text-[13px] text-danger">{problem}</p>}
      <FormError error={error} />
      <div className="flex gap-2">
        <button type="submit" className={primary} disabled={busy}>{busy ? 'Saving…' : existing ? 'Save webhook' : 'Add webhook'}</button>
        <button type="button" className={secondary} disabled={busy} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
};

const STATUSES = ['', 'pending', 'delivered', 'failed', 'cancelled'];

const Deliveries: React.FC<{ webhookId: string; canRedeliver: boolean; companyId: string }> = ({ webhookId, canRedeliver, companyId }) => {
  const [status, setStatus] = useState('');
  const q = useDeliveries(webhookId, status);
  const actions = useAdminActions(companyId);
  const slot = useRef(new IntentSlot()).current;
  const rows = q.data?.pages.flatMap((p) => p.data) ?? [];

  const again = async (id: string) => {
    try {
      await actions.redeliver(webhookId, id, slot.for(id));
      slot.clear();
      toast.success('Sent again.');
    } catch (e) {
      if (!isSigningCancelled(e)) toast.error(describeProblem(e));
    }
  };

  return (
    <div className="mt-3 rounded-md border border-border bg-canvas p-3" data-testid="deliveries">
      <div className="mb-2 flex items-center gap-2 text-xs text-text-muted">
        <label htmlFor={`ds-${webhookId}`}>Show</label>
        <select id={`ds-${webhookId}`} className="h-7 rounded border border-border bg-surface px-1.5 text-xs" value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUSES.map((s) => <option key={s} value={s}>{s ? DELIVERY_STATUS_LABEL[s] : 'All'}</option>)}
        </select>
      </div>
      {q.isPending ? <Loading what="Loading deliveries" /> : q.isError ? <LoadError error={q.error} onRetry={() => void q.refetch()} /> : rows.length === 0 ? (
        <p className="text-[13px] text-text-muted">No deliveries yet.</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead><tr className="text-text-muted"><th className="pb-1 font-medium">Event</th><th className="pb-1 font-medium">Status</th><th className="pb-1 font-medium">Tries</th><th className="pb-1 font-medium">Answer</th><th className="pb-1 font-medium">Last try</th><th /></tr></thead>
          <tbody className="divide-y divide-border">
            {rows.map((d) => (
              <tr key={d.id} data-delivery={d.status}>
                <td className="py-1.5 pr-2 text-text-primary">{d.event_type}</td>
                <td className="py-1.5 pr-2">{DELIVERY_STATUS_LABEL[d.status] ?? d.status}</td>
                <td className="py-1.5 pr-2 tabular-nums">{d.attempts}</td>
                <td className="py-1.5 pr-2 text-text-secondary">{d.response_code ?? ''} {d.error ?? d.response_snippet ?? ''}</td>
                <td className="py-1.5 pr-2 text-text-muted">{when(d.last_attempt_at ?? d.created_at)}{d.status === 'pending' && d.next_retry_at ? ` · next ${when(d.next_retry_at)}` : ''}</td>
                <td className="py-1.5 text-right">{canRedeliver && (d.status === 'failed' || d.status === 'cancelled') && <button type="button" className="text-accent hover:underline cursor-pointer" onClick={() => void again(d.id)}>Send again</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {q.hasNextPage && <button type="button" disabled={q.isFetchingNextPage} className="mt-2 text-xs text-accent hover:underline cursor-pointer" onClick={() => void q.fetchNextPage()}>Show more</button>}
    </div>
  );
};
