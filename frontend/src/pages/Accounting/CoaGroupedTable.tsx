import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Search, CheckSquare, Square, ExternalLink, FileText, Copy, Download, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Account } from '@/types';
import { formatMoney } from '@/lib/format';
import { useLedgerStore } from '@/mock/store';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';
import { Kbd } from '@/components/ui/kbd';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';

export const CLASSIFICATIONS: { value: Account['account_type']; label: string; normal: 'debit' | 'credit' }[] = [
  { value: 'asset', label: 'Assets', normal: 'debit' },
  { value: 'liability', label: 'Liabilities', normal: 'credit' },
  { value: 'equity', label: 'Equity', normal: 'credit' },
  { value: 'income', label: 'Income', normal: 'credit' },
  { value: 'expense', label: 'Expenses', normal: 'debit' },
];

const TYPE_LABEL: Record<string, string> = {
  asset: 'Asset',
  liability: 'Liability',
  equity: 'Equity',
  income: 'Income',
  expense: 'Expense',
};

export const typeBadgeClass = (type: string) => {
  switch (type) {
    case 'asset':
      return 'bg-accent-soft text-accent border-accent/20';
    case 'liability':
      return 'bg-warning-soft text-warning border-warning/30';
    case 'equity':
      return 'bg-surface-neutral text-text-secondary border-border';
    case 'income':
      return 'bg-success-soft text-success border-success/30';
    case 'expense':
      return 'bg-danger-soft text-danger border-danger/30';
    default:
      return 'bg-surface-neutral text-text-muted border-border';
  }
};

export const TypePill: React.FC<{ type: string }> = ({ type }) => (
  <span className={cn('text-[11px] font-medium px-2 py-0.5 rounded-[3px] border', typeBadgeClass(type))}>
    {TYPE_LABEL[type] ?? type}
  </span>
);

