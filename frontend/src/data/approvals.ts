/** Approvals inbox, live side (docs/15). One list from GET /approvals; the server decides what the person could sign now. */
import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLedgerStore } from '@/mock/store';
import { fetchAllPages } from '@/api/cursor';
import * as live from '@/api/live/journals';
import { toApprovalItem, toBulkResult, type ApprovalItem, type BulkResultRow } from '@/api/adapters/journal';
import type { Intent } from '@/api/idempotency';
import { approvalsKey, journalsKey } from './journals';
import type { DataResult } from './types';

export function useApprovalInbox(): DataResult<ApprovalItem[]> {
  const company = useLedgerStore((s) => s.currentCompany);
  const q = useQuery({
    queryKey: approvalsKey(company.id),
    queryFn: async () => (await fetchAllPages((cursor) => live.listApprovals(company.id, cursor))).map(toApprovalItem),
  });
  return { data: q.data ?? [], isLoading: q.isLoading, error: q.error, refetch: () => void q.refetch() };
}

/**
 * Names for the people behind a request. GET /members is for owners and admins only, so an approver gets nothing
 * back and the screen says "a colleague" rather than inventing a name.
 */
export function useMemberNames(): Map<string, string> {
  const company = useLedgerStore((s) => s.currentCompany);
  const q = useQuery({ queryKey: ['members', company.id], queryFn: live.listMembers, retry: false, staleTime: 5 * 60_000 });
  return useMemo(() => new Map((q.data ?? []).map((m) => [m.user_id, m.name])), [q.data]);
}

export function useBulkApprove() {
  const company = useLedgerStore((s) => s.currentCompany);
  const qc = useQueryClient();
  return async (items: ApprovalItem[], intent: Intent): Promise<BulkResultRow[]> => {
    const res = await live.bulkApprove(company.id, items.map((i) => ({ type: i.api_type, id: i.document_id })), intent);
    void qc.invalidateQueries({ queryKey: approvalsKey(company.id) });
    void qc.invalidateQueries({ queryKey: journalsKey(company.id) });
    return res.data.map(toBulkResult);
  };
}
