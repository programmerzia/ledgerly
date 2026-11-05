/** The organisation page (plan 3c.26): profile and the companies the person can open. */
import { http } from '../http';

export interface OrgCompany {
  id: string;
  name: string;
  legal_name: string | null;
  slug: string;
  country: string;
  base_currency: string;
  status: string;
}

export interface OrgProfile {
  id: string;
  name: string;
  slug: string;
  created_at: string | null;
  members: number;
  companies: OrgCompany[];
  can: { update: boolean };
}

export async function fetchOrganisation(): Promise<OrgProfile> {
  const res = await http.get('/v1/organisation');
  return res.data as unknown as OrgProfile;
}

export async function renameOrganisation(name: string): Promise<OrgProfile> {
  const res = await http.put('/v1/organisation', { body: { name } });
  return res.data as unknown as OrgProfile;
}
