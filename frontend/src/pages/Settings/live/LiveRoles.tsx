/**
 * Settings → Roles (plan 3c.25): what each role may do, by module, in plain words, with the people who hold it. Create a role, copy one,
 * change its rights, reset a standard role, delete a custom role nobody holds. The server enforces everything (Owner is locked, names of
 * standard roles are fixed, nobody grants rights above their own); this screen only offers the actions and shows the answer.
 */
import React, { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import type { ApiRole } from '@/api/live/team';
import { useCurrentCompany, useMembers, usePermissionModules, useRoleActions, useRoles } from '@/data/team';
import { field, LoadError, Loading, primary, secondary } from '@/components/live/form';
import { cn } from '@/lib/utils';
import { SettingsCard } from '../settings-ui';

interface Draft {
  /** Null while creating a new role. */
  id: string | null;
  name: string;
  /** A standard role keeps its name. */
  nameFixed: boolean;
  perms: Set<string>;
}

const isForbidden = (e: unknown) => e instanceof ApiError && e.status === 403;

const permissionsOf = (r: ApiRole): string[] => r.permissions.filter((p): p is string => typeof p === 'string');

const kindOf = (r: ApiRole): string => (r.locked ? 'Locked' : r.system ? (r.edited ? 'Standard, edited' : 'Standard') : 'Custom');

export const LiveRoles: React.FC = () => {
  const company = useCurrentCompany();
  const roles = useRoles(company.id);
  const modules = usePermissionModules(company.id);
  const members = useMembers(company.id);
  const actions = useRoleActions(company.id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const holders = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const m of members.data ?? []) for (const r of m.companyRoles) map.set(r, [...(map.get(r) ?? []), m.name]);
    return map;
  }, [members.data]);

  if (isForbidden(roles.error)) {
    return <SettingsCard title="Roles"><p role="alert" className="text-[13px] text-text-secondary">Only owners and administrators can manage roles. Ask one of them if you need a change.</p></SettingsCard>;
  }
  if (roles.isPending || modules.isPending) return <SettingsCard title="Roles"><Loading what="Loading roles" /></SettingsCard>;
  if (roles.isError) return <SettingsCard title="Roles"><LoadError error={roles.error} onRetry={() => void roles.refetch()} /></SettingsCard>;
  if (modules.isError) return <SettingsCard title="Roles"><LoadError error={modules.error} onRetry={() => void modules.refetch()} /></SettingsCard>;

  const list = roles.data;
  const run = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      if (done) toast.success(done);
    } catch (e) {
      setError(e);
      toast.error(describeError(e));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (r: ApiRole) => { setError(null); setDraft({ id: r.id, name: r.name, nameFixed: r.system, perms: new Set(permissionsOf(r)) }); };
  const startCopy = (r: ApiRole) => { setError(null); setDraft({ id: null, name: `${r.name} copy`, nameFixed: false, perms: new Set(permissionsOf(r)) }); };
  const startNew = () => { setError(null); setDraft({ id: null, name: '', nameFixed: false, perms: new Set() }); };
  const toggle = (name: string) => setDraft((d) => {
    if (!d) return d;
    const perms = new Set(d.perms);
    if (perms.has(name)) perms.delete(name); else perms.add(name);
    return { ...d, perms };
  });
  const save = () => {
    if (!draft) return;
    const body = { name: draft.name, permissions: [...draft.perms] };
    void run(async () => {
      if (draft.id === null) await actions.create(body); else await actions.update(draft.id, draft.nameFixed ? { permissions: body.permissions } : body);
      setDraft(null);
    }, draft.id === null ? 'Role created' : 'Role saved');
  };
  const reset = (r: ApiRole) => {
    if (!window.confirm(`Put ${r.name} back to its standard rights? Your changes to it are lost.`)) return;
    void run(() => actions.reset(r.id), `${r.name} is back to its standard rights`);
  };
  const remove = (r: ApiRole) => {
    if (!window.confirm(`Delete the role ${r.name}?`)) return;
    void run(() => actions.remove(r.id), 'Role deleted');
  };

  const cell = 'border-b border-border px-3 py-1.5 text-center align-middle';
  const columns = list.length + (draft && draft.id === null ? 1 : 0);

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard
        title="Roles"
        description={`What each role can do in ${company.name}. A person can hold several roles. Approving never overrides the rule that nobody approves their own work, and closed periods stay closed.`}
      >
        <div className="mb-4 flex items-center gap-2">
          <button type="button" className={primary} disabled={busy || draft !== null} onClick={startNew}>New role</button>
          {draft && <span className="text-[13px] text-text-muted">Editing {draft.name || 'a new role'}. Tick what this role may do, then save.</span>}
        </div>
        {error !== null && <p role="alert" className="mb-3 text-[13px] text-danger">{describeError(error)}</p>}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-[13px]" data-testid="role-grid">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 w-64 bg-surface px-3 py-2 text-left text-xs font-medium text-text-muted">Right</th>
                {list.map((r) => (
                  <th key={r.id} scope="col" className={cn('min-w-28 px-3 py-2 align-bottom text-xs font-semibold text-text-primary', draft?.id === r.id && 'bg-accent/5')}>
                    <div>{r.name}</div>
                    <div className="mt-0.5 text-[11px] font-normal text-text-muted">{kindOf(r)}</div>
                  </th>
                ))}
                {draft && draft.id === null && (
                  <th scope="col" className="min-w-36 bg-accent/5 px-3 py-2 align-bottom">
                    <label className="sr-only" htmlFor="new-role-name">Role name</label>
                    <input id="new-role-name" className={cn(field, 'h-8 w-full text-[13px]')} value={draft.name} maxLength={64} placeholder="Role name" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                  </th>
                )}
              </tr>
              <tr>
                <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-xs font-medium text-text-muted">What you can do with a role</th>
                {list.map((r) => (
                  <td key={r.id} className="px-2 py-2 text-center align-top">
                    {draft?.id === r.id ? (
                      <div className="flex flex-col items-center gap-1">
                        {!draft.nameFixed && <input aria-label="Role name" className={cn(field, 'h-8 w-28 text-[13px]')} value={draft.name} maxLength={64} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}
                        <button type="button" className={cn(primary, 'h-7 px-3 text-xs')} disabled={busy} onClick={save}>Save</button>
                        <button type="button" className={cn(secondary, 'h-7 px-3 text-xs')} disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap justify-center gap-1">
                        {!r.locked && <button type="button" aria-label={`Change ${r.name}`} className={cn(secondary, 'h-7 px-2 text-xs')} disabled={busy || draft !== null} onClick={() => startEdit(r)}>Change</button>}
                        <button type="button" aria-label={`Copy ${r.name}`} className={cn(secondary, 'h-7 px-2 text-xs')} disabled={busy || draft !== null} onClick={() => startCopy(r)}>Copy</button>
                        {r.system && r.edited && <button type="button" aria-label={`Reset ${r.name}`} className={cn(secondary, 'h-7 px-2 text-xs')} disabled={busy || draft !== null} onClick={() => reset(r)}>Reset</button>}
                        {!r.system && <button type="button" aria-label={`Delete ${r.name}`} className={cn(secondary, 'h-7 px-2 text-xs')} disabled={busy || draft !== null || r.members > 0} title={r.members > 0 ? 'Take it off the people who hold it first' : undefined} onClick={() => remove(r)}>Delete</button>}
                      </div>
                    )}
                  </td>
                ))}
                {draft && draft.id === null && (
                  <td className="bg-accent/5 px-2 py-2 text-center align-top">
                    <div className="flex flex-col items-center gap-1">
                      <button type="button" className={cn(primary, 'h-7 px-3 text-xs')} disabled={busy} onClick={save}>Create</button>
                      <button type="button" className={cn(secondary, 'h-7 px-3 text-xs')} disabled={busy} onClick={() => setDraft(null)}>Cancel</button>
                    </div>
                  </td>
                )}
              </tr>
              <tr>
                <th scope="row" className="sticky left-0 z-10 bg-surface px-3 py-2 text-left text-xs font-medium text-text-muted">Held by</th>
                {list.map((r) => (
                  <td key={r.id} className="border-b border-border px-2 py-2 text-center align-top text-xs text-text-secondary" data-holders={r.name}>
                    {(holders.get(r.name) ?? []).length === 0 ? <span className="text-text-muted">No one</span> : (holders.get(r.name) ?? []).join(', ')}
                  </td>
                ))}
                {draft && draft.id === null && <td className="border-b border-border" />}
              </tr>
            </thead>
            <tbody>
              {modules.data.map((m) => (
                <React.Fragment key={m.key}>
                  <tr>
                    <th scope="rowgroup" colSpan={columns + 1} className="bg-surface-neutral px-3 py-1.5 text-left text-xs font-semibold text-text-primary">{m.label}</th>
                  </tr>
                  {m.permissions.map((p) => (
                    <tr key={p.name}>
                      <th scope="row" className="sticky left-0 z-10 border-b border-border bg-surface px-3 py-1.5 text-left font-normal text-text-primary">{p.label}</th>
                      {list.map((r) => {
                        const editing = draft?.id === r.id;
                        const on = editing ? draft.perms.has(p.name) : permissionsOf(r).includes(p.name);
                        return (
                          <td key={r.id} className={cn(cell, editing && 'bg-accent/5')}>
                            {editing ? (
                              <input type="checkbox" aria-label={`${r.name}: ${p.label}`} checked={on} onChange={() => toggle(p.name)} className="size-4 accent-[var(--accent)]" />
                            ) : on ? (
                              <><span aria-hidden="true" className="text-success">✓</span><span className="sr-only">{r.name} can: {p.label}</span></>
                            ) : (
                              <span className="sr-only">{r.name} cannot: {p.label}</span>
                            )}
                          </td>
                        );
                      })}
                      {draft && draft.id === null && (
                        <td className={cn(cell, 'bg-accent/5')}>
                          <input type="checkbox" aria-label={`New role: ${p.label}`} checked={draft.perms.has(p.name)} onChange={() => toggle(p.name)} className="size-4 accent-[var(--accent)]" />
                        </td>
                      )}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </SettingsCard>
    </div>
  );
};
