/**
 * The bell, live side (3c.6). Polled every 45 seconds while the tab is visible (and once when it becomes visible
 * again), which is enough for an approval to show up without a websocket. Query key: ['notifications', companyId].
 * Mock mode never calls this: the shell keeps its local list.
 */
import { useCallback } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as live from '@/api/live/notifications';
import { toBellNotification, type BellNotification } from '@/api/adapters/notifications';
import { createIntent } from '@/api/idempotency';
import { IS_LIVE } from '@/api/config';
import { useActiveCompany } from './session';

export const POLL_MS = 45_000;

export function useLiveNotifications(coSlug: string): {
  notifications: BellNotification[];
  unreadTotal: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
} {
  const { company, known } = useActiveCompany();
  const qc = useQueryClient();
  const key = ['notifications', company.id] as const;
  const query = useQuery({
    queryKey: key,
    queryFn: () => live.listNotifications(company.id),
    enabled: IS_LIVE && known,
    retry: false,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
  const read = useMutation({
    mutationFn: (id: string) => live.markNotificationRead(company.id, id, createIntent()),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  const readAll = useMutation({
    mutationFn: () => live.markAllNotificationsRead(company.id, createIntent()),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  });
  const markRead = useCallback((id: string) => read.mutate(id), [read]);
  const markAllRead = useCallback(() => readAll.mutate(), [readAll]);
  return {
    notifications: (query.data?.items ?? []).map((n) => toBellNotification(n, coSlug)),
    unreadTotal: query.data?.unreadCount ?? 0,
    markRead,
    markAllRead,
  };
}
