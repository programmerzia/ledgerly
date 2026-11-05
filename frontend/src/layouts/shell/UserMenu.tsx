import React from 'react';
import { Building2, ChevronDown, User, Users, Keyboard, Moon, Sun, LogOut, ShieldCheck, Check, CloudOff, Cloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import { IS_LIVE } from '@/api/config';
import { Avatar } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent,
} from '@/components/ui/dropdown-menu';

export const PERSONAS = [
  { id: 'usr-1', name: 'Rahim Ahmed', role: 'Accountant (Maker)' },
  { id: 'usr-2', name: 'Fatima Hassan', role: 'Finance Manager (Checker)' },
  { id: 'usr-3', name: 'Kenneth Mwangi', role: 'CFO (Second Approver)' },
  { id: 'usr-4', name: 'Aisha Noor', role: 'Auditor (Read-Only)' },
];

export const UserAvatar: React.FC<{ initials?: string; className?: string }> = ({ initials, className }) => (
  <Avatar
    name={initials || '?'}
    size="sm"
    className={cn('size-7 text-[11px]', className)}
  />
);

interface Props {
  user: { id: string; name: string; avatar?: string; roleTitle: string };
  isDark: boolean;
  isOffline: boolean;
  onToggleTheme: () => void;
  onToggleOffline: () => void;
  onSwitchUser: (id: string) => void;
  onProfile: () => void;
  onShortcuts: () => void;
  onAdmin: () => void;
  /** Live mode: the organisation page. */
  onOrganisation?: () => void;
  onSignOut: () => void;
}

export const UserMenu: React.FC<Props> = ({ user, isDark, isOffline, onToggleTheme, onToggleOffline, onSwitchUser, onProfile, onShortcuts, onAdmin, onOrganisation, onSignOut }) => (
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <button type="button" aria-label="User menu" className="flex items-center gap-2 h-10 pl-1 pr-2 rounded-lg hover:bg-surface-neutral transition outline-none focus-visible:ring-2 focus-visible:ring-accent/50 cursor-pointer">
        <UserAvatar initials={user.avatar} />
        <span className="hidden xl:flex flex-col items-start leading-tight text-left">
          <span className="text-[13px] font-medium text-text-primary max-w-[110px] truncate">{user.name}</span>
          <span className="text-[11px] text-text-muted max-w-[110px] truncate">{user.roleTitle}</span>
        </span>
        <ChevronDown className="size-3.5 text-text-muted hidden sm:block" />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={8} className="w-64">
      <div className="flex items-center gap-3 px-2 py-2">
        <UserAvatar initials={user.avatar} className="size-9 text-xs" />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-text-primary truncate">{user.name}</div>
          <div className="text-xs text-text-muted truncate">{user.roleTitle}</div>
        </div>
      </div>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onProfile}><User className="size-4 text-text-muted" />Profile &amp; settings</DropdownMenuItem>
      {IS_LIVE && onOrganisation && <DropdownMenuItem onSelect={onOrganisation}><Building2 className="size-4 text-text-muted" />Organisation</DropdownMenuItem>}
      {!IS_LIVE && <DropdownMenuSub>
        <DropdownMenuSubTrigger><Users className="size-4 text-text-muted" />Switch persona</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="w-64">
          <DropdownMenuLabel>Demo: view as</DropdownMenuLabel>
          {PERSONAS.map((u) => (
            <DropdownMenuItem key={u.id} onSelect={() => onSwitchUser(u.id)} className="justify-between">
              <span className="flex flex-col"><span className="font-medium">{u.name}</span><span className="text-[11px] text-text-muted">{u.role}</span></span>
              {u.id === user.id && <Check className="size-4 text-accent" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuSub>}
      <DropdownMenuItem onSelect={onShortcuts}><Keyboard className="size-4 text-text-muted" />Keyboard shortcuts<DropdownMenuShortcut>?</DropdownMenuShortcut></DropdownMenuItem>
      <DropdownMenuItem onSelect={onToggleTheme}>
        {isDark ? <Sun className="size-4 text-text-muted" /> : <Moon className="size-4 text-text-muted" />}
        {isDark ? 'Light theme' : 'Dark theme'}<DropdownMenuShortcut>Ctrl+Shift+D</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onToggleOffline}>
        {isOffline ? <CloudOff className="size-4 text-warning" /> : <Cloud className="size-4 text-text-muted" />}
        Simulate offline<DropdownMenuShortcut>{isOffline ? 'On' : 'Off'}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onAdmin}><ShieldCheck className="size-4 text-violet" />Platform admin</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onSignOut} className="text-danger focus:text-danger focus:bg-danger-soft"><LogOut className="size-4" />Sign out</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
);