export interface CoaAction {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  destructive?: boolean;
  disabled?: boolean;
  disabledReason?: string;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

interface Props {
  accounts: Account[];
  currency: string;
  balanceOf: (id: string) => number;
  activeId: string | null;
  onSelect: (a: Account) => void;
  onOpen: (a: Account) => void;
  /** Per-account actions: first non-destructive ones appear as hover icons; all in the right-click menu. */
  rowActions?: (a: Account) => CoaAction[];
  rowHeightClass: string;
}

export const CoaGroupedTable: React.FC<Props> = ({
  accounts,
  currency,
  balanceOf,
  activeId,
  onSelect,
  onOpen,
  rowActions,
  rowHeightClass,
}) => {
  const { setTableSelection, setFocusedElementShortcuts } = useLedgerStore();
  const [filterType, setFilterType] = useState('all');
  const [query, setQuery] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});

  const tabs = [
    { label: 'All accounts', value: 'all', count: accounts.length },
    ...CLASSIFICATIONS.map((c) => ({
      label: c.label,
      value: c.value as string,
      count: accounts.filter((a) => a.account_type === c.value).length,
    })),
  ];

  /** Balance signed so it reads correctly inside its section: contra accounts come out negative. */
  const signed = (a: Account, normalOfGroup: 'debit' | 'credit') =>
    balanceOf(a.id) * (a.normal_balance === normalOfGroup ? 1 : -1);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return CLASSIFICATIONS.filter((c) => filterType === 'all' || filterType === c.value)
      .map((c) => {
        const rows = accounts
          .filter((a) => a.account_type === c.value)
          .filter(
            (a) =>
              !q ||
              a.code.toLowerCase().includes(q) ||
              a.name.toLowerCase().includes(q) ||
              a.account_subtype.toLowerCase().includes(q) ||
              c.label.toLowerCase().includes(q)
          )
          .sort((x, y) => x.code.localeCompare(y.code))
          .map((a) => ({ account: a, amount: signed(a, c.normal) }));
        return { ...c, rows, subtotal: rows.reduce((s, r) => s + r.amount, 0) };
      })
      .filter((g) => g.rows.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts, filterType, query, balanceOf]);

  const flat = useMemo(() => groups.flatMap((g) => g.rows.map((r) => r.account)), [groups]);

  useEffect(() => {
    setFocusedIndex((i) => Math.min(i, Math.max(flat.length - 1, 0)));
  }, [flat.length]);

  useEffect(() => {
    if (selectedIds.size > 0) {
      const sum = groups.reduce(
        (s, g) => s + g.rows.reduce((t, r) => (selectedIds.has(r.account.id) ? t + r.amount : t), 0),
        0
      );
      setTableSelection({ count: selectedIds.size, sum, currency });
    } else {
      setTableSelection(null);
    }
    return () => setTableSelection(null);
  }, [selectedIds, groups, currency, setTableSelection]);

  useEffect(() => {
    setFocusedElementShortcuts(['j/k Move', 'Enter Open ledger', 'Space Select', 'Shift+F10 Menu', '/ Search']);
    return () => setFocusedElementShortcuts(null);
  }, [setFocusedElementShortcuts]);

  const toggle = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const focusRow = (idx: number) => {
    setFocusedIndex(idx);
    const a = flat[idx];
    if (a) rowRefs.current[a.id]?.scrollIntoView({ block: 'nearest' });
    if (a) rowRefs.current[a.id]?.focus();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      const isInput =
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
      if ((e.key === '/' && !isInput) || ((e.key === 'f' || e.key === 'F') && (e.ctrlKey || e.metaKey))) {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (el === searchRef.current) {
        if (e.key === 'Escape') {
          setQuery('');
          searchRef.current?.blur();
        } else if ((e.key === 'ArrowDown' || e.key === 'Enter') && flat.length > 0) {
          e.preventDefault();
          searchRef.current?.blur();
          focusRow(0);
        }
        return;
      }
      if (isInput) return;
      if (e.key === 'Escape' && selectedIds.size > 0) {
        e.preventDefault();
        setSelectedIds(new Set());
      } else if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = Math.min(focusedIndex + 1, flat.length - 1);
        if (flat[next]) onSelect(flat[next]);
        focusRow(next);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const next = Math.max(focusedIndex - 1, 0);
        if (flat[next]) onSelect(flat[next]);
        focusRow(next);
      } else if (e.key === 'Enter' && flat[focusedIndex]) {
        e.preventDefault();
        onOpen(flat[focusedIndex]);
      } else if ((e.key === ' ' || e.key === 'x') && flat[focusedIndex]) {
        e.preventDefault();
        toggle(flat[focusedIndex].id);
      } else if (e.key === 'F10' && e.shiftKey && flat[focusedIndex]) {
        const target = rowRefs.current[flat[focusedIndex].id];
        if (target) {
          e.preventDefault();
          const rect = target.getBoundingClientRect();
          target.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: rect.left + 50,
              clientY: rect.top + 15,
            })
          );
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const allSelected = flat.length > 0 && selectedIds.size === flat.length;
  const fmt = (n: number) => formatMoney(n, currency, { parenthesesNegative: true });
  const COLS = 7;
  const COLSPAN_ALL = COLS + 2;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
        <div className="flex items-center gap-1 bg-surface-neutral p-0.5 rounded-md overflow-x-auto no-scrollbar flex-nowrap max-w-full">
          {tabs.map((tab) => {
            const active = filterType === tab.value;
            return (
              <button
                key={tab.value}
                type="button"
                onClick={() => setFilterType(tab.value)}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-[4px] text-[13px] font-medium transition-colors shrink-0 whitespace-nowrap cursor-pointer',
                  active ? 'bg-surface-elevated text-text-primary' : 'text-text-muted hover:text-text-primary'
                )}
              >
                <span>{tab.label}</span>
                <span
                  className={cn(
                    'text-[11px] px-1.5 rounded-[3px]',
                    active ? 'bg-surface-neutral text-text-primary' : 'text-text-muted'
                  )}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative flex items-center sm:ml-auto min-w-[160px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 text-text-muted pointer-events-none" />
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setFocusedIndex(0);
            }}
            placeholder="Search by code, name or type"
            className="h-8 pl-8 pr-8 text-[13px] bg-surface border border-border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 w-full sm:w-72"
          />
          <Kbd className="absolute right-2 pointer-events-none">/</Kbd>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex items-center justify-between p-2.5 bg-surface-elevated border border-border-strong rounded-md text-xs">
          <span className="font-semibold text-text-primary">
            {selectedIds.size} selected
          </span>
          <button
            type="button"
            onClick={() => setSelectedIds(new Set())}
            className="h-7 px-2 rounded text-text-muted hover:text-text-primary hover:bg-surface-neutral text-[11px] font-medium cursor-pointer"
          >
            Clear (Esc)
          </button>
        </div>
      )}

      <div className="border border-border rounded-lg bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="sticky top-0 z-10 bg-surface border-b border-border text-[11px] font-semibold text-text-muted">
                <th className="w-8 px-2 h-8 text-center">
                  <button
                    type="button"
                    onClick={() => setSelectedIds(allSelected ? new Set() : new Set(flat.map((a) => a.id)))}
                    className="p-0.5 text-text-muted hover:text-text-primary cursor-pointer"
                    title="Select all"
                  >
                    {allSelected ? <CheckSquare className="w-3.5 h-3.5 text-accent" /> : <Square className="w-3.5 h-3.5" />}
                  </button>
                </th>
                <th className="px-3 uppercase tracking-wide">Code</th>
                <th className="px-3 uppercase tracking-wide">Account name</th>
                <th className="px-3 uppercase tracking-wide">Type</th>
                <th className="px-3 uppercase tracking-wide">Category</th>
                <th className="px-3 uppercase tracking-wide">Increases with</th>
                <th className="px-3 uppercase tracking-wide">Tags</th>
                <th className="px-3 uppercase tracking-wide text-right">Balance ({currency})</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {groups.length === 0 && (
                <tr>
                  <td colSpan={COLSPAN_ALL} className="h-28 text-center text-xs text-text-muted">
                    No accounts match your search.
                  </td>
                </tr>
              )}
              {groups.map((g) => (
                <React.Fragment key={g.value}>
                  <tr className="bg-surface-neutral/70 border-y border-border">
                    <td colSpan={COLS} className="px-3 h-11">
                      <span className="flex items-center gap-2.5">
                        <span className="text-[13px] font-semibold text-text-primary">{g.label}</span>
                        <span className="rounded-[3px] bg-surface px-1.5 text-[11px] font-medium text-text-muted ring-1 ring-inset ring-border">{g.rows.length}</span>
                      </span>
                    </td>
                    <td className="px-3 text-right text-[13px] font-semibold tabular-nums text-text-primary">{fmt(g.subtotal)}</td>
                    <td />
                  </tr>
                  {g.rows.map(({ account: a, amount }) => {
                    const idx = flat.indexOf(a);
                    const isSel = selectedIds.has(a.id);
                    const isActive = activeId === a.id;
                    const isFocused = focusedIndex === idx;
                    const needsBranch = a.account_type === 'income' || a.account_type === 'expense';
                    return (
                      <ContextMenu key={a.id}>
                        <ContextMenuTrigger asChild>
                          <tr
                            ref={(el) => {
                              rowRefs.current[a.id] = el;
                            }}
                            tabIndex={0}
                            data-focused={isFocused}
                            data-selected={isSel}
                            data-active={isActive}
                            onClick={() => {
                              setFocusedIndex(idx);
                              onSelect(a);
                            }}
                            onDoubleClick={() => onOpen(a)}
                            className={cn(
                              rowHeightClass,
                              'border-b border-border/60 transition-colors cursor-pointer outline-none select-none relative group',
                              isSel
                                ? 'bg-accent-soft/40 hover:bg-accent-soft/60'
                                : isActive
                                ? 'bg-accent-soft/50 shadow-[inset_3px_0_0_var(--accent)]'
                                : isFocused
                                ? 'bg-surface-neutral ring-1 ring-inset ring-accent/40'
                                : 'hover:bg-accent-soft/40',
                              !a.is_active && 'opacity-60'
                            )}
                          >
                            <td className="w-8 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                              <button
                                type="button"
                                onClick={() => toggle(a.id)}
                                className="p-0.5 text-text-muted hover:text-text-primary cursor-pointer"
                              >
                                {isSel ? (
                                  <CheckSquare className="w-3.5 h-3.5 text-accent" />
                                ) : (
                                  <Square className="w-3.5 h-3.5 opacity-40 group-hover:opacity-100" />
                                )}
                              </button>
                            </td>
                            <td className="px-3 font-mono font-semibold text-accent whitespace-nowrap">{a.code}</td>
                            <td className="px-3 font-medium text-text-primary whitespace-nowrap">{a.name}{!a.is_active && <span className="ml-2 rounded-[3px] bg-surface-neutral px-2 py-0.5 text-[11px] font-medium text-text-muted">Inactive</span>}</td>
                            <td className="px-3">
                              <TypePill type={a.account_type} />
                            </td>
                            <td className="px-3 text-text-muted whitespace-nowrap">{a.account_subtype}</td>
                            <td className="px-3 text-text-muted">{cap(a.normal_balance)}</td>
                            <td className="px-3">
                              {needsBranch && (
                                <span className="text-[11px] text-accent bg-accent-soft px-2 py-0.5 rounded-[3px] font-medium whitespace-nowrap">
                                  Branch needed
                                </span>
                              )}
                            </td>
                            <td
                              className={cn(
                                'px-3 text-right font-mono tabular-nums font-semibold whitespace-nowrap',
                                amount === 0 ? 'text-text-muted' : 'text-text-primary'
                              )}
                            >
                              {fmt(amount)}
                            </td>
                            <td className="px-2 text-right" onClick={(e) => e.stopPropagation()}>
                              <span className="inline-flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                                {(rowActions?.(a) ?? []).filter((x) => !x.destructive).slice(0, 3).map((x) => (
                                  <Tooltip key={x.label}>
                                    <TooltipTrigger asChild>
                                      <button
                                        type="button"
                                        aria-label={x.label}
                                        disabled={x.disabled}
                                        onClick={x.onClick}
                                        className="flex size-7 items-center justify-center rounded-md text-text-muted hover:bg-surface hover:text-text-primary disabled:opacity-40 cursor-pointer"
                                      >
                                        <x.icon className="size-4" />
                                      </button>
                                    </TooltipTrigger>
                                    <TooltipContent>{x.disabled && x.disabledReason ? x.disabledReason : x.label}</TooltipContent>
                                  </Tooltip>
                                ))}
                              </span>
                            </td>
                          </tr>
                        </ContextMenuTrigger>
                        <ContextMenuContent>
                          {(rowActions?.(a) ?? []).filter((x) => !x.destructive).map((x) => (
                            <ContextMenuItem key={x.label} onClick={x.onClick} disabled={x.disabled} title={x.disabledReason}>
                              <x.icon className="mr-2 h-3.5 w-3.5" />
                              <span>{x.label}</span>
                            </ContextMenuItem>
                          ))}
                          <ContextMenuSeparator />
                          <ContextMenuItem onClick={() => onSelect(a)}>
                            <ExternalLink className="mr-2 h-3.5 w-3.5" />
                            <span>View details</span>
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => onOpen(a)}>
                            <FileText className="mr-2 h-3.5 w-3.5" />
                            <span>Open account ledger</span>
                          </ContextMenuItem>
                          <ContextMenuSeparator />
                          <ContextMenuItem onClick={() => toggle(a.id)}>
                            <CheckSquare className="mr-2 h-3.5 w-3.5" />
                            <span>Toggle select</span>
                          </ContextMenuItem>
                          <ContextMenuItem onClick={() => navigator.clipboard.writeText(a.code)}>
                            <Copy className="mr-2 h-3.5 w-3.5" />
                            <span>Copy code ({a.code})</span>
                          </ContextMenuItem>
                          <ContextMenuItem
                            onClick={() => {
                              navigator.clipboard.writeText(JSON.stringify(a, null, 2));
                              toast.success('Account copied to clipboard');
                            }}
                          >
                            <Download className="mr-2 h-3.5 w-3.5" />
                            <span>Copy as JSON</span>
                          </ContextMenuItem>
                          {(rowActions?.(a) ?? []).some((x) => x.destructive) && <ContextMenuSeparator />}
                          {(rowActions?.(a) ?? []).filter((x) => x.destructive).map((x) => (
                            <ContextMenuItem key={x.label} variant="destructive" onClick={x.onClick} disabled={x.disabled} title={x.disabledReason}>
                              <x.icon className="mr-2 h-3.5 w-3.5" />
                              <span>{x.label}</span>
                            </ContextMenuItem>
                          ))}
                        </ContextMenuContent>
                      </ContextMenu>
                    );
                  })}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
