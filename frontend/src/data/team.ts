/**
 * Team data (live mode only; the mock has its own users page): members with their roles in the current
 * company, the company's roles, invitations. Query keys start with the resource, then the organisation or
 * company id, so an organisation or company switch drops them.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { currentTenant } from '@/api/adapters/session';
import { toMemberRow } from '@/api/adapters/member';
import {
  assignRole, createInvitation, createRole, deleteRole, fetchInvitations, fetchMembers, fetchPermissionModules, fetchRoles, resetRole, revokeInvitation,
  revokeRole, updateRole, type InviteBody,
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

export const permissionModulesKey = (companyId: string) => ['permission-modules', companyId] as const;

export function usePermissionModules(companyId: string, enabled = true) {
  return useQuery({ queryKey: permissionModulesKey(companyId), queryFn: () => fetchPermissionModules(companyId), enabled, retry: false, staleTime: 5 * 60_000 });
}

/** Role edits change what people can do, so the menu and permission hints are read again too. */
export function useRoleActions(companyId: string) {
  const qc = useQueryClient();
  const done = <T,>(p: Promise<T>): Promise<T> =>
    p.then(async (r) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: rolesKey(companyId) }),
        qc.invalidateQueries({ queryKey: ['members'] }),
        qc.invalidateQueries({ queryKey: ['menu', companyId] }),
      ]);
      return r;
    });
  return {
    create: (body: { name: string; permissions: string[] }) => done(createRole(companyId, body)),
    update: (roleId: string, body: { name?: string; permissions: string[] }) => done(updateRole(companyId, roleId, body)),
    reset: (roleId: string) => done(resetRole(companyId, roleId)),
    remove: (roleId: string) => done(deleteRole(companyId, roleId)),
  };
}

/** The company the live screens are looking at (from the URL). */
export const useCurrentCompany = useRouteCompany;
