/**
 * Session seam: who is signed in, which organisations/companies they can reach, sign-out.
 *
 * Mock mode: the zustand session slice, exactly as before.
 * Live mode: GET /me + GET /companies through React Query. The result is mirrored into the zustand
 * session slice (`currentUser`, `currentCompany`, `isAuthenticated`) by `useLiveStoreSync`, so the 60+
 * files that still read those from the store see the real user and company without being touched.
 */
import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useLedgerStore } from '@/mock/store';
import type { Company } from '@/types';
import { fetchCompanies, fetchMe, logout, switchTenant } from '@/api/live/session';
import { currentTenant, toCompany, toUser } from '@/api/adapters/session';
import { setUnauthenticatedListener } from '@/api/http';
import { queryClient } from '@/api/queryClient';
import { selectByMode } from './select';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface CompanyChoice {
  id: string;
  slug: string;
  name: string;
  meta: string;
  currency: string;
}

export interface Organisation {
  id: string;
  name: string;
  current: boolean;
}

export interface CompanyList {
  companies: CompanyChoice[];
  /** Only live mode has organisations; mock returns an empty list and the menu hides the section. */
  organisations: Organisation[];
  /** Live: the current organisation lets this person add companies (`can.create_companies`). */
  canCreateCompany: boolean;
  switchCompany: (companyId: string) => void;
  switchOrganisation: (tenantId: string) => Promise<void>;
}

export const meKey = ['me'] as const;

/**
 * Drops everything cached for the signed-in user and records "no session". The `me` query itself is
 * kept (not removed): the route guard observes it, and removing a query mid-flight leaves it pending forever.
 */
export function forgetSession(qc: QueryClient): void {
  qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
  qc.setQueryData(meKey, null);
}
export const companiesKey = (tenantId: string) => ['companies', tenantId] as const;

/* ------------------------------------------------------------------ mock */

const MOCK_COMPANIES: CompanyChoice[] = [
  { id: 'co-1', slug: 'acme', name: 'Acme Trading Ltd', meta: 'Somalia', currency: 'USD' },
  { id: 'co-2', slug: 'acme-log', name: 'Acme Logistics', meta: 'Kenya', currency: 'KES' },
];

function useMockAuthStatus(): { status: AuthStatus; needsCompany: boolean } {
  const isAuthenticated = useLedgerStore((s) => s.isAuthenticated);
  return { status: isAuthenticated ? 'authenticated' : 'anonymous', needsCompany: false };
}

function useMockCompanyList(): CompanyList {
  const switchCompany = useLedgerStore((s) => s.switchCompany);
  return { companies: MOCK_COMPANIES, organisations: [], canCreateCompany: false, switchCompany, switchOrganisation: async () => {} };
}

function useMockSignOut(): () => Promise<void> {
  const logoutUser = useLedgerStore((s) => s.logoutUser);
  return async () => logoutUser();
}

/* ------------------------------------------------------------------ live */

export function useMe() {
  return useQuery({ queryKey: meKey, queryFn: fetchMe, staleTime: Infinity, retry: false });
}

function useLiveCompanies() {
  const me = useMe();
  const tenantId = me.data ? currentTenant(me.data)?.id : undefined;
  const q = useQuery({
    queryKey: companiesKey(tenantId ?? 'none'),
    queryFn: fetchCompanies,
    enabled: Boolean(tenantId),
  });
  return { me, tenantId, companies: q };
}

function useLiveAuthStatus(): { status: AuthStatus; needsCompany: boolean } {
  const { me, tenantId, companies } = useLiveCompanies();
  if (me.isPending) return { status: 'loading', needsCompany: false };
  if (!me.data) return { status: 'anonymous', needsCompany: false };
  if (tenantId && companies.isPending) return { status: 'loading', needsCompany: false };
  return { status: 'authenticated', needsCompany: (companies.data ?? []).length === 0 };
}

