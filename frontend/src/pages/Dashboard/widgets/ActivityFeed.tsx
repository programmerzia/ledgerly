import React from 'react';
import { Link } from 'react-router-dom';
import { Activity, FileText, Lock, ShieldCheck, Landmark, BookOpen, Receipt } from 'lucide-react';
import { formatRelativeTime } from '@/lib/format';
import { Card, CardHeader, Avatar } from './Card';
import type { DashboardData } from '../useDashboardData';

function iconFor(action: string): React.ReactNode {
  if (action.startsWith('period')) return <Lock className="size-3.5" />;
  if (action.includes('invoice')) return <FileText className="size-3.5" />;
  if (action.includes('bill')) return <Receipt className="size-3.5" />;
  if (action.includes('bank')) return <Landmark className="size-3.5" />;
  if (action.includes('journal')) return <BookOpen className="size-3.5" />;
  if (action.includes('approv') || action.includes('sign')) return <ShieldCheck className="size-3.5" />;
  return <Activity className="size-3.5" />;
}

export const ActivityFeed: React.FC<{ d: DashboardData; co: string; index: number; className?: string }> = ({ d, co, index, className }) => (
  <Card index={index} className={className}>
    <CardHeader title="Recent activity" sub="Latest entries in the audit trail" right={<Link to={`${co}/audit-log`} className="text-xs text-accent hover:underline">View all</Link>} />
    {d.activity.length === 0 ? (
      <p className="text-xs text-text-muted py-10 text-center">No activity yet.</p>
    ) : (
      <ul className="px-5 pb-4 flex flex-col">
        {d.activity.map((e, i) => (
          <li key={e.id} className="relative flex gap-3 py-2.5">
            {i < d.activity.length - 1 && <span className="absolute left-4 top-11 bottom-0 w-px bg-border" aria-hidden />}
            <div className="relative shrink-0">
              <Avatar name={e.actor_name} size={32} />
              <span className="absolute -bottom-1 -right-1 size-4 rounded-full bg-surface border border-border text-text-muted flex items-center justify-center [&>svg]:size-2.5">{iconFor(e.action)}</span>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-text-primary leading-snug">
                <span className="font-medium">{e.actor_name}</span> <span className="text-text-secondary">{e.detail.charAt(0).toLowerCase() + e.detail.slice(1)}</span>
              </p>
              <p className="text-xs text-text-muted mt-0.5">{formatRelativeTime(e.occurred_at)}{e.subject_number ? ` · ${e.subject_number}` : ''}</p>
            </div>
          </li>
        ))}
      </ul>
    )}
  </Card>
);
