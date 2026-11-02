/** Tax codes and groups seam, live side: the whole list (active or not), and the writes. */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchAllPages } from '@/api/cursor';
import * as live from '@/api/live/trade';
import { toLiveTaxCode, toLiveTaxGroup, type ApiTaxCodeResource, type ApiTaxGroupResource, type LiveTaxCode, type LiveTaxGroup } from '@/api/adapters/tax';
import type { Intent } from '@/api/idempotency';
import { taxCodesKey } from './setup';
import { useRouteCompany } from './session';

export const taxGroupsKey = (companyId: string) => ['tax-groups', companyId] as const;

export function useAllTaxCodes() {
  const company = useRouteCompany();
  const q = useQuery({ queryKey: [...taxCodesKey(company.id), 'all'], queryFn: () => fetchAllPages((c) => live.listAllTaxCodes(company.id, c)) });
  const codes: LiveTaxCode[] = useMemo(() => (q.data ?? []).map(toLiveTaxCode), [q.data]);
  return { codes, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useTaxGroups() {
  const company = useRouteCompany();
  const q = useQuery({ queryKey: taxGroupsKey(company.id), queryFn: () => fetchAllPages((c) => live.listTaxGroups(company.id, c)) });
  const groups: LiveTaxGroup[] = useMemo(() => (q.data ?? []).map(toLiveTaxGroup), [q.data]);
  return { groups, isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export function useTaxActions() {
  const company = useRouteCompany();
  const qc = useQueryClient();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: taxCodesKey(company.id) });
    void qc.invalidateQueries({ queryKey: taxGroupsKey(company.id) });
    void qc.invalidateQueries({ queryKey: ['trade-refs', company.id] });
    void qc.invalidateQueries({ queryKey: ['setup', company.id] });
  };
  const code = async (p: Promise<ApiTaxCodeResource>): Promise<LiveTaxCode> => {
    const r = await p;
    refresh();
    return toLiveTaxCode(r);
  };
  const group = async (p: Promise<ApiTaxGroupResource>): Promise<LiveTaxGroup> => {
    const r = await p;
    refresh();
    return toLiveTaxGroup(r);
  };
  return {
    createCode: (body: unknown, intent: Intent) => code(live.createTaxCodeFull(company.id, body, intent)),
    updateCode: (id: string, body: unknown, intent: Intent) => code(live.updateTaxCode(company.id, id, body, intent)),
    addRate: (id: string, body: unknown, intent: Intent) => code(live.addTaxRate(company.id, id, body, intent)),
    deactivateCode: (id: string, version: number, intent: Intent) => code(live.deactivateTaxCode(company.id, id, version, intent)),
    createGroup: (body: unknown, intent: Intent) => group(live.createTaxGroup(company.id, body, intent)),
    updateGroup: (id: string, body: unknown, intent: Intent) => group(live.updateTaxGroup(company.id, id, body, intent)),
    deactivateGroup: (id: string, version: number, intent: Intent) => group(live.deactivateTaxGroup(company.id, id, version, intent)),
  };
}
