/** Settings → Team: people in the organisation, their roles in this company, and invitations. */
import React, { useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { assignableRoles, ORG_ROLE_LABEL } from '@/api/adapters/member';
import { describeError } from '@/api/messages';
import { formatDate } from '@/lib/format';
import { useChangeRole, useCurrentCompany, useInvitations, useMembers, useRevokeInvitation, useRoles } from '@/data/team';
import { LoadError, Loading, secondary } from '@/components/live/form';
import { SettingsCard } from '../settings-ui';
import { InviteForm } from './InviteForm';

const Forbidden: React.FC = () => (
  <p role="alert" className="text-[13px] text-text-secondary">Only owners and administrators can manage the team. Ask one of them if you need a change.</p>
);

const isForbidden = (e: unknown) => e instanceof ApiError && e.status === 403;

export const LiveTeam: React.FC = () => {
  const company = useCurrentCompany();
  const members = useMembers(company.id);
  const roles = useRoles(company.id);
  const invitations = useInvitations();
  const change = useChangeRole(company.id);
  const revoke = useRevokeInvitation();
  const [sent, setSent] = useState<string | null>(null);

  if (isForbidden(members.error)) {
    return <SettingsCard title="Team"><Forbidden /></SettingsCard>;
  }

  const toggle = (userId: string, roleId: string, grant: boolean) =>
    change.mutate({ userId, roleId, grant }, { onError: (e) => toast.error(describeError(e)) });

  return (
    <div className="flex flex-col gap-5">
      <SettingsCard title="People" description={`Their roles here apply to ${company.name}. Each company has its own.`}>
        {members.isPending ? <Loading what="Loading people" /> : members.isError ? (
          <LoadError error={members.error} onRetry={() => void members.refetch()} />
        ) : members.data.length === 0 ? (
          <p className="text-[13px] text-text-muted">No one yet.</p>
        ) : (
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="text-xs text-text-muted"><th className="pb-2 font-medium">Name</th><th className="pb-2 font-medium">Organisation</th><th className="pb-2 font-medium">Roles in {company.name}</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.data.map((m) => {
                const addable = assignableRoles(roles.data ?? [], m.companyRoles);
                return (
                  <tr key={m.userId} data-member={m.email}>
                    <td className="py-2.5 pr-3 align-top">
                      <div className="font-medium text-text-primary">{m.name}</div>
                      <div className="text-xs text-text-muted">{m.email}</div>
                    </td>
                    <td className="py-2.5 pr-3 align-top text-text-secondary">{ORG_ROLE_LABEL[m.orgRole] ?? m.orgRole.replace(/_/g, ' ')}{m.status !== 'active' ? ` (${m.status.replace(/_/g, ' ')})` : ''}</td>
                    <td className="py-2.5 align-top">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {m.companyRoles.length === 0 && <span className="text-text-muted">None</span>}
                        {m.companyRoles.map((name) => {
                          const role = roles.data?.find((r) => r.name === name);
                          return (
                            <span key={name} className="inline-flex items-center gap-1 rounded border border-border bg-canvas px-1.5 py-0.5 text-xs text-text-primary">
                              {name}
                              {role && (
                                <button type="button" aria-label={`Remove ${name} from ${m.name}`} disabled={change.isPending} onClick={() => toggle(m.userId, role.id, false)} className="text-text-muted hover:text-danger cursor-pointer">×</button>
                              )}
                            </span>
                          );
                        })}
                        {addable.length > 0 && (
                          <select
                            aria-label={`Add a role for ${m.name}`}
                            value=""
                            disabled={change.isPending}
                            onChange={(e) => e.target.value && toggle(m.userId, e.target.value, true)}
                            className="h-7 rounded border border-border bg-surface px-1.5 text-xs text-text-secondary"
                          >
                            <option value="">Add role…</option>
                            {addable.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                          </select>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </SettingsCard>

      <SettingsCard title="Invitations" description="An invitation is a link sent by email. It works for 7 days.">
        {invitations.isPending ? <Loading what="Loading invitations" /> : invitations.isError ? (
          isForbidden(invitations.error) ? <Forbidden /> : <LoadError error={invitations.error} onRetry={() => void invitations.refetch()} />
        ) : invitations.data.length === 0 ? (
          <p className="text-[13px] text-text-muted">No open invitations.</p>
        ) : (
          <ul className="divide-y divide-border">
            {invitations.data.map((i) => (
              <li key={i.id} data-invitation={i.email} className="flex items-center gap-3 py-2.5 text-[13px]">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-text-primary truncate">{i.email}</div>
                  <div className="text-xs text-text-muted">{i.company_role ?? ORG_ROLE_LABEL[i.role] ?? i.role.replace(/_/g, ' ')} · expires {formatDate(i.expires_at)}</div>
                </div>
                {i.can.revoke && (
                  <button type="button" disabled={revoke.isPending} onClick={() => revoke.mutate(i.id, { onError: (e) => toast.error(describeError(e)) })} className={`${secondary} h-7 px-2.5 text-xs`}>Withdraw</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </SettingsCard>

      <SettingsCard title="Invite someone">
        {sent && <p role="status" className="mb-4 text-[13px] text-text-primary">Invitation sent to {sent}.</p>}
        <InviteForm companyId={company.id} onInvited={setSent} />
      </SettingsCard>
    </div>
  );
};
