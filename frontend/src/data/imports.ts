/**
 * Data imports, live side (step 3c.1). The mock wizard keeps its own state; the live wizard reads these hooks.
 * Query keys: ['imports', companyId, ...]. An import that is queued or applying is polled until it settles.
 */
import { useMemo } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { cursorPaging } from '@/api/cursor';
import * as live from '@/api/live/imports';
import { isWorking, type ApiImport } from '@/api/adapters/imports';
import type { Intent } from '@/api/idempotency';
import { useRouteCompany } from './session';

export const importsKey = (companyId: string) => ['imports', companyId] as const;

export function useImportKinds() {
  const { id } = useRouteCompany();
  return useQuery({ queryKey: [...importsKey(id), 'kinds'], queryFn: () => live.listKinds(id), retry: false, staleTime: 5 * 60_000 });
}

export function useRecentImports() {
  const { id } = useRouteCompany();
  return useQuery({ queryKey: [...importsKey(id), 'list'], queryFn: () => live.listImports(id), retry: false });
}

export function useImport(importId: string | undefined) {
  const { id } = useRouteCompany();
  return useQuery({
    queryKey: [...importsKey(id), 'one', importId],
    queryFn: () => live.getImport(id, importId as string),
    enabled: Boolean(importId),
    retry: false,
    refetchInterval: (q) => (q.state.data && isWorking(q.state.data.status) ? 1500 : false),
  });
}

/** Rows of an import, 50 at a time. `status` filters (valid, invalid, applied, failed). */
export function useImportRows(importId: string | undefined, status: string | undefined, enabled = true) {
  const { id } = useRouteCompany();
  return useInfiniteQuery({
    queryKey: [...importsKey(id), 'rows', importId, status ?? 'all'],
    queryFn: ({ pageParam }) => live.listRows(id, importId as string, status, pageParam),
    ...cursorPaging,
    enabled: enabled && Boolean(importId),
    retry: false,
  });
}

export function useImportActions() {
  const { id } = useRouteCompany();
  const qc = useQueryClient();
  return useMemo(() => {
    /** Keep the cache of the one import current, and drop its rows (their status changed) and the list. */
    const put = (imp: ApiImport, keepRows = false) => {
      qc.setQueryData([...importsKey(id), 'one', imp.id], imp);
      if (!keepRows) void qc.invalidateQueries({ queryKey: [...importsKey(id), 'rows', imp.id] });
      void qc.invalidateQueries({ queryKey: [...importsKey(id), 'list'] });
      return imp;
    };
    return {
      upload: (form: FormData, intent: Intent) => live.uploadImport(id, form, intent).then(put),
      setMapping: (importId: string, body: unknown, intent: Intent) => live.setMapping(id, importId, body, intent).then(put),
      preview: (importId: string, intent: Intent) => live.previewImport(id, importId, intent).then(put),
      apply: (importId: string, intent: Intent) => live.applyImport(id, importId, intent).then(put),
      purge: (importId: string, intent: Intent) => live.purgeImport(id, importId, intent).then(put),
    };
  }, [id, qc]);
}
