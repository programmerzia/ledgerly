/**
 * Dimensions (tracking categories) are live-only: the mock has a stub in Settings, so the screen that uses these is
 * registered for live mode only. Query key: ['dimensions', companyId].
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '@/api/http';
import { toDimension, type LiveDimension } from '@/api/adapters/dimension';
import { createIntent, type Intent } from '@/api/idempotency';
import { Handled, handleVersionConflict } from '@/api/live/writeProblems';
import { useActiveCompany } from './session';
import type { DataResult } from './types';

export const dimensionsKey = (companyId: string) => ['dimensions', companyId] as const;

export function useDimensions(): DataResult<LiveDimension[]> {
  const { company, known } = useActiveCompany();
  const q = useQuery({
    enabled: known,
    queryKey: dimensionsKey(company.id),
    queryFn: async () => {
      const res = await http.get('/v1/companies/{company}/dimensions', { path: { company: company.id } });
      return res.data.map(toDimension);
    },
  });
  return { data: q.data ?? [], isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

export interface DimensionActions {
  createDimension: (f: { code: string; name: string }, intent?: Intent) => Promise<void>;
  renameDimension: (d: LiveDimension, name: string, intent?: Intent) => Promise<void>;
  deactivateDimension: (d: LiveDimension, intent?: Intent) => Promise<void>;
  createValue: (d: LiveDimension, f: { code: string; name: string; parent_id?: string | null }, intent?: Intent) => Promise<void>;
  renameValue: (d: LiveDimension, valueId: string, version: number, name: string, intent?: Intent) => Promise<void>;
  deactivateValue: (d: LiveDimension, valueId: string, version: number, intent?: Intent) => Promise<void>;
}

export function useDimensionActions(): DimensionActions {
  const client = useQueryClient();
  const { company } = useActiveCompany();
  const path = { company: company.id };
  const key = dimensionsKey(company.id);
  const run = async (subject: string, id: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      if (handleVersionConflict(e, { subject, documentId: id, local: null, client, keys: [key] })) throw new Handled(e);
      throw e;
    }
    await client.invalidateQueries({ queryKey: key });
  };
  return {
    createDimension: (f, intent = createIntent()) => run('Dimension', 'new', () => http.post('/v1/companies/{company}/dimensions', { path, body: { code: f.code.trim(), name: f.name.trim() }, intent })),
    renameDimension: (d, name, intent = createIntent()) =>
      run(`Dimension ${d.code}`, d.id, () =>
        http.put('/v1/companies/{company}/dimensions/{dimension}', { path: { ...path, dimension: d.id }, body: { name: name.trim(), version: d.version } as never, intent }),
      ),
    deactivateDimension: (d, intent = createIntent()) =>
      run(`Dimension ${d.code}`, d.id, () => http.post('/v1/companies/{company}/dimensions/{dimension}/deactivate', { path: { ...path, dimension: d.id }, body: { version: d.version }, intent })),
    createValue: (d, f, intent = createIntent()) =>
      run(`Dimension ${d.code}`, d.id, () =>
        http.post('/v1/companies/{company}/dimensions/{dimension}/values', {
          path: { ...path, dimension: d.id },
          body: { code: f.code.trim(), name: f.name.trim(), parent_id: f.parent_id ?? null },
          intent,
        }),
      ),
    renameValue: (d, valueId, version, name, intent = createIntent()) =>
      run(`Value in ${d.code}`, valueId, () =>
        http.put('/v1/companies/{company}/dimensions/{dimension}/values/{dimensionValue}', {
          path: { ...path, dimension: d.id, dimensionValue: valueId },
          body: { name: name.trim(), version } as never,
          intent,
        }),
      ),
    deactivateValue: (d, valueId, version, intent = createIntent()) =>
      run(`Value in ${d.code}`, valueId, () =>
        http.post('/v1/companies/{company}/dimensions/{dimension}/values/{dimensionValue}/deactivate', {
          path: { ...path, dimension: d.id, dimensionValue: valueId },
          body: { version },
          intent,
        }),
      ),
  };
}
