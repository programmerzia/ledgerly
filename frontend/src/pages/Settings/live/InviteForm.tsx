/** Invite someone by email with an organisation role and, for members, a role in the chosen companies. Used by Settings → Team and onboarding. */
import React, { useState } from 'react';
import { ApiError } from '@/api/errors';
import { fieldError } from '@/api/messages';
import { ORG_ROLE_LABEL } from '@/api/adapters/member';
import { useInviteMember, useRoles } from '@/data/team';
import { Field, FormError, Loading, field, primary } from '@/components/live/form';
import { useCompanyList } from '@/data/session';

const ORG_ROLES = ['member', 'admin', 'owner'] as const;

export const InviteForm: React.FC<{ companyId: string; onInvited?: (email: string) => void }> = ({ companyId, onInvited }) => {
  const { companies } = useCompanyList();
  const roles = useRoles(companyId);
  const invite = useInviteMember();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<(typeof ORG_ROLES)[number]>('member');
  const [companyRole, setCompanyRole] = useState('');
  const [picked, setPicked] = useState<string[] | null>(null);
  const chosen = picked ?? [companyId];

  const roleNames = (roles.data ?? []).map((r) => r.name);
  const effectiveRole = companyRole || roleNames.find((n) => n === 'Accountant') || roleNames[0] || '';
  const error = invite.error;
  const known = ['email', 'role', 'company_role'].some((f) => fieldError(error, f)) || (error instanceof ApiError && ['company_role_required', 'role_not_found', 'already_member'].includes(error.code));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    invite.mutate(
      {
        email: email.trim(),
        role,
        company_role: role === 'member' ? effectiveRole : null,
        company_ids: role === 'member' ? chosen : undefined,
      },
      { onSuccess: () => { onInvited?.(email.trim()); setEmail(''); } },
    );
  };

  return (
    <form onSubmit={submit} className="flex max-w-md flex-col gap-4" aria-label="Invite someone">
      <Field id="invite-email" label="Email" error={fieldError(error, 'email')}>
        <input id="invite-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} required className={field} />
      </Field>
      <Field id="invite-role" label="Access to the organisation" error={fieldError(error, 'role')}>
        <select id="invite-role" value={role} onChange={(e) => setRole(e.target.value as typeof role)} className={field}>
          {ORG_ROLES.map((r) => <option key={r} value={r}>{ORG_ROLE_LABEL[r]}</option>)}
        </select>
      </Field>
      {role === 'member' && (
        <>
          <Field id="invite-company-role" label="Role in the company" error={fieldError(error, 'company_role')} hint="What they can do in the books. Owners and administrators can do everything.">
            {roles.isPending ? <Loading what="Loading roles" /> : roles.isError ? (
              <p role="alert" className="text-xs text-danger">Roles could not be loaded, so members cannot be invited right now.</p>
            ) : (
              <select id="invite-company-role" value={effectiveRole} onChange={(e) => setCompanyRole(e.target.value)} className={field}>
                {roleNames.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            )}
          </Field>
          {companies.length > 1 && (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-[13px] font-medium text-text-primary">Companies they can open</legend>
              {companies.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-[13px] text-text-secondary">
                  <input
                    type="checkbox"
                    checked={chosen.includes(c.id)}
                    onChange={(e) => setPicked(e.target.checked ? [...chosen, c.id] : chosen.filter((x) => x !== c.id))}
                  />
                  {c.name}
                </label>
              ))}
            </fieldset>
          )}
        </>
      )}
      <FormError error={known && !(error instanceof ApiError && error.code === 'already_member') ? null : error} />
      {error instanceof ApiError && error.code === 'already_member' && <p role="alert" className="text-[13px] text-danger">{email.trim() || 'That person'} is already in this organisation.</p>}
      {error instanceof ApiError && error.code === 'company_role_required' && <p role="alert" className="text-[13px] text-danger">Choose a role in the company for a member.</p>}
      <div>
        <button type="submit" disabled={invite.isPending || (role === 'member' && (roles.isPending || roles.isError || chosen.length === 0))} className={primary}>
          {invite.isPending ? 'Sending…' : 'Send invitation'}
        </button>
      </div>
    </form>
  );
};
