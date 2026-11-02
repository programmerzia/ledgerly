import React, { useEffect, useState } from 'react';
import { Maximize2, Minimize2, Cloud, CloudOff, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { shortcutRegistry } from '@/lib/shortcuts';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

const ICON_BTN =
  'relative size-8 grid place-items-center rounded-md text-text-muted hover:text-text-primary hover:bg-surface-neutral transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer';

/** Local HH:mm clock, refreshed every 30s. Tooltip shows full date, local + UTC time and fiscal period. */
export const TopBarClock: React.FC<{ periodName: string }> = ({ periodName }) => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  const hm = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const utc = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC' });
  const date = now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="hidden md:flex items-center h-8 px-2 text-xs text-text-muted tabular-nums cursor-default" aria-label={`Local time ${hm}`}>
          {hm}
        </div>
      </TooltipTrigger>
      <TooltipContent align="end" className="block p-3 min-w-[220px]">
        <div className="text-[13px] font-semibold text-text-primary">{date}</div>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-text-muted">Local ({tz})</dt><dd className="text-right tabular-nums text-text-primary">{hm}</dd>
          <dt className="text-text-muted">UTC</dt><dd className="text-right tabular-nums text-text-primary">{utc}</dd>
          {periodName && <><dt className="text-text-muted">Fiscal period</dt><dd className="text-right text-text-primary">{periodName}</dd></>}
        </dl>
      </TooltipContent>
    </Tooltip>
  );
};

/** Fullscreen toggle using the Fullscreen API; also bound to Shift+F (ignored while typing). */
export const FullscreenToggle: React.FC = () => {
  const [isFs, setIsFs] = useState(() => !!document.fullscreenElement);
  useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggle = React.useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }, []);
  useEffect(
    () => shortcutRegistry.register({ id: 'shortcut-fullscreen', key: 'shift+f', description: 'Toggle full screen', scope: 'global', action: toggle }),
    [toggle]
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={toggle} aria-label={isFs ? 'Exit full screen' : 'Enter full screen'} aria-pressed={isFs} className={cn(ICON_BTN, 'hidden md:grid')}>
          {isFs ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
        </button>
      </TooltipTrigger>
      <TooltipContent shortcut="Shift+F">{isFs ? 'Exit full screen' : 'Enter full screen'}</TooltipContent>
    </Tooltip>
  );
};

interface SyncProps { isOffline: boolean; isSyncing: boolean; outboxCount: number; onToggle: () => void }
export const SyncIndicator: React.FC<SyncProps> = ({ isOffline, isSyncing, outboxCount, onToggle }) => {
  const label = isOffline
    ? `Offline · ${outboxCount} change${outboxCount === 1 ? '' : 's'} queued. Click to reconnect`
    : isSyncing
    ? `Syncing ${outboxCount}…`
    : 'Online · all changes synced. Click to simulate offline';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button type="button" onClick={onToggle} aria-label={label} className={ICON_BTN}>
          {isOffline ? <CloudOff className="size-4 text-warning" /> : isSyncing ? <RefreshCw className="size-4 text-accent animate-spin" /> : <Cloud className="size-4" />}
          {(isOffline || isSyncing) && <span className={cn('absolute top-1.5 right-1.5 size-1.5 rounded-full', isOffline ? 'bg-warning' : 'bg-accent')} />}
        </button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};

export { ICON_BTN };
