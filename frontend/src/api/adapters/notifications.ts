/** Notifications (3c.6): API resource to the bell's view type. */
import { formatRelativeTime } from '@/lib/format';

export type NotificationKind = 'approval' | 'period' | 'bank' | 'report' | 'import' | 'send';

export interface ApiNotification {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  subject_type: string | null;
  subject_id: string | null;
  link: string | null;
  read: boolean;
  created_at: string | null;
}

export interface BellNotification {
  id: string;
  title: string;
  desc: string;
  time: string;
  unread: boolean;
  link: string;
  kind: NotificationKind;
}

/** The bell groups the server's kinds into six looks. */
export function bellKind(kind: string): NotificationKind {
  if (kind.startsWith('approval') || kind === 'document_approved' || kind === 'document_returned') return 'approval';
  if (kind.startsWith('import')) return 'import';
  if (kind === 'report_ready') return 'report';
  if (kind === 'send_failed') return 'send';
  return 'period';
}

/** `link` is a path inside the company; the company slug goes in front. A notification with no link opens the approvals inbox. */
export function toBellNotification(n: ApiNotification, coSlug: string): BellNotification {
  return {
    id: n.id,
    title: n.title,
    desc: n.body ?? '',
    time: n.created_at ? formatRelativeTime(n.created_at) : '',
    unread: !n.read,
    link: `/${coSlug}/${(n.link ?? 'approvals').replace(/^\/+/, '')}`,
    kind: bellKind(n.kind),
  };
}
