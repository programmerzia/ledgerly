/** Onboarding data (live mode only): what the server already holds for a company, and the writes of each step. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';
import { applyChartTemplate, createTaxCode, fetchChartTemplates, fetchTaxCodes, hasAccounts, type TaxCodeBody } from '@/api/live/setup';
import { fetchInvitations, fetchMembers } from '@/api/live/team';
import type { SetupState } from '@/api/adapters/onboarding';
import { accountsKey } from './accounts';
import { invitationsKey, useTenantId } from './team';
import { useAccess } from './menu';

export const chartTemplatesKey = (companyId: string) => ['chart-templates', companyId] as const;
export const taxCodesKey = (companyId: string) => ['tax-codes', companyId] as const;
export const setupKey = (companyId: string) => ['setup', companyId] as const;

/** Forbidden is an answer ("not yours to see"), not a failure. */
const orNull = async <T,>(p: Promise<T>): Promise<T | null> => {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ApiError && e.status === 403) return null;
    throw e;
  }
};

export function useSetupState(companyId: string, selfId: string) {
  const tenantId = useTenantId();
  // Members and invitations are for organisation owners and admins; for anyone else the call is a guaranteed 403 (plan 3c.24).
  const access = useAccess();
  const orgAdmin = access.orgAdmin;
  return useQuery({
    enabled: access.ready,
    queryKey: [...setupKey(companyId), tenantId, orgAdmin],
    retry: false,
    queryFn: async (): Promise<SetupState> => {
      const [accounts, taxCodes, members, invitations] = await Promise.all([
        hasAccounts(companyId),
        fetchTaxCodes(companyId),
        orgAdmin ? orNull(fetchMembers()) : Promise.resolve(null),
        orgAdmin ? orNull(fetchInvitations()) : Promise.resolve(null),
      ]);
      const teammates = members === null || invitations === null ? null : members.filter((m) => m.user_id !== selfId).length + invitations.length;
      return { hasAccounts: accounts, taxCodeCount: taxCodes.length, teammates };
    },
  });
}

export function useChartTemplates(companyId: string, enabled: boolean) {
  return useQuery({ queryKey: chartTemplatesKey(companyId), queryFn: () => fetchChartTemplates(companyId), enabled, retry: false });
}

export function useApplyChartTemplate(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => applyChartTemplate(companyId, code),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: setupKey(companyId) });
      await qc.invalidateQueries({ queryKey: accountsKey(companyId) });
    },
  });
}

export function useTaxCodes(companyId: string) {
  return useQuery({ queryKey: taxCodesKey(companyId), queryFn: () => fetchTaxCodes(companyId), retry: false });
}

export function useCreateTaxCode(companyId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TaxCodeBody) => createTaxCode(companyId, body),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: taxCodesKey(companyId) });
      await qc.invalidateQueries({ queryKey: setupKey(companyId) });
    },
  });
}

export { invitationsKey };
