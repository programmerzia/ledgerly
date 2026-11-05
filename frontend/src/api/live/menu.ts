/** The company menu and the person's permission names in it (plan 3c.24). Convenience for the SPA: the server still refuses what a role may not do. */
import { http } from '../http';

export interface ApiMenuItem {
  key: string;
  label: string;
  icon: string;
  /** Path under /{company}. */
  route: string;
  module: string | null;
}

export interface ApiMenuSection {
  key: string;
  title: string | null;
  collapsed: boolean;
  items: ApiMenuItem[];
}

export interface ApiMenu {
  sections: ApiMenuSection[];
  /** Company permission names the signed-in person holds here. */
  permissions: string[];
  org_admin: boolean;
}

export async function fetchMenu(companyId: string): Promise<ApiMenu> {
  const res = await http.get('/v1/companies/{company}/menu', { path: { company: companyId } });
  return res.data as unknown as ApiMenu;
}
