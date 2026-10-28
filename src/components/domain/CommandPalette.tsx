import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
} from '@/components/ui/command';
import { toast } from 'sonner';
import {
  Search,
  FileText,
  Users,
  BookOpen,
  Sun,
  Moon,
  PlusCircle,
  Building2,
  CheckCircle2,
  Coins,
  Package,
  BarChart3,
  Calendar,
  Settings,
  History,
  CreditCard,
  Layers,
  LogOut,
} from 'lucide-react';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({ isOpen, onClose }) => {
  const navigate = useNavigate();

  const {
    currentCompany,
    invoices,
    bills,
    contacts,
    accounts,
    theme,
    toggleTheme,
    setUiDensity,
  } = useLedgerStore();

  const coSlug = currentCompany.slug;

  const handleSelect = (action: () => void) => {
    action();
    onClose();
  };

  return (
    <CommandDialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <CommandInput placeholder="Type a command, document #, account code, or natural search..." />
      <CommandList>
        <CommandEmpty>No matching results found.</CommandEmpty>

        {/* Quick Actions */}
        <CommandGroup heading="Quick Actions">
          <CommandItem
            onSelect={() => handleSelect(() => navigate(`/${coSlug}/invoices/new`))}
          >
            <PlusCircle className="mr-2 h-4 w-4 text-accent" />
            <span>New Sales Invoice</span>
            <CommandShortcut>N</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => handleSelect(() => navigate(`/${coSlug}/bills/new`))}
          >
            <PlusCircle className="mr-2 h-4 w-4 text-accent" />
            <span>New Supplier Bill</span>
            <CommandShortcut>G B</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => handleSelect(() => navigate(`/${coSlug}/journals/new`))}
          >
            <PlusCircle className="mr-2 h-4 w-4 text-accent" />
            <span>New Manual Journal</span>
            <CommandShortcut>G J</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => handleSelect(() => navigate(`/${coSlug}/payment-run`))}
          >
            <Coins className="mr-2 h-4 w-4 text-accent" />
            <span>Run Supplier Payment Run Wizard</span>
          </CommandItem>
          <CommandItem
            onSelect={() => handleSelect(() => navigate(`/${coSlug}/fx-rates`))}
          >
            <Coins className="mr-2 h-4 w-4 text-accent" />
            <span>Run FX Month-End Revaluation</span>
          </CommandItem>
          <CommandItem
            onSelect={() =>
              handleSelect(() => {
                toast.info('Signed out of session');
                navigate('/login');
              })
            }
          >
            <LogOut className="mr-2 h-4 w-4 text-danger" />
            <span className="text-danger font-medium">Sign Out / Log Out</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Navigation */}
        <CommandGroup heading="Navigation">
          <CommandItem
            onSelect={() => handleSelect(() => navigate(`/${coSlug}/dashboard`))}
          >
            <BookOpen className="mr-2 h-4 w-4 text-text-muted" />
            <span>Go to Dashboard</span>
            <CommandShortcut>G D</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => handleSelect(() => navigate(`/${coSlug}/invoices`))}
          >
            <FileText className="mr-2 h-4 w-4 text-text-muted" />
            <span>Go to Sales Invoices</span>
            <CommandShortcut>G I</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => handleSelect(() => navigate(`/${coSlug}/bills`))}
          >
            <FileText className="mr-2 h-4 w-4 text-text-muted" />
            <span>Go to Supplier Bills</span>
            <CommandShortcut>G B</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => handleSelect(() => navigate(`/${coSlug}/approvals`))}
          >
            <CheckCircle2 className="mr-2 h-4 w-4 text-text-muted" />
            <span>Go to Approvals Inbox</span>
            <CommandShortcut>G A</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => handleSelect(() => navigate(`/${coSlug}/banking/bnk-1/reconcile`))}
          >
            <Building2 className="mr-2 h-4 w-4 text-text-muted" />
            <span>Bank Reconciliation Workspace</span>
          </CommandItem>
          <CommandItem
            onSelect={() => handleSelect(() => navigate(`/${coSlug}/periods`))}
          >
            <Calendar className="mr-2 h-4 w-4 text-text-muted" />
            <span>Fiscal Periods & Close Checklist</span>
            <CommandShortcut>G P</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => handleSelect(() => navigate(`/${coSlug}/reports/trial-balance`))}
          >
            <BarChart3 className="mr-2 h-4 w-4 text-text-muted" />
            <span>Trial Balance Report</span>
            <CommandShortcut>G R</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => handleSelect(() => navigate(`/${coSlug}/reports/balance-sheet`))}
          >
            <BarChart3 className="mr-2 h-4 w-4 text-text-muted" />
            <span>Balance Sheet (Branch Pivot)</span>
          </CommandItem>
          <CommandItem
            onSelect={() => handleSelect(() => navigate(`/${coSlug}/accounts`))}
          >
            <Layers className="mr-2 h-4 w-4 text-text-muted" />
            <span>Chart of Accounts</span>
          </CommandItem>
          <CommandItem
            onSelect={() => handleSelect(() => navigate(`/${coSlug}/settings`))}
          >
            <Settings className="mr-2 h-4 w-4 text-text-muted" />
            <span>Company Settings</span>
            <CommandShortcut>Ctrl+,</CommandShortcut>
          </CommandItem>
          <CommandItem
            onSelect={() => handleSelect(() => navigate(`/${coSlug}/audit-log`))}
          >
            <History className="mr-2 h-4 w-4 text-text-muted" />
            <span>Cryptographic Audit Log Trail</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        {/* Recent Invoices */}
        <CommandGroup heading="Sales Invoices">
          {invoices.slice(0, 4).map((inv) => (
            <CommandItem
              key={inv.id}
              value={`${inv.number} ${inv.reference} ${(inv.total / 100).toFixed(2)}`}
              onSelect={() => handleSelect(() => navigate(`/${coSlug}/invoices/${inv.id}`))}
            >
              <FileText className="mr-2 h-4 w-4 text-text-muted" />
              <span className="font-mono font-medium text-accent mr-2">{inv.number}</span>
              <span className="truncate">{inv.reference}</span>
              <span className="ml-auto font-mono text-xs">${(inv.total / 100).toFixed(2)}</span>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {/* Contacts */}
        <CommandGroup heading="Contacts (Customers & Suppliers)">
          {contacts.slice(0, 4).map((c) => (
            <CommandItem
              key={c.id}
              value={`${c.code} ${c.name} ${c.kind}`}
              onSelect={() =>
                handleSelect(() =>
                  navigate(c.kind === 'supplier' ? `/${coSlug}/suppliers` : `/${coSlug}/customers`)
                )
              }
            >
              <Users className="mr-2 h-4 w-4 text-text-muted" />
              <span className="font-mono text-xs text-text-muted mr-2">{c.code}</span>
              <span className="font-medium">{c.name}</span>
              <CommandShortcut>{c.kind}</CommandShortcut>
            </CommandItem>
          ))}
        </CommandGroup>

        <CommandSeparator />

        {/* Preferences */}
        <CommandGroup heading="Preferences & Display">
          <CommandItem onSelect={() => handleSelect(() => toggleTheme())}>
            {theme === 'light' ? (
              <Moon className="mr-2 h-4 w-4 text-text-muted" />
            ) : (
              <Sun className="mr-2 h-4 w-4 text-text-muted" />
            )}
            <span>Switch to {theme === 'light' ? 'Dark' : 'Light'} Mode</span>
            <CommandShortcut>Ctrl+Shift+D</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => handleSelect(() => setUiDensity('compact'))}>
            <span className="mr-2 font-mono text-xs font-bold">32</span>
            <span>Compact Table Density (32px)</span>
          </CommandItem>
          <CommandItem onSelect={() => handleSelect(() => setUiDensity('default'))}>
            <span className="mr-2 font-mono text-xs font-bold">36</span>
            <span>Default Table Density (36px)</span>
          </CommandItem>
          <CommandItem onSelect={() => handleSelect(() => setUiDensity('comfortable'))}>
            <span className="mr-2 font-mono text-xs font-bold">40</span>
            <span>Comfortable Table Density (40px)</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
};
