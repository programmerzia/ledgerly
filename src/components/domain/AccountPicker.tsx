import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Account } from '@/types';
import { ChevronDown, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '@/components/ui/command';

interface AccountPickerProps {
  accounts: Account[];
  value?: string; // account_id
  onChange: (accountId: string, account?: Account) => void;
  disabled?: boolean;
  error?: boolean;
  placeholder?: string;
  className?: string;
  filterType?: string;
}

export const AccountPicker: React.FC<AccountPickerProps> = ({
  accounts,
  value,
  onChange,
  disabled = false,
  error = false,
  placeholder = 'Select GL account...',
  className,
}) => {
  const [open, setOpen] = useState(false);

  const selectedAccount = accounts.find((a) => a.id === value);

  const getTypeBadgeClass = (type: string) => {
    switch (type) {
      case 'asset':
        return 'bg-accent-soft text-accent';
      case 'liability':
        return 'bg-warning-soft text-warning';
      case 'equity':
        return 'bg-violet-soft text-violet';
      case 'income':
        return 'bg-success-soft text-success';
      case 'expense':
        return 'bg-danger-soft text-danger';
      default:
        return 'bg-surface-neutral text-text-muted';
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'w-full flex items-center justify-between h-8 px-2.5 bg-surface text-left rounded-sm border text-xs transition-colors',
            'focus:outline-none focus:ring-1 focus:ring-accent',
            error ? 'border-danger text-danger' : 'border-border hover:border-border-strong text-text-primary',
            disabled && 'bg-surface-neutral opacity-50 cursor-not-allowed',
            className
          )}
        >
          <span className="truncate flex items-center gap-1.5 min-w-0">
            {selectedAccount ? (
              <>
                <span className="font-mono text-xs font-semibold text-accent">
                  {selectedAccount.code}
                </span>
                <span className="truncate text-text-primary text-xs">{selectedAccount.name}</span>
              </>
            ) : (
              <span className="text-text-muted text-xs">{placeholder}</span>
            )}
          </span>
          <ChevronDown className="w-3.5 h-3.5 text-text-muted shrink-0 ml-1 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[340px] p-0 border-border bg-surface-elevated shadow-md"
      >
        <Command>
          <CommandInput placeholder="Search account code or name..." />
          <CommandList className="max-h-60">
            <CommandEmpty>No matching account found.</CommandEmpty>
            <CommandGroup heading="Chart of Accounts">
              {accounts.map((acc) => {
                const isSelected = acc.id === value;
                return (
                  <CommandItem
                    key={acc.id}
                    value={`${acc.code} ${acc.name} ${acc.account_type}`}
                    onSelect={() => {
                      onChange(acc.id, acc);
                      setOpen(false);
                    }}
                    className="flex items-center justify-between py-1.5"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-xs font-semibold text-accent w-12 shrink-0">
                        {acc.code}
                      </span>
                      <span className="truncate text-xs font-medium text-text-primary">
                        {acc.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0 ml-2">
                      <span
                        className={cn(
                          'text-[9px] uppercase px-1 py-0.2 rounded-xs font-semibold',
                          getTypeBadgeClass(acc.account_type)
                        )}
                      >
                        {acc.account_type}
                      </span>
                      <Check
                        className={cn(
                          'h-3.5 w-3.5',
                          isSelected ? 'opacity-100 text-accent' : 'opacity-0'
                        )}
                      />
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
};
