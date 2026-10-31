import React from 'react';
import { Link } from 'react-router-dom';
import { formatRelativeTime } from '@/lib/format';
import { Card, CardHeader } from './Card';
import type { DashboardData } from '../useDashboardData';

/** The audit trail as a plain ruled list: who, what, when. */
export const ActivityFeed: React.FC<{ d: DashboardData; co: string; index: number; className?: string }> = ({ d, co, index, className }) => (
  <Card index={index} className={className}>
    <CardHeader title="Recent activity" right={<Link to={`${co}/audit-log`} className="text-xs text-accent hover:underline">View all</Link>} />
    {d.activity.length === 0 ? (
      <p className="px-5 pb-6 text-[13px] text-text-muted">No activity yet.</p>
    ) : (
      <ul className="border-t border-border divide-y divide-border">
        {d.activity.map((e) => (
          <li key={e.id} className="px-5 py-2.5 flex items-baseline gap-4">
            <p className="flex-1 min-w-0 text-[13px] text-text-primary leading-snug">
              <span className="font-medium">{e.actor_name}</span> <span className="text-text-secondary">{e.detail.charAt(0).toLowerCase() + e.detail.slice(1)}</span>
            </p>
            <p className="shrink-0 text-xs text-text-muted tabular-nums whitespace-nowrap">
              {e.subject_number ? `${e.subject_number} · ` : ''}{formatRelativeTime(e.occurred_at)}
            </p>
          </li>
        ))}
      </ul>
    )}
  </Card>
);
