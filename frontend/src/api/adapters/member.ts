/** Members and roles for the Team screen. Role names per company come from the API; the SPA never maps them to permissions. */
import type { ApiMember, ApiRole } from '../live/team';

export interface MemberRow {
  userId: string;
  name: string;
  email: string;
  orgRole: string;
  status: string;
  /** Roles held in the company being shown. */
  companyRoles: string[];
}

export function toMemberRow(m: ApiMember, companyId: string): MemberRow {
  const byCompany = (m.company_roles ?? {}) as Record<string, unknown>;
  const mine = byCompany[companyId];
  return {
    userId: m.user_id,
    name: m.name,
    email: m.email,
    orgRole: m.role,
    status: m.status,
    companyRoles: Array.isArray(mine) ? mine.filter((r): r is string => typeof r === 'string') : [],
  };
}

/** Roles a member does not hold yet, for the "add role" choice. */
export function assignableRoles(roles: ApiRole[], held: string[]): ApiRole[] {
  return roles.filter((r) => !held.includes(r.name));
}

export const ORG_ROLE_LABEL: Record<string, string> = { owner: 'Owner', admin: 'Administrator', member: 'Member' };
