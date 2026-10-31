import React, { useState } from 'react';
import { ChevronDown, Check, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Item } from '@/types';
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
import { QuickCreateItemDialog } from './QuickCreateItemDialog';

interface ItemPickerProps {
  items: Item[];
  value?: string; // item id
  onChange: (item: Item) => void;
  currency?: string;
  className?: string;
  /** Marks the trigger so the grid can move focus to it. */
  focusKey?: string;
}

export const ItemPicker: React.FC<ItemPickerProps> = ({
  items,
  value,
  onChange,
  currency = 'USD',
  className,
  focusKey,
}) => {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');

  const selected = items.find((i) => i.id === value);
  const options = items.filter((i) => i.is_active || i.id === value);

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setQuery('');
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            data-item-picker={focusKey}
            className={cn(
              'w-full flex items-center justify-between h-8 px-2.5 bg-surface text-left rounded-sm border border-border hover:border-border-strong text-xs transition-colors',
              'focus:outline-none focus:ring-1 focus:ring-accent',
              className
            )}
          >
            <span className="truncate flex items-center gap-1.5 min-w-0">
              {selected ? (
                <>
                  <span className="font-mono text-[11px] font-semibold text-accent shrink-0">{selected.sku}</span>
                  <span className="truncate text-text-primary">{selected.name}</span>
                </>
              ) : (
                <span className="text-text-muted">Pick an item…</span>
              )}
            </span>
            <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0 ml-1 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[400px] p-0 border-border bg-surface-elevated shadow-md">
          <Command>
            <CommandInput placeholder="Search by name or SKU…" value={query} onValueChange={setQuery} />
            <CommandList className="max-h-64">
              <CommandEmpty>
                <span className="text-xs text-text-muted">No item found. Use “New item” below.</span>
              </CommandEmpty>
              <CommandGroup>
                {options.map((it) => (
                  <CommandItem
                    key={it.id}
                    value={`${it.name} ${it.sku}`}
                    onSelect={() => {
                      onChange(it);
                      setOpen(false);
                    }}
                    className="flex items-center justify-between py-1.5 gap-2"
                  >
                    <div className="flex flex-col min-w-0">
                      <span className="text-xs font-medium text-text-primary truncate">{it.name}</span>
                      <span className="text-[10px] font-mono text-text-muted">{it.sku}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[11px] font-mono text-text-primary">
                        {formatMoney(it.sales_price, currency)}
                      </span>
                      <span className="text-[9px] font-mono font-semibold px-1 rounded-xs bg-surface-neutral border border-border text-text-muted">
                        {it.tax_code}
                      </span>
                      <Check className={cn('h-3.5 w-3.5', it.id === value ? 'opacity-100 text-accent' : 'opacity-0')} />
                    </div>
                  </CommandItem>
                ))}
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
                  New item…{query.trim() ? ` “${query.trim()}”` : ''}
                </CommandItem>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      <QuickCreateItemDialog open={creating} onOpenChange={setCreating} initialName={newName} onCreated={onChange} />
    </>
  );
};