function useLiveCompanyList(): CompanyList {
  const qc = useQueryClient();
  const { me, tenantId, companies } = useLiveCompanies();
  const choices: CompanyChoice[] = (companies.data ?? []).map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    meta: c.country,
    currency: c.base_currency,
  }));
  const switchCompany = (companyId: string) => {
    const c = companies.data?.find((x) => x.id === companyId);
    if (c && tenantId) useLedgerStore.setState({ currentCompany: toCompany(c, tenantId) });
  };
  const switchOrg = useMutation({
    mutationFn: switchTenant,
    onSuccess: async (session) => {
      // Everything cached belongs to the previous organisation.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      qc.setQueryData(meKey, session);
    },
  });
  return {
    companies: choices,
    organisations: (me.data?.tenants ?? []).map((t) => ({ id: t.id, name: t.name, current: t.current })),
    canCreateCompany: Boolean(me.data?.tenants.find((t) => t.current)?.can.create_companies),
    switchCompany,
    switchOrganisation: async (tenantId) => {
      await switchOrg.mutateAsync(tenantId);
    },
  };
}

function useLiveSignOut(): () => Promise<void> {
  const qc = useQueryClient();
  return async () => {
    try {
      await logout();
    } finally {
      // Even if the call failed (already expired), the SPA is signed out locally.
      forgetSession(qc);
    }
  };
}

/**
 * The company named by the URL, from the company list. Unlike the mirrored store value it is right on the
 * first render after a reload, so screens that fetch by company id never ask for the previous one.
 */
export function useRouteCompany(): Company {
  const { co } = useParams();
  const { tenantId, companies } = useLiveCompanies();
  const fallback = useLedgerStore((s) => s.currentCompany);
  const found = companies.data?.find((c) => c.slug === co);
  return found && tenantId ? toCompany(found, tenantId) : fallback;
}

/** Mirrors the live session into the zustand slice for pages that have not been migrated yet. */
export function useLiveStoreSync(coSlug: string | undefined): { unknownCompany: boolean } {
  const { me, tenantId, companies } = useLiveCompanies();
  const user = me.data;
  const list = companies.data;
  const company = list?.find((c) => c.slug === coSlug) ?? undefined;

  useEffect(() => {
    if (user) useLedgerStore.setState({ currentUser: toUser(user), isAuthenticated: true });
    else useLedgerStore.setState({ isAuthenticated: false });
  }, [user]);

  useEffect(() => {
    if (company && tenantId) useLedgerStore.setState({ currentCompany: toCompany(company, tenantId) });
  }, [company, tenantId]);

  return { unknownCompany: Boolean(list) && !company };
}

/** A 401 from any call means the session is gone: forget everything and let the route guard redirect. */
export function installLiveSessionGuard(): void {
  setUnauthenticatedListener(() => {
    forgetSession(queryClient);
    useLedgerStore.setState({ isAuthenticated: false });
  });
}

export const useAuthStatus = selectByMode({ mock: useMockAuthStatus, live: useLiveAuthStatus });
export const useCompanyList = selectByMode({ mock: useMockCompanyList, live: useLiveCompanyList });
export const useSignOut = selectByMode({ mock: useMockSignOut, live: useLiveSignOut });

function useMockHomePath(): string | null {
  return `/${useLedgerStore((s) => s.currentCompany.slug)}/dashboard`;
}

/** Live: the last-used company if still reachable, else the first; /new-company when there is none. */
function useLiveHomePath(): string | null {
  const { companies } = useLiveCompanies();
  const preferred = useLedgerStore((s) => s.currentCompany);
  if (!companies.data) return null;
  if (companies.data.length === 0) return '/new-company';
  const pick = companies.data.find((c) => c.id === preferred.id) ?? companies.data[0];
  return `/${pick.slug}/dashboard`;
}

/** Where `/` and a finished sign-in should send the user; null while still unknown. */
export const useHomePath = selectByMode({ mock: useMockHomePath, live: useLiveHomePath });
