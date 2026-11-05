import React, { useState } from 'react';
import { Bell, CheckCheck, CheckSquare, Calendar, Landmark, BellOff, FileDown, Upload, MailWarning } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { ICON_BTN } from './TopBarWidgets';

export interface AppNotification {
  id: string;
  title: string;
  desc: string;
  time: string;
  unread: boolean;
  link: string;
  kind: 'approval' | 'period' | 'bank' | 'report' | 'import' | 'send';
}

/** Live mode: the list comes from the server, read marks go back to it. `unreadTotal` counts beyond the loaded page. */
export interface LiveBell {
  unreadTotal: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
}

const KIND = {
  approval: { icon: CheckSquare, tone: 'bg-warning-soft text-warning' },
  period: { icon: Calendar, tone: 'bg-accent-soft text-accent' },
  bank: { icon: Landmark, tone: 'bg-success-soft text-success' },
  report: { icon: FileDown, tone: 'bg-success-soft text-success' },
  import: { icon: Upload, tone: 'bg-accent-soft text-accent' },
  send: { icon: MailWarning, tone: 'bg-danger-soft text-danger' },
} as const;

interface Props {
  notifications: AppNotification[];
  setNotifications: React.Dispatch<React.SetStateAction<AppNotification[]>>;
  onNavigate: (to: string) => void;
  liveBell?: LiveBell;
}

export const NotificationsMenu: React.FC<Props> = ({ notifications, setNotifications, onNavigate, liveBell }) => {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const unread = liveBell ? liveBell.unreadTotal : notifications.filter((n) => n.unread).length;
  const list = tab === 'unread' ? notifications.filter((n) => n.unread) : notifications;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} className={ICON_BTN}>
              <Bell className="size-4" />
              {unread > 0 && (
                <span className="absolute top-1 right-1 min-w-4 h-4 px-1 grid place-items-center rounded-[3px] bg-accent text-white text-[10px] font-medium leading-none ring-2 ring-surface">
                  {unread}
                </span>
              )}
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>Notifications</TooltipContent>
      </Tooltip>
      <PopoverContent align="end" sideOffset={8} className="w-[380px] max-w-[calc(100vw-1rem)] p-0 overflow-hidden">
        <div className="flex items-center justify-between px-4 pt-3 pb-2">
          <h3 className="text-sm font-semibold text-text-primary">Notifications</h3>
          <button
            type="button"
            disabled={unread === 0}
            onClick={() => (liveBell ? liveBell.markAllRead() : setNotifications((p) => p.map((n) => ({ ...n, unread: false }))))}
            className="flex items-center gap-1 text-xs font-medium text-accent hover:underline disabled:text-text-disabled disabled:no-underline disabled:cursor-not-allowed cursor-pointer"
          >
            <CheckCheck className="size-3.5" /> Mark all read
          </button>
        </div>
        <div className="flex gap-1 px-3 border-b border-border">
          {(['all', 'unread'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                'relative h-8 px-2 text-xs font-medium capitalize transition cursor-pointer',
                tab === t ? 'text-text-primary after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:bg-text-primary' : 'text-text-muted hover:text-text-primary'
              )}
            >
              {t}
              {t === 'unread' && unread > 0 && <span className="ml-1.5 text-text-muted text-[11px]">{unread}</span>}
            </button>
          ))}
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {list.length === 0 ? (
            <div className="py-10 px-6 text-center">
              <BellOff className="mx-auto size-5 text-text-muted" />
              <p className="mt-3 text-sm font-medium text-text-primary">You're all caught up</p>
              <p className="text-xs text-text-muted mt-0.5">New approvals and period reminders will show up here.</p>
            </div>
          ) : (
            list.map((n) => {
              const K = KIND[n.kind];
              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => {
                    if (liveBell) liveBell.markRead(n.id);
                    else setNotifications((p) => p.map((i) => (i.id === n.id ? { ...i, unread: false } : i)));
                    setOpen(false);
                    onNavigate(n.link);
                  }}
                  className="w-full flex items-start gap-3 px-4 py-3 text-left hover:bg-surface-neutral/70 transition border-b border-border/60 last:border-0 cursor-pointer outline-none focus-visible:bg-surface-neutral"
                >
                  <span className={cn('size-8 shrink-0 grid place-items-center rounded-lg', K.tone)}><K.icon className="size-4" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-start justify-between gap-2">
                      <span className={cn('text-[13px] leading-snug', n.unread ? 'font-semibold text-text-primary' : 'font-medium text-text-secondary')}>{n.title}</span>
                      <span className="text-[11px] text-text-muted shrink-0 pt-0.5">{n.time}</span>
                    </span>
                    <span className="block text-xs text-text-muted mt-0.5 line-clamp-2">{n.desc}</span>
                  </span>
                  {n.unread && <span className="mt-1.5 size-2 rounded-full bg-accent shrink-0" aria-label="Unread" />}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
};
