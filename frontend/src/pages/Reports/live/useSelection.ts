import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { localDateISO } from '@/api/adapters/onboarding';
import type { ReportSelection } from '@/api/adapters/report';
import { resolveSelection, selectionToSearch, type ReportKind } from '@/api/adapters/reportSelection';
import { useReportPeriods } from '@/data/reports';

const OWN_KEYS = ['period', 'from', 'to', 'asof', 'basis', 'cmp', 'zero', 'account', 'contact', 'budget', 'view', 'by'];

/** The report's parameters, kept in the query string. `ready` is false until the periods are known (for the default). */
export function useReportSelection(kind: ReportKind, hideZero = false) {
  const [sp, setSp] = useSearchParams();
  const { periods, isLoading } = useReportPeriods();
  const today = localDateISO();
  const hasWhen = sp.has('period') || sp.has('asof') || sp.has('to');
  const selection = useMemo(() => resolveSelection(sp, kind, periods, today, hideZero), [sp, kind, periods, today, hideZero]);
  const set = useCallback(
    (next: ReportSelection) => {
      // Keep whatever else the page keeps in its query string (the aging side, for one).
      const merged = new URLSearchParams(sp);
      for (const k of [...merged.keys()]) if (OWN_KEYS.includes(k) || k.startsWith('d.')) merged.delete(k);
      selectionToSearch(next).forEach((v, k) => merged.set(k, v));
      setSp(merged, { replace: true });
    },
    [sp, setSp],
  );
  return { selection, set, periods, today, ready: hasWhen || kind === 'asof' || !isLoading };
}
