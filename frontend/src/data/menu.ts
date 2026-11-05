/**
 * The company menu and permission hints (plan 3c.24). Live mode reads GET /companies/{company}/menu once per company; mock mode has no
 * server, so it allows everything and the menu stays on nav.ts. Screens use `useAccess().can(...)` only to skip calls their role cannot
 * make; the server decides, so a stale or missing hint can never grant anything.
 */
import { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { IS_LIVE } from '@/api/config';
import { fetchMenu } from '@/api/live/menu';
import { useActiveCompany } from './session';

export const menuKey = (companyId: string) => ['menu', companyId] as const;

export function useCompanyMenu() {
  const { company, known } = useActiveCompany();
  return useQuery({ queryKey: menuKey(company.id), queryFn: () => fetchMenu(company.id), enabled: IS_LIVE && known, retry: false, staleTime: 60_000 });
}

export interface Access {
  /** False until the hints arrive (live). Calls gated on a hint wait for it. */
  ready: boolean;
  can: (permission: string) => boolean;
  /** Organisation owner or admin: members, invitations and API clients. */
  orgAdmin: boolean;
}

export function useAccess(): Access {
  const menu = useCompanyMenu();
  const held = useMemo(() => new Set(menu.data?.permissions ?? []), [menu.data]);
  const can = useCallback((permission: string) => !IS_LIVE || held.has(permission), [held]);
  if (!IS_LIVE) return { ready: true, can, orgAdmin: true };
  return { ready: menu.isSuccess, can, orgAdmin: menu.data?.org_admin ?? false };
}
