import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut,
} from '@/components/ui/command';
import { toast } from 'sonner';
import {
  FileText, Users, Sun, Moon, PlusCircle, Building2, CheckCircle2, Coins, BarChart3, Calendar, Settings,
  History, CreditCard, Layers, LogOut, ShieldCheck, LayoutDashboard, Rows3, Truck, Receipt, Sparkles, CornerDownLeft,
} from 'lucide-react';
import { formatMoney } from '@/lib/format';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

const Kbd: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <kbd className="font-sans text-[11px] text-text-muted bg-surface border border-border px-1.5 h-5 min-w-5 inline-flex items-center justify-center rounded-md shadow-sm">{children}</kbd>
);

/** Tinted icon square used by every row so the list scans quickly. */
const Tile: React.FC<{ icon: React.ComponentType<{ className?: string }>; tone?: string }> = ({ icon: Icon, tone = 'bg-surface-neutral text-text-secondary' }) => (
  <span className={`size-6 shrink-0 grid place-items-center rounded-md [&_svg]:!text-current ${tone}`}><Icon className="size-3.5" /></span>
);

const KeyHint: React.FC<{ keys?: string }> = ({ keys }) =>
  keys ? (
    <span className="ml-auto flex items-center gap-1">
      {keys.split(' ').map((k, i) => <Kbd key={i}>{k}</Kbd>)}
    </span>
  ) : null;

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();
  const { currentCompany, invoices, bills, contacts, theme, toggleTheme, setUiDensity } = useLedgerStore();
  const coSlug = currentCompany.slug;
  const go = (path: string, message?: string) => () => {
    navigate(`/${coSlug}${path}`);
    if (message) toast.info(message);
    onClose();
  };
  const run = (fn: () => void) => () => { fn(); onClose(); };

  const nav: { label: string; path: string; icon: React.ComponentType<{ className?: string }>; keys?: string }[] = [
    { label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, keys: 'G D' },
    { label: 'Sales invoices', path: '/invoices', icon: FileText, keys: 'G I' },
    { label: 'Supplier bills', path: '/bills', icon: FileText, keys: 'G B' },
    { label: 'Approvals inbox', path: '/approvals', icon: CheckCircle2, keys: 'G A' },
    { label: 'Bank reconciliation', path: '/banking/bnk-1/reconcile', icon: Building2 },
    { label: 'Periods & close checklist', path: '/periods', icon: Calendar, keys: 'G P' },
    { label: 'Trial balance', path: '/reports/trial-balance', icon: BarChart3, keys: 'G R' },
    { label: 'Balance sheet', path: '/reports/balance-sheet', icon: BarChart3 },
    { label: 'Cash flow statement', path: '/reports/cash-flow', icon: BarChart3 },
    { label: 'Close pack certificate', path: '/periods/close-pack', icon: ShieldCheck },
    { label: 'Products & services', path: '/items', icon: Receipt },
    { label: 'Recurring journals', path: '/accounting/recurring', icon: Layers },
    { label: 'Chart of accounts', path: '/accounts', icon: Layers },
    { label: 'Import data', path: '/settings/import', icon: Settings },
    { label: 'Setup wizard', path: '/onboarding', icon: Sparkles },
    { label: 'Company settings', path: '/settings', icon: Settings, keys: 'Ctrl ,' },
    { label: 'Audit log', path: '/audit-log', icon: History },
  ];

  const accent = 'bg-accent-soft text-accent';

  return (
    <CommandDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <CommandInput placeholder="Search or jump to…  documents, customers, accounts, actions" />
      <CommandList className="max-h-[420px]">
        <CommandEmpty>No matching results found.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={go('/invoices/new')}><Tile icon={PlusCircle} tone={accent} /><span>New sales invoice</span><KeyHint keys="N" /></CommandItem>
          <CommandItem onSelect={go('/bills/new')}><Tile icon={PlusCircle} tone={accent} /><span>New supplier bill</span></CommandItem>
          <CommandItem onSelect={go('/journals/new')}><Tile icon={PlusCircle} tone={accent} /><span>New manual journal</span><KeyHint keys="G J" /></CommandItem>
          <CommandItem onSelect={go('/payment-run')}><Tile icon={Coins} tone={accent} /><span>Pay bills (payment run)</span></CommandItem>
          <CommandItem onSelect={go('/fx-rates')}><Tile icon={Coins} tone={accent} /><span>Run FX month-end revaluation</span></CommandItem>
          <CommandItem
            className="h-auto py-1.5"
            value="unpaid invoices hormuud telecom customer open pending"
            onSelect={go('/invoices?contact=cnt-1&status=posted', 'Filtered Hormuud Telecom unpaid invoices')}
          >
            <Tile icon={FileText} tone="bg-violet-soft text-violet" />
            <span className="flex flex-col leading-tight"><span>"unpaid invoices hormuud"</span><span className="text-[11px] text-text-muted">Show open invoices for Hormuud Telecom</span></span>
            <CommandShortcut>Filter</CommandShortcut>
          </CommandItem>
          <CommandItem
            className="h-auto py-1.5"
            value="close october oct 2026 period checklist year-end lock"
            onSelect={go('/periods?action=close&period=2026-10', 'Navigating to October 2026 close checklist')}
          >
            <Tile icon={Calendar} tone="bg-violet-soft text-violet" />
            <span className="flex flex-col leading-tight"><span>"close october"</span><span className="text-[11px] text-text-muted">Open the October 2026 close checklist</span></span>
            <CommandShortcut>Period close</CommandShortcut>
          </CommandItem>
          <CommandItem
            className="h-auto py-1.5"
            value="receipt 1050 1,050 receive payment customer hormuud settlement"
            onSelect={go('/receipts/new?amount=105000&contact=cnt-1', 'Opened receipt form for $1,050.00 from Hormuud Telecom')}
          >
            <Tile icon={CreditCard} tone="bg-violet-soft text-violet" />
            <span className="flex flex-col leading-tight"><span>"receipt 1050"</span><span className="text-[11px] text-text-muted">Record a $1,050.00 receipt from Hormuud Telecom</span></span>
            <CommandShortcut>New receipt</CommandShortcut>
          </CommandItem>
          <CommandItem
            className="h-auto py-1.5"
            value="reopen september sep 2026 period dual approver cfo unlock"
            onSelect={go('/periods?action=reopen&period=2026-09', 'Initiating September 2026 dual-approver reopen request')}
          >
            <Tile icon={ShieldCheck} tone="bg-violet-soft text-violet" />
            <span className="flex flex-col leading-tight"><span>"reopen september"</span><span className="text-[11px] text-text-muted">Request a dual-approver reopen for September 2026</span></span>
            <CommandShortcut>Reopen period</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={run(() => { toast.info('Signed out of session'); navigate('/login'); })}
            className="text-danger data-[selected=true]:text-danger data-[selected=true]:bg-danger-soft"
          >
            <Tile icon={LogOut} tone="bg-danger-soft text-danger" /><span className="font-medium">Sign out</span>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Navigation">
          {nav.map((n) => (
            <CommandItem key={n.path} value={`go to ${n.label}`} onSelect={go(n.path)}>
              <Tile icon={n.icon} /><span>{n.label}</span><KeyHint keys={n.keys} />
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Recent documents">
          {invoices.slice(0, 4).map((inv) => (
            <CommandItem key={inv.id} value={`${inv.number} ${inv.reference} ${(inv.total / 100).toFixed(2)}`} onSelect={go(`/invoices/${inv.id}`)}>
              <Tile icon={FileText} tone={accent} />
              <span className="font-medium text-text-primary tabular-nums">{inv.number ?? 'Draft'}</span>
              <span className="truncate text-text-muted">{inv.reference}</span>
              <span className="ml-auto tabular-nums text-xs text-text-secondary">{formatMoney(inv.total_fc, inv.currency)}</span>
            </CommandItem>
          ))}
          {bills.slice(0, 3).map((b) => (
            <CommandItem key={b.id} value={`bill ${b.number} ${b.reference}`} onSelect={go(`/bills/${b.id}`)}>
              <Tile icon={FileText} tone="bg-warning-soft text-warning" />
              <span className="font-medium text-text-primary tabular-nums">{b.number ?? 'Draft'}</span>
              <span className="truncate text-text-muted">{b.reference}</span>
              <span className="ml-auto tabular-nums text-xs text-text-secondary">{formatMoney(b.total_fc, b.currency)}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Customers & suppliers">
          {contacts.slice(0, 5).map((c) => (
            <CommandItem
              key={c.id}
              value={`${c.code} ${c.name} ${c.kind}`}
              onSelect={go(c.kind === 'supplier' ? '/suppliers' : '/customers')}
            >
              <Tile icon={c.kind === 'supplier' ? Truck : Users} tone={c.kind === 'supplier' ? 'bg-warning-soft text-warning' : 'bg-success-soft text-success'} />
              <span className="font-medium text-text-primary">{c.name}</span>
              <span className="text-xs text-text-muted">{c.code}</span>
              <CommandShortcut className="capitalize">{c.kind}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandGroup heading="Preferences">
          <CommandItem onSelect={run(() => toggleTheme())}>
            <Tile icon={theme === 'light' ? Moon : Sun} />
            <span>Switch to {theme === 'light' ? 'dark' : 'light'} mode</span><KeyHint keys="Ctrl Shift D" />
          </CommandItem>
          <CommandItem onSelect={run(() => setUiDensity('compact'))}><Tile icon={Rows3} /><span>Compact table density</span></CommandItem>
          <CommandItem onSelect={run(() => setUiDensity('default'))}><Tile icon={Rows3} /><span>Default table density</span></CommandItem>
          <CommandItem onSelect={run(() => setUiDensity('comfortable'))}><Tile icon={Rows3} /><span>Comfortable table density</span></CommandItem>
        </CommandGroup>
      </CommandList>

      <div className="flex items-center gap-4 border-t border-border bg-surface-neutral/50 px-3 h-9 text-[11px] text-text-muted shrink-0">
        <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd>navigate</span>
        <span className="flex items-center gap-1.5"><Kbd><CornerDownLeft className="size-3" /></Kbd>open</span>
        <span className="flex items-center gap-1.5"><Kbd>esc</Kbd>close</span>
      </div>
    </CommandDialog>
  );
};
