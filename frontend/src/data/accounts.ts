/**
 * Seam for the chart of accounts. Pages call `useAccounts()` and never know which side answers:
 * mock mode reads the zustand store (unchanged behaviour), live mode reads GET /companies/{id}/accounts
 * through React Query and adapts to the view type. Chosen once, at module load, from VITE_API_MODE.
 */
import { useQuery } from '@tanstack/react-query';
import { selectByMode } from './select';
import { http } from '@/api/http';
import { fetchAllPages } from '@/api/cursor';
import { toAccount } from '@/api/adapters/account';
import { useLedgerStore } from '@/mock/store';
import type { Account } from '@/types';
import type { DataResult } from './types';

export function useMockAccounts(): DataResult<Account[]> {
  const accounts = useLedgerStore((s) => s.accounts);
  return { data: accounts, isLoading: false, error: null, refetch: () => {} };
}

export const accountsKey = (companyId: string) => ['accounts', companyId] as const;

export function useLiveAccounts(): DataResult<Account[]> {
  const company = useLedgerStore((s) => s.currentCompany);
  const q = useQuery({
    queryKey: accountsKey(company.id),
    queryFn: async () => {
      const rows = await fetchAllPages((cursor) =>
        http.get('/v1/companies/{company}/accounts', { path: { company: company.id }, query: { cursor, limit: 200 } }),
      );
      return rows.map((a) => toAccount(a, { tenantId: company.tenant_id, companyId: company.id }));
    },
  });
  return { data: q.data ?? [], isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export const useAccounts: () => DataResult<Account[]> = selectByMode({ mock: useMockAccounts, live: useLiveAccounts });
