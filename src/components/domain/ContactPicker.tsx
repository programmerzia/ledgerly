import React, { useState } from 'react';
import { ChevronDown, Check, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLedgerStore } from '@/mock/store';
import type { Contact } from '@/types';
import { formatMoney } from '@/lib/format';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from '@/components/ui/command';
import { QuickCreateContactDialog } from './QuickCreateContactDialog';

interface ContactPickerProps {
  kind: 'customer' | 'supplier';
  value?: string;
  onChange: (contactId: string, contact: Contact) => void;
  /** Outstanding balance by contact id (minor units), shown as a hint. */
  balances?: Record<string, number>;
  balanceLabel?: string;
  currency?: string;
  className?: string;
}

export const ContactPicker: React.FC<ContactPickerProps> = ({
  kind,
  value,
  onChange,
  balances,
  balanceLabel = 'owes',
  currency = 'USD',
  className,
}) => {
  const { contacts } = useLedgerStore();
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');

  const options = contacts.filter((c) => c.is_active && (c.kind === kind || c.kind === 'both'));
  const selected = contacts.find((c) => c.id === value);
  const label = kind === 'customer' ? 'customer' : 'supplier';

  return (
    <>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setQuery(''); }}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            className={cn(
              'w-full flex items-center justify-between h-8 px-2.5 bg-surface text-left rounded-sm border border-border hover:border-border-strong text-xs transition-colors',
              'focus:outline-none focus:ring-1 focus:ring-accent',
              className
            )}
          >
            <span className="truncate flex items-center gap-2 min-w-0">
              {selected ? (
                <>
                  <span className="font-medium text-text-primary truncate">{selected.name}</span>
                  <span className="font-mono text-[11px] text-text-muted shrink-0">{selected.code}</span>
                </>
              ) : (
                <span className="text-text-muted">Choose a {label}…</span>
              )}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0 ml-1 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[380px] p-0 border-border bg-surface-elevated shadow-md">
          <Command>
            <CommandInput
              placeholder={`Search ${label} by name, code or email…`}
              value={query}
              onValueChange={setQuery}
            />
            <CommandList className="max-h-64">
              <CommandEmpty>
                <span className="text-xs text-text-muted">No {label} found. Use “New {label}” below.</span>
              </CommandEmpty>
              <CommandGroup>
                {options.map((c) => {
                  const bal = balances?.[c.id] ?? 0;
                  return (
                    <CommandItem
                      key={c.id}
                      value={`${c.name} ${c.code} ${c.email}`}
                      onSelect={() => {
                        onChange(c.id, c);
                        setOpen(false);
                      }}
                      className="flex items-center justify-between py-1.5 gap-2"
                    >
                      <div className="flex flex-col min-w-0">
                        <span className="text-xs font-medium text-text-primary truncate">{c.name}</span>
                        <span className="text-[10px] text-text-muted truncate">
                          <span className="font-mono">{c.code}</span>
                          {c.email ? ` · ${c.email}` : ''}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {balances && bal > 0 && (
                          <span className="text-[10px] font-mono text-text-muted">
                            {balanceLabel} {formatMoney(bal, currency)}
                          </span>
                        )}
                        <Check className={cn('h-3.5 w-3.5', c.id === value ? 'opacity-100 text-accent' : 'opacity-0')} />
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
              <CommandSeparator />
              <CommandGroup forceMount>
                <CommandItem
                  forceMount
                  value="__new__"
                  onSelect={() => {
                    setNewName(query.trim());
                    setOpen(false);
                    setCreating(true);
                  }}
                  className="py-1.5 text-xs font-medium text-accent"
                >
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                  New {label}…{query.trim() ? ` “${query.trim()}”` : ''}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <QuickCreateContactDialog
        open={creating}
        onOpenChange={setCreating}
        kind={kind}
        initialName={newName}
        onCreated={(c) => onChange(c.id, c)}
      />
    </>
  );
};
