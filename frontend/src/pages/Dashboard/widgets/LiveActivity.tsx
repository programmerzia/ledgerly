import React from 'react';
import { Link } from 'react-router-dom';
import { formatRelativeTime } from '@/lib/format';
import { actorLabel, type AuditRow } from '@/api/adapters/admin';
import { Card, CardHeader } from './Card';

const numberOf = (e: AuditRow): string => {
  const n = (e.after ?? e.before)?.number;
  return typeof n === 'string' ? n : '';
};

/** The newest audit events as a plain ruled list: what happened, to what, when. */
export const LiveActivity: React.FC<{ rows: AuditRow[]; co: string; className?: string }> = ({ rows, co, className }) => (
  <Card className={className}>
    <CardHeader title="Recent activity" right={<Link to={`${co}/audit-log`} className="text-xs text-accent hover:underline">View all</Link>} />
    {rows.length === 0 ? (
      <p className="px-5 pb-6 text-[13px] text-text-muted">No activity yet.</p>
    ) : (
      <ul className="border-t border-border divide-y divide-border">
        {rows.map((e) => (
          <li key={e.id} className="px-5 py-2.5 flex items-baseline gap-4">
            <p className="flex-1 min-w-0 text-[13px] text-text-primary leading-snug truncate">
              <span className="font-medium">{e.actionText}</span>{numberOf(e) && <span className="text-text-secondary"> {numberOf(e)}</span>}<span className="text-text-muted"> by {actorLabel(e)}</span>
            </p>
            <p className="shrink-0 text-xs text-text-muted tabular-nums whitespace-nowrap">{e.at ? formatRelativeTime(e.at) : ''}</p>
          </li>
        ))}
      </ul>
    )}
  </Card>
);
