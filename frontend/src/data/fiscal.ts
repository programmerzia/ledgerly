/**
 * Fiscal years, periods, close checks and reopen requests (live). The mock Periods page keeps reading the store;
 * the live page (LivePeriods) uses these. Query keys: ['fiscal-years', companyId], ['close-checks', companyId, periodId].
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '@/api/http';
import { toFiscalYear, toCloseCheck, toCloseBody, toPeriod, toReopenRequest, type LiveFiscalYear, type LiveCloseCheck, type LivePeriod, type LiveReopenRequest } from '@/api/adapters/fiscal';
import { createIntent, type Intent } from '@/api/idempotency';
import { useActiveCompany } from './session';
import type { DataResult } from './types';

export const fiscalYearsKey = (companyId: string) => ['fiscal-years', companyId] as const;
export const closeChecksKey = (companyId: string, periodId: string) => ['close-checks', companyId, periodId] as const;

export function useFiscalYears(): DataResult<LiveFiscalYear[]> {
  const { company, known } = useActiveCompany();
  const q = useQuery({
    enabled: known,
    queryKey: fiscalYearsKey(company.id),
    queryFn: async () => {
      const res = await http.get('/v1/companies/{company}/fiscal-years', { path: { company: company.id } });
      return res.data.map(toFiscalYear);
    },
  });
  return { data: q.data ?? [], isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

/** The checklist preview is read-only and writes nothing (FiscalApiTest). Needs period-close permission, else 403. */
export function useCloseChecks(periodId: string | undefined, enabled: boolean): DataResult<LiveCloseCheck[]> {
  const { company, known } = useActiveCompany();
  const q = useQuery({
    queryKey: closeChecksKey(company.id, periodId ?? 'none'),
    enabled: known && enabled && Boolean(periodId),
    queryFn: async () => {
      const res = await http.get('/v1/companies/{company}/fiscal-periods/{fiscalPeriod}/close-checks', { path: { company: company.id, fiscalPeriod: periodId! } });
      return res.data.map(toCloseCheck);
    },
  });
  return { data: q.data ?? [], isLoading: q.isLoading && q.fetchStatus !== 'idle', error: q.error, refetch: () => void q.refetch() };
}

export interface FiscalActions {
  softClose: (p: LivePeriod, intent?: Intent) => Promise<void>;
  close: (p: LivePeriod, waivers: Record<string, string>, intent?: Intent) => Promise<void>;
  requestReopen: (p: LivePeriod, reason: string, intent?: Intent) => Promise<LiveReopenRequest>;
  approveReopen: (r: LiveReopenRequest, intent?: Intent) => Promise<LiveReopenRequest>;
  rejectReopen: (r: LiveReopenRequest, comment: string, intent?: Intent) => Promise<LiveReopenRequest>;
  yearEnd: (y: LiveFiscalYear, intent?: Intent) => Promise<{ closingJournalId: string | null }>;
  lockYear: (y: LiveFiscalYear, intent?: Intent) => Promise<void>;
}

/**
 * Writes. Signing is NOT handled here: a 403 signature_required propagates so the page's signed runner can verify
 * the PIN and call the same function again with the same intent.
 */
export function useFiscalActions(): FiscalActions {
  const client = useQueryClient();
  const { company } = useActiveCompany();
  const path = { company: company.id };
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: fiscalYearsKey(company.id) });
    await client.invalidateQueries({ queryKey: ['close-checks', company.id] });
  };
  return {
    softClose: async (p, intent = createIntent()) => {
      await http.post('/v1/companies/{company}/fiscal-periods/{fiscalPeriod}/soft-close', { path: { ...path, fiscalPeriod: p.id }, body: {} as never, intent });
      await refresh();
    },
    close: async (p, waivers, intent = createIntent()) => {
      await http.post('/v1/companies/{company}/fiscal-periods/{fiscalPeriod}/close', {
        path: { ...path, fiscalPeriod: p.id },
        body: toCloseBody(waivers),
        intent,
      });
      await refresh();
    },
    requestReopen: async (p, reason, intent = createIntent()) => {
      const res = await http.post('/v1/companies/{company}/fiscal-periods/{fiscalPeriod}/reopen-requests', { path: { ...path, fiscalPeriod: p.id }, body: { reason }, intent });
      await refresh();
      return toReopenRequest(res.data);
    },
    approveReopen: async (r, intent = createIntent()) => {
      const res = await http.post('/v1/companies/{company}/reopen-requests/{reopenRequest}/approve', { path: { ...path, reopenRequest: r.id }, body: {} as never, intent });
      await refresh();
      return toReopenRequest(res.data);
    },
    rejectReopen: async (r, comment, intent = createIntent()) => {
      const res = await http.post('/v1/companies/{company}/reopen-requests/{reopenRequest}/reject', { path: { ...path, reopenRequest: r.id }, body: { comment }, intent });
      await refresh();
      return toReopenRequest(res.data);
    },
    yearEnd: async (y, intent = createIntent()) => {
      const res = (await http.post('/v1/companies/{company}/fiscal-years/{fiscalYear}/year-end-close', { path: { ...path, fiscalYear: y.id }, body: {} as never, intent })) as unknown as {
        meta?: { closing_journal_id?: string };
      };
      await refresh();
      return { closingJournalId: res.meta?.closing_journal_id ?? null };
    },
    lockYear: async (y, intent = createIntent()) => {
      await http.post('/v1/companies/{company}/fiscal-years/{fiscalYear}/lock', { path: { ...path, fiscalYear: y.id }, body: {} as never, intent });
      await refresh();
    },
  };
}

export { toPeriod };
