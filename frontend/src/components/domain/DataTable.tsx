import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  ColumnDef,
  flexRender,
  SortingState,
  VisibilityState,
} from '@tanstack/react-table';
import {
  Search,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  FileText,
  Download,
  X,
  CheckSquare,
  Square,
  Eye,
  Hash,
  Braces,
  ArrowUpDown,
} from 'lucide-react';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuLabel,
  ContextMenuShortcut,
} from '@/components/ui/context-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import { Kbd } from '@/components/ui/kbd';
import {
  ViewsMenu,
  ColumnsMenu,
  useSavedViews,
  readViewStore,
  hiddenFromVisibility,
  visibilityFromHidden,
  type SavedView,
} from './DataTableViews';
import { useLocation } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { formatMoney } from '@/lib/format';
import { toast } from 'sonner';

export interface RowAction<TData> {
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  onClick: (row: TData) => void;
  /** Display-only keyboard hint shown in the context menu, e.g. "E". */
  shortcut?: string;
  /** Rendered in danger colour, last, in its own group of the context menu. */
  destructive?: boolean;
  disabled?: boolean;
  /** Reason shown as tooltip when disabled. */
  disabledReason?: string;
}

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchPlaceholder?: string;
  searchColumn?: string;
  onRowClick?: (row: TData) => void;
  onRowDoubleClick?: (row: TData) => void;
  actions?: React.ReactNode;
  filterTabs?: { label: string; value: string; count?: number }[];
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  className?: string;
  rowDensity?: 'compact' | 'default' | 'comfortable';
  amountAccessor?: (row: TData) => number;
  currency?: string;
  bulkActions?: (selectedRows: TData[], clearSelection: () => void) => React.ReactNode;
  activeRowId?: string | null;
  /** Row-level actions: first 3 non-destructive ones appear as hover icons; all appear in the right-click menu. */
  rowActions?: (row: TData) => RowAction<TData>[];
  /** Primary label shown as header of the right-click menu. Falls back to number/name/code/id. */
  contextMenuTitle?: (row: TData) => string;
  /** Show skeleton rows instead of data. */
  loading?: boolean;
  /** Number of skeleton rows when loading (default 8). */
  skeletonRows?: number;
  /** Key for saved views. Defaults to the current route path. */
  tableId?: string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchPlaceholder = 'Search...',
  onRowClick,
  onRowDoubleClick,
  actions,
  filterTabs,
  activeTab,
  onTabChange,
  className,
  rowDensity = 'default',
  amountAccessor,
  currency = 'USD',
  bulkActions,
  activeRowId,
  rowActions,
  contextMenuTitle,
  loading = false,
  skeletonRows = 8,
  tableId,
}: DataTableProps<TData, TValue>) {
  const location = useLocation();
  const viewKey = tableId ?? location.pathname;
  const savedViews = useSavedViews(viewKey);
  const defaultView = useMemo(() => {
    const st = readViewStore(viewKey);
    return st.views.find((v) => v.id === st.defaultId);
    // read once per table
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewKey]);
  const [activeViewId, setActiveViewId] = useState<string | undefined>(defaultView?.id);
  const [sorting, setSorting] = useState<SortingState>(defaultView?.sorting ?? []);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(
    defaultView ? visibilityFromHidden(defaultView.hidden) : {}
  );
  const [globalFilter, setGlobalFilter] = useState(defaultView?.search ?? '');
  const [focusedIndex, setFocusedIndex] = useState<number>(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const searchInputRef = useRef<HTMLInputElement>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const { setTableSelection, setFocusedElementShortcuts } = useLedgerStore();

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      globalFilter,
      columnVisibility,
    },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: (val) => {
      setGlobalFilter(val);
      setFocusedIndex(0);
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: {
        pageSize: 15,
      },
    },
  });

  const rows = table.getRowModel().rows;

  // A default view also restores its filter tab once on mount.
  useEffect(() => {
    if (defaultView?.tab && defaultView.tab !== activeTab) onTabChange?.(defaultView.tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyView = (v: SavedView) => {
    setGlobalFilter(v.search);
    setSorting(v.sorting);
    setColumnVisibility(visibilityFromHidden(v.hidden));
    if (v.tab !== undefined) onTabChange?.(v.tab);
    setActiveViewId(v.id);
  };

  // Row height per density
  const rowHeightClass = {
    compact: 'h-8',
    default: 'h-9',
    comfortable: 'h-10',
  }[rowDensity];

  // Helper to extract a unique ID for each row
  const getRowId = useCallback((row: any, idx: number): string => {
    return row.id || row.code || `row-${idx}`;
  }, []);

  // Compute total sum of selected rows
  const selectedSum = useMemo(() => {
    if (selectedIds.size === 0) return 0;
    return rows.reduce((sum, r) => {
      const id = getRowId(r.original, r.index);
      if (selectedIds.has(id)) {
        if (amountAccessor) {
          return sum + amountAccessor(r.original);
        }
        const item = r.original as any;
        const val = item.total ?? item.amount ?? item.balance ?? item.unit_price_fc ?? 0;
        return sum + (typeof val === 'number' ? Math.abs(val) : 0);
      }
      return sum;
    }, 0);
  }, [selectedIds, rows, amountAccessor, getRowId]);

  // Sync selection to BottomStatusBar store
  useEffect(() => {
    if (selectedIds.size > 0) {
      setTableSelection({
        count: selectedIds.size,
        sum: selectedSum,
        currency,
      });
    } else {
      setTableSelection(null);
    }
    return () => {
      setTableSelection(null);
    };
  }, [selectedIds, selectedSum, currency, setTableSelection]);

  // Sync focused element shortcuts to BottomStatusBar store
  useEffect(() => {
    setFocusedElementShortcuts([
      'j/k Move',
      'Enter Open',
      'Space Select',
      'Shift+F10 Menu',
      '/ Search',
      '[ / ] Page',
    ]);
    return () => {
      setFocusedElementShortcuts(null);
    };
  }, [setFocusedElementShortcuts]);

  // Scroll focused row into view
  useEffect(() => {
    if (focusedIndex >= 0 && rowRefs.current[focusedIndex]) {
      rowRefs.current[focusedIndex]?.scrollIntoView({ block: 'nearest' });
    }
  }, [focusedIndex]);

  // Global Keyboard shortcuts handling for DataTable
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true';

      // "/" or Ctrl+F focuses search input from anywhere on screen
      if (
        (e.key === '/' && !isInput) ||
        ((e.key === 'f' || e.key === 'F') && (e.ctrlKey || e.metaKey))
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      // Inside search input: Escape clears and blurs, ArrowDown or Enter jumps into rows
      if (activeEl === searchInputRef.current) {
        if (e.key === 'Escape') {
          setGlobalFilter('');
          searchInputRef.current?.blur();
          return;
        }
        if (e.key === 'ArrowDown' || e.key === 'Enter') {
          if (rows.length > 0) {
            e.preventDefault();
            searchInputRef.current?.blur();
            setFocusedIndex(0);
            rowRefs.current[0]?.focus();
          }
          return;
        }
        return; // normal typing in search
      }

      // If user is typing in another input on screen, do not intercept
      if (isInput) return;

      // Escape clears multi-select
      if (e.key === 'Escape') {
        if (selectedIds.size > 0) {
          e.preventDefault();
          setSelectedIds(new Set());
        }
        return;
      }

      // j or ArrowDown moves selection down
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.min(prev + 1, rows.length - 1);
          if (rows[next]) onRowClick?.(rows[next].original);
          rowRefs.current[next]?.focus();
          return next;
        });
        return;
      }

      // k or ArrowUp moves selection up
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.max(prev - 1, 0);
          if (rows[next]) onRowClick?.(rows[next].original);
          rowRefs.current[next]?.focus();
          return next;
        });
        return;
      }

      // Enter opens focused item as tab
      if (e.key === 'Enter') {
        if (rows[focusedIndex]) {
          e.preventDefault();
          onRowDoubleClick?.(rows[focusedIndex].original);
        }
        return;
      }

      // Space or 'x' toggles multi-select on focused row
      if (e.key === ' ' || e.key === 'x') {
        if (rows[focusedIndex]) {
          e.preventDefault();
          const targetRow = rows[focusedIndex];
          const id = getRowId(targetRow.original, targetRow.index);
          setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          });
        }
        return;
      }

      // Shift+F10 opens ContextMenu
      if (e.key === 'F10' && e.shiftKey) {
        if (rows[focusedIndex] && rowRefs.current[focusedIndex]) {
          e.preventDefault();
          const targetEl = rowRefs.current[focusedIndex];
          const rect = targetEl?.getBoundingClientRect();
          const ev = new MouseEvent('contextmenu', {
            bubbles: true,
            cancelable: true,
            view: window,
            clientX: (rect?.left || 100) + 50,
            clientY: (rect?.top || 100) + 15,
          });
          targetEl?.dispatchEvent(ev);
        }
        return;
      }

      // '[' moves to previous page
      if (e.key === '[') {
        if (table.getCanPreviousPage()) {
          e.preventDefault();
          table.previousPage();
          setFocusedIndex(0);
        }
        return;
      }

      // ']' moves to next page
      if (e.key === ']') {
        if (table.getCanNextPage()) {
          e.preventDefault();
          table.nextPage();
          setFocusedIndex(0);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [rows, focusedIndex, selectedIds, onRowClick, onRowDoubleClick, table, getRowId]);

  const toggleSelectAll = () => {
    if (selectedIds.size === rows.length) {
      setSelectedIds(new Set());
    } else {
      const all = new Set(rows.map((r) => getRowId(r.original, r.index)));
      setSelectedIds(all);
    }
  };

  const selectedRowsList = useMemo(() => {
    return rows.filter((r) => selectedIds.has(getRowId(r.original, r.index))).map((r) => r.original);
  }, [rows, selectedIds, getRowId]);

  return (
    <div ref={tableContainerRef} className={cn('flex flex-col gap-3 relative', className)}>
      {/* Control Bar: Filter Tabs, Search & Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
        {/* Filter Tabs */}
        {filterTabs && filterTabs.length > 0 ? (
          <div className="flex items-center gap-1 bg-surface-neutral p-1 rounded-lg border border-border overflow-x-auto no-scrollbar flex-nowrap shrink-0 max-w-full">
            {filterTabs.map((tab) => {
              const isActive = activeTab === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => onTabChange?.(tab.value)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-md text-xs font-medium transition-colors shrink-0 whitespace-nowrap cursor-pointer',
                    isActive
                      ? 'bg-surface-elevated text-text-primary font-semibold'
                      : 'text-text-muted hover:text-text-primary'
                  )}
                >
                  <span>{tab.label}</span>
                  {tab.count !== undefined && (
                    <span
                      className={cn(
                        'text-[10px] px-1.5 py-0.2 rounded-[3px] font-mono',
                        isActive ? 'bg-accent-soft text-accent' : 'bg-surface-neutral text-text-secondary'
                      )}
                    >
                      {tab.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <div />
        )}

        <div className="flex flex-wrap items-center gap-2 sm:gap-2.5 w-full sm:w-auto sm:ml-auto">
          {/* Search box with / kbd badge */}
          <div className="relative flex-1 sm:flex-initial flex items-center min-w-[160px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 text-text-muted pointer-events-none" />
            <input
              ref={searchInputRef}
              type="text"
              value={globalFilter ?? ''}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 pl-8 pr-8 text-[13px] bg-surface border border-border rounded-lg text-text-primary placeholder:text-text-muted hover:border-border-strong focus:outline-none focus:border-accent focus:ring-2 focus:ring-[var(--ring)] w-full sm:w-64"
            />
            <Kbd className="absolute right-2 pointer-events-none">/</Kbd>
          </div>

          <ViewsMenu
            views={savedViews.views}
            defaultId={savedViews.defaultId}
            activeViewId={activeViewId}
            onApply={applyView}
            onSave={(name) => {
              const created = savedViews.save({
                name,
                search: globalFilter,
                tab: activeTab,
                sorting,
                hidden: hiddenFromVisibility(columnVisibility),
              });
              setActiveViewId(created.id);
            }}
            onSetDefault={savedViews.setDefault}
            onDelete={(id) => {
              savedViews.remove(id);
              if (activeViewId === id) setActiveViewId(undefined);
            }}
          />
          <ColumnsMenu table={table} />

          {/* Action buttons with kbd hints */}
          <div className="flex items-center gap-2 shrink-0">{actions}</div>
        </div>
      </div>

      {/* Floating Bulk Action Bar on Selection */}
      {selectedIds.size > 0 && (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="fixed bottom-14 left-1/2 z-40 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 items-center gap-4 rounded-lg border border-border-strong bg-surface-elevated py-2 pl-4 pr-2 text-xs shadow-popover"
        >
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
              <span className="flex size-5 items-center justify-center rounded-md bg-accent text-[11px] text-white">
                {selectedIds.size}
              </span>
              <span>selected</span>
            </span>
            {selectedSum > 0 && (
              <span className="hidden border-l border-border pl-3 text-text-secondary sm:inline">
                Total <strong className="font-semibold text-text-primary">{formatMoney(selectedSum, currency)}</strong>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {bulkActions ? (
              bulkActions(selectedRowsList, () => setSelectedIds(new Set()))
            ) : (
              <button
                type="button"
                onClick={() => {
                  const json = JSON.stringify(selectedRowsList, null, 2);
                  navigator.clipboard.writeText(json);
                  toast.success(`Exported ${selectedIds.size} records to clipboard as JSON`);
                }}
                className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-3 text-xs font-medium text-text-primary transition hover:bg-surface-neutral"
              >
                <Download className="size-3.5" />
                <span>Export ({selectedIds.size})</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-text-muted transition hover:bg-surface-neutral hover:text-text-primary"
            >
              <X className="size-3.5" />
              <span>Clear</span>
              <Kbd>Esc</Kbd>
            </button>
          </div>
        </div>
      )}

      {/* Dense Table (36px rows per spec, horizontal borders only, no vertical borders) */}
      <div className="border border-border rounded-lg bg-surface overflow-hidden">
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="sticky top-0 z-20">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-border text-col-header">
                  <th className="w-8 px-2 text-center bg-surface">
                    <button
                      type="button"
                      onClick={toggleSelectAll}
                      className="p-0.5 text-text-muted hover:text-text-primary cursor-pointer"
                      title="Select all rows on current page"
                    >
                      {selectedIds.size > 0 && selectedIds.size === rows.length ? (
                        <CheckSquare className="w-3.5 h-3.5 text-accent" />
                      ) : (
                        <Square className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </th>
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    return (
                      <th
                        key={header.id}
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          'group/th h-9 px-3 select-none bg-surface font-semibold text-text-muted transition-colors uppercase tracking-wide text-[11px]',
                          canSort && 'cursor-pointer hover:text-text-primary'
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {{
                            asc: <ChevronUp className="size-3.5 text-accent" />,
                            desc: <ChevronDown className="size-3.5 text-accent" />,
                          }[header.column.getIsSorted() as string] ??
                            (canSort ? (
                              <ArrowUpDown className="size-3 opacity-0 transition-opacity group-hover/th:opacity-60" />
                            ) : null)}
                        </div>
                      </th>
                    );
                  })}
                  {rowActions && <th className="w-0 p-0 bg-surface" />}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                Array.from({ length: skeletonRows }).map((_, i) => (
                  <tr key={`sk-${i}`} className={rowHeightClass} aria-hidden="true">
                    <td className="w-8 px-2" />
                    {table.getVisibleLeafColumns().map((col, ci) => (
                      <td key={col.id} className="px-3">
                        <Skeleton className={cn('h-3.5', ci === 0 ? 'w-24' : ci % 3 === 0 ? 'w-16' : 'w-32')} />
                      </td>
                    ))}
                    {rowActions && <td className="w-0 p-0" />}
                  </tr>
                ))
              ) : rows.length > 0 ? (
                rows.map((row, idx) => {
                  const item = row.original as any;
                  const rowId = getRowId(item, idx);
                  const isFocused = focusedIndex === idx;
                  const isSelected = selectedIds.has(rowId);
                  const isActive = activeRowId ? rowId === activeRowId : false;

                  return (
                    <ContextMenu key={row.id}>
                      <ContextMenuTrigger asChild>
                        <tr
                          ref={(el) => {
                            rowRefs.current[idx] = el;
                          }}
                          tabIndex={0}
                          data-focused={isFocused}
                          data-selected={isSelected}
                          data-active={isActive}
                          onClick={() => {
                            setFocusedIndex(idx);
                            onRowClick?.(row.original);
                          }}
                          onDoubleClick={() => onRowDoubleClick?.(row.original)}
                          className={cn(
                            rowHeightClass,
                            'transition-[background-color,height] duration-150 cursor-pointer group outline-none select-none relative',
                            isSelected
                              ? 'bg-accent-soft/50 hover:bg-accent-soft/70'
                              : isActive
                              ? 'bg-accent-soft/50 hover:bg-accent-soft/60 font-medium'
                              : isFocused
                              ? 'bg-surface-neutral/70 hover:bg-accent-soft/40 ring-1 ring-inset ring-accent/40'
                              : 'hover:bg-accent-soft/40'
                          )}
                        >
                          {(isActive || isSelected) && (
                            <span className="absolute left-0 top-0 bottom-0 w-[3px] bg-accent rounded-r z-10" />
                          )}
                          <td className="w-8 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedIds((prev) => {
                                  const next = new Set(prev);
                                  if (next.has(rowId)) next.delete(rowId);
                                  else next.add(rowId);
                                  return next;
                                });
                              }}
                              className="p-0.5 text-text-muted hover:text-text-primary cursor-pointer"
                            >
                              {isSelected ? (
                                <CheckSquare className="w-3.5 h-3.5 text-accent" />
                              ) : (
                                <Square className="w-3.5 h-3.5 opacity-40 group-hover:opacity-100" />
                              )}
                            </button>
                          </td>
                          {row.getVisibleCells().map((cell) => (
                            <td key={cell.id} className="px-3 text-text-secondary whitespace-nowrap">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                          {rowActions && (
                            <td className="relative w-0 p-0" onClick={(e) => e.stopPropagation()}>
                              <div className="absolute right-2 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 rounded-lg border border-border bg-surface-elevated p-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 group-focus-within:opacity-100">
                                {rowActions(row.original)
                                  .filter((a) => !a.destructive)
                                  .slice(0, 3)
                                  .map((a) => {
                                    const AIcon = a.icon ?? ExternalLink;
                                    return (
                                      <Tooltip key={a.label}>
                                        <TooltipTrigger asChild>
                                          <button
                                            type="button"
                                            aria-label={a.label}
                                            disabled={a.disabled}
                                            onClick={() => a.onClick(row.original)}
                                            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-neutral hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
                                          >
                                            <AIcon className="size-4" />
                                          </button>
                                        </TooltipTrigger>
                                        <TooltipContent shortcut={a.shortcut}>
                                          {a.disabled && a.disabledReason ? a.disabledReason : a.label}
                                        </TooltipContent>
                                      </Tooltip>
                                    );
                                  })}
                              </div>
                            </td>
                          )}
                        </tr>
                      </ContextMenuTrigger>
                      <ContextMenuContent className="min-w-[14rem]">
                        {(() => {
                          const title =
                            contextMenuTitle?.(row.original) ??
                            item?.number ?? item?.name ?? item?.code ?? item?.reference ?? null;
                          const custom = rowActions ? rowActions(row.original) : [];
                          const normal = custom.filter((x) => !x.destructive);
                          const danger = custom.filter((x) => x.destructive);
                          const toggleSel = () =>
                            setSelectedIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(rowId)) next.delete(rowId);
                              else next.add(rowId);
                              return next;
                            });
                          const renderCustom = (x: RowAction<TData>) => {
                            const XIcon = x.icon;
                            return (
                              <ContextMenuItem
                                key={x.label}
                                variant={x.destructive ? 'destructive' : 'default'}
                                disabled={x.disabled}
                                title={x.disabled ? x.disabledReason : undefined}
                                onClick={() => x.onClick(row.original)}
                              >
                                {XIcon ? <XIcon className="size-4" /> : <span className="size-4" />}
                                <span>{x.label}</span>
                                {x.shortcut && <ContextMenuShortcut><Kbd>{x.shortcut}</Kbd></ContextMenuShortcut>}
                              </ContextMenuItem>
                            );
                          };
                          return (
                            <>
                              {title && (
                                <>
                                  <ContextMenuLabel className="max-w-[16rem] truncate normal-case text-[13px] tracking-normal text-text-primary">
                                    {String(title)}
                                  </ContextMenuLabel>
                                  <ContextMenuSeparator />
                                </>
                              )}
                              <ContextMenuItem
                                onClick={() => {
                                  setFocusedIndex(idx);
                                  onRowClick?.(row.original);
                                }}
                              >
                                <Eye />
                                <span>View detail preview</span>
                              </ContextMenuItem>
                              <ContextMenuItem
                                onClick={() => {
                                  setFocusedIndex(idx);
                                  onRowDoubleClick?.(row.original);
                                }}
                              >
                                <FileText />
                                <span>Open in tab</span>
                                <ContextMenuShortcut><Kbd>Enter</Kbd></ContextMenuShortcut>
                              </ContextMenuItem>
                              {normal.map(renderCustom)}
                              <ContextMenuSeparator />
                              <ContextMenuItem onClick={toggleSel}>
                                {isSelected ? <CheckSquare /> : <Square />}
                                <span>{isSelected ? 'Deselect row' : 'Select row'}</span>
                                <ContextMenuShortcut><Kbd>Space</Kbd></ContextMenuShortcut>
                              </ContextMenuItem>
                              {(item?.number || item?.code || item?.total !== undefined || item?.amount !== undefined) && (
                                <ContextMenuSeparator />
                              )}
                              {item?.number && (
                                <ContextMenuItem onClick={() => navigator.clipboard.writeText(item.number)}>
                                  <Hash />
                                  <span>Copy number</span>
                                  <ContextMenuShortcut>{item.number}</ContextMenuShortcut>
                                </ContextMenuItem>
                              )}
                              {item?.code && (
                                <ContextMenuItem onClick={() => navigator.clipboard.writeText(item.code)}>
                                  <Copy />
                                  <span>Copy code</span>
                                  <ContextMenuShortcut>{item.code}</ContextMenuShortcut>
                                </ContextMenuItem>
                              )}
                              {(item?.total !== undefined || item?.amount !== undefined) && (
                                <ContextMenuItem
                                  onClick={() => {
                                    const val = item.total ?? item.amount;
                                    navigator.clipboard.writeText((val / 100).toFixed(2));
                                  }}
                                >
                                  <Copy />
                                  <span>Copy amount</span>
                                </ContextMenuItem>
                              )}
                              <ContextMenuSeparator />
                              <ContextMenuItem
                                onClick={() => {
                                  const json = JSON.stringify(row.original, null, 2);
                                  navigator.clipboard.writeText(json);
                                  toast.success('Record copied to clipboard');
                                }}
                              >
                                <Braces />
                                <span>Export row as JSON</span>
                              </ContextMenuItem>
                              {danger.length > 0 && (
                                <>
                                  <ContextMenuSeparator />
                                  {danger.map(renderCustom)}
                                </>
                              )}
                            </>
                          );
                        })()}
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={columns.length + 2} className="h-28 text-center text-xs text-text-muted">
                    No matching records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar with [ and ] shortcuts */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-surface text-xs text-text-muted">
          <div>
            Showing{' '}
            <span className="font-medium text-text-primary">
              {rows.length > 0
                ? table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1
                : 0}
            </span>{' '}
            to{' '}
            <span className="font-medium text-text-primary">
              {Math.min(
                (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
                table.getFilteredRowModel().rows.length
              )}
            </span>{' '}
            of <span className="font-medium text-text-primary">{table.getFilteredRowModel().rows.length}</span> entries
          </div>

          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => {
                table.previousPage();
                setFocusedIndex(0);
              }}
              disabled={!table.getCanPreviousPage()}
              className="flex size-7 items-center justify-center rounded-md border border-border bg-surface disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-neutral transition-colors cursor-pointer"
              title="Previous page (press '[')"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 text-[11px] tabular-nums">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
            </span>
            <button
              type="button"
              onClick={() => {
                table.nextPage();
                setFocusedIndex(0);
              }}
              disabled={!table.getCanNextPage()}
              className="flex size-7 items-center justify-center rounded-md border border-border bg-surface disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-neutral transition-colors cursor-pointer"
              title="Next page (press ']')"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
