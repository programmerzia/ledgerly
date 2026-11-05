/** Document numbering, live mode (plan 3c.17). Key: ['numbering', companyId]. */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Intent } from '@/api/idempotency';
import * as api from '@/api/live/numbering';
import { useRouteCompany } from './session';

export const numberingKey = (companyId: string) => ['numbering', companyId] as const;

export function useNumbering() {
  const company = useRouteCompany();
  return useQuery({ queryKey: numberingKey(company.id), queryFn: () => api.fetchNumbering(company.id), retry: false });
}

export function useNumberingActions() {
  const company = useRouteCompany();
  const qc = useQueryClient();
  return {
    set: async (kind: string, body: { prefix: string; padding: number; version?: number | null }, intent?: Intent) => {
      const r = await api.setNumbering(company.id, kind, body, intent);
      qc.setQueryData(numberingKey(company.id), r.overview);
      return r.meta;
    },
  };
}
