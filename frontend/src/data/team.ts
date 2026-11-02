/**
 * Team data (live mode only; the mock has its own users page): members with their roles in the current
 * company, the company's roles, invitations. Query keys start with the resource, then the organisation or
 * company id, so an organisation or company switch drops them.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currentTenant } from '@/api/adapters/session';
import { toMemberRow } from '@/api/adapters/member';
import {
  assignRole, createInvitation, fetchInvitations, fetchMembers, fetchRoles, revokeInvitation, revokeRole, type InviteBody,
} from '@/api/live/team';
import { useMe, useRouteCompany } from './session';

export function useTenantId(): string {
  const me = useMe();
  return (me.data ? currentTenant(me.data)?.id : undefined) ?? 'none';
}

export const membersKey = (tenantId: string, companyId: string) => ['members', tenantId, companyId] as const;
export const rolesKey = (companyId: string) => ['roles', companyId] as const;
export const invitationsKey = (tenantId: string) => ['invitations', tenantId] as const;

export function useMembers(companyId: string, enabled = true) {
  const tenantId = useTenantId();
  return useQuery({
    queryKey: membersKey(tenantId, companyId),
    queryFn: async () => (await fetchMembers()).map((m) => toMemberRow(m, companyId)),
    enabled,
    retry: false,
  });
}

export function useRoles(companyId: string, enabled = true) {
  return useQuery({ queryKey: rolesKey(companyId), queryFn: () => fetchRoles(companyId), enabled, retry: false });
}

export function useInvitations(enabled = true) {
  const tenantId = useTenantId();
  return useQuery({ queryKey: invitationsKey(tenantId), queryFn: fetchInvitations, enabled, retry: false });
}

export function useInviteMember() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  return useMutation({
    mutationFn: (body: InviteBody) => createInvitation(body),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: invitationsKey(tenantId) }), qc.invalidateQueries({ queryKey: ['setup'] })]),
  });
}

export function useRevokeInvitation() {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  return useMutation({
    mutationFn: (id: string) => revokeInvitation(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: invitationsKey(tenantId) }),
  });
}

export function useChangeRole(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, roleId, grant }: { userId: string; roleId: string; grant: boolean }) =>
      grant ? assignRole(companyId, userId, roleId) : revokeRole(companyId, userId, roleId),
    onSuccess: () => Promise.all([qc.invalidateQueries({ queryKey: ['members'] }), qc.invalidateQueries({ queryKey: rolesKey(companyId) })]),
  });
}

/** The company the live screens are looking at (from the URL). */
export const useCurrentCompany = useRouteCompany;
