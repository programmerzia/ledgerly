/** Live team calls: members and their company roles, invitations (both the admin side and the emailed link). */
import { http } from '../http';
import type { components } from '../schema';

export type ApiMember = components['schemas']['MemberResource'];
export type ApiRole = components['schemas']['RoleResource'];
export type ApiInvitation = components['schemas']['InvitationResource'];
export type ApiInvitationPreview = components['schemas']['InvitationPreviewResource'];
export type InviteBody = components['schemas']['InviteMemberRequest'];

export async function fetchMembers(): Promise<ApiMember[]> {
  return (await http.get('/v1/members')).data;
}

export async function fetchRoles(companyId: string): Promise<ApiRole[]> {
  return (await http.get('/v1/companies/{company}/roles', { path: { company: companyId } })).data;
}

export async function assignRole(companyId: string, userId: string, roleId: string): Promise<ApiMember> {
  return (await http.put('/v1/companies/{company}/members/{user}/roles/{role}', { path: { company: companyId, user: userId, role: roleId } })).data;
}

export async function revokeRole(companyId: string, userId: string, roleId: string): Promise<ApiMember> {
  return (await http.delete('/v1/companies/{company}/members/{user}/roles/{role}', { path: { company: companyId, user: userId, role: roleId } })).data;
}

export async function fetchInvitations(): Promise<ApiInvitation[]> {
  return (await http.get('/v1/invitations')).data;
}

export async function createInvitation(body: InviteBody): Promise<ApiInvitation> {
  return (await http.post('/v1/invitations', { body })).data;
}

export async function revokeInvitation(id: string): Promise<void> {
  await http.delete('/v1/invitations/{invitation}', { path: { invitation: id } });
}

export async function previewInvitation(token: string): Promise<ApiInvitationPreview> {
  return (await http.get('/v1/invitation-tokens/{token}', { path: { token } })).data;
}

/** A new person sends name and password; someone with an account who is signed in as the invitee sends nothing. */
export async function acceptInvitation(token: string, body?: { name: string; password: string; password_confirmation: string }): Promise<{ tenant_id: string; organisation: string }> {
  const res = await http.send<{ data: { tenant_id: string; organisation: string } }>('POST', `/v1/invitation-tokens/${encodeURIComponent(token)}/accept`, body ?? {});
  return res.data;
}

export interface PermissionRow { name: string; label: string }
export interface PermissionModule { key: string; label: string; permissions: PermissionRow[] }

/** Every matrix permission by module with a plain-language label: the rows of the role grid. */
export async function fetchPermissionModules(companyId: string): Promise<PermissionModule[]> {
  return (await http.get('/v1/companies/{company}/permissions', { path: { company: companyId } })).data as unknown as PermissionModule[];
}

export async function createRole(companyId: string, body: { name: string; permissions: string[] }): Promise<ApiRole> {
  return (await http.post('/v1/companies/{company}/roles', { path: { company: companyId }, body })).data;
}

export async function updateRole(companyId: string, roleId: string, body: { name?: string; permissions: string[] }): Promise<ApiRole> {
  return (await http.put('/v1/companies/{company}/roles/{role}', { path: { company: companyId, role: roleId }, body: body as { name: string; permissions: string[] } })).data;
}

export async function resetRole(companyId: string, roleId: string): Promise<ApiRole> {
  return (await http.post('/v1/companies/{company}/roles/{role}/reset', { path: { company: companyId, role: roleId } })).data;
}

export async function deleteRole(companyId: string, roleId: string): Promise<void> {
  await http.delete('/v1/companies/{company}/roles/{role}', { path: { company: companyId, role: roleId } });
}
