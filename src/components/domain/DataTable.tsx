import React, { useState } from 'react';
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
} from '@tanstack/react-table';
import { Search, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Copy, ExternalLink, FileText, Download } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';

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
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [globalFilter, setGlobalFilter] = useState('');

  const table = useReactTable({
    data,
    columns,
    state: {
      sorting,
      globalFilter,
    },
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
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

  const rowHeightClass = {
    compact: 'h-8',
    default: 'h-9',
    comfortable: 'h-10',
  }[rowDensity];

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {/* Control Bar: Filter Tabs, Search & Action Buttons */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-3">
        {/* Filter Tabs */}
        {filterTabs && filterTabs.length > 0 ? (
          <div className="flex items-center gap-1 bg-surface-neutral p-1 rounded-sm border border-border overflow-x-auto no-scrollbar flex-nowrap shrink-0 max-w-full">
            {filterTabs.map((tab) => {
              const isActive = activeTab === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => onTabChange?.(tab.value)}
                  className={cn(
                    'flex items-center gap-1.5 px-2.5 sm:px-3 py-1 rounded-sm text-xs font-medium transition-colors shrink-0 whitespace-nowrap',
                    isActive
                      ? 'bg-surface-elevated text-text-primary shadow-xs font-semibold'
                      : 'text-text-muted hover:text-text-primary'
                  )}
                >
                  <span>{tab.label}</span>
                  {tab.count !== undefined && (
                    <span
                      className={cn(
                        'text-[10px] px-1.5 py-0.2 rounded-full font-mono',
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
          {/* Search box */}
          <div className="relative flex-1 sm:flex-initial flex items-center min-w-[140px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 text-text-muted pointer-events-none" />
            <input
              type="text"
              value={globalFilter ?? ''}
              onChange={(e) => setGlobalFilter(e.target.value)}
              placeholder={searchPlaceholder}
              className="h-8 pl-8 pr-3 text-xs bg-surface border border-border rounded-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-accent w-full sm:w-60"
            />
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {actions}
          </div>
        </div>
      </div>

      {/* Dense Table (36px rows per spec, horizontal borders only, no vertical borders) */}
      <div className="border border-border rounded-md bg-surface overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="bg-surface-neutral/80 border-b border-border text-col-header">
                  {headerGroup.headers.map((header) => {
                    const canSort = header.column.getCanSort();
                    return (
                      <th
                        key={header.id}
                        onClick={header.column.getToggleSortingHandler()}
                        className={cn(
                          'h-8 px-3 select-none font-semibold text-text-muted transition-colors uppercase tracking-wider text-[11px]',
                          canSort && 'cursor-pointer hover:bg-surface-neutral'
                        )}
                      >
                        <div className="flex items-center gap-1.5">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {{
                            asc: <ChevronUp className="w-3.5 h-3.5 text-accent" />,
                            desc: <ChevronDown className="w-3.5 h-3.5 text-accent" />,
                          }[header.column.getIsSorted() as string] ?? null}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border">
              {table.getRowModel().rows.length > 0 ? (
                table.getRowModel().rows.map((row) => {
                  const item = row.original as any;
                  return (
                    <ContextMenu key={row.id}>
                      <ContextMenuTrigger asChild>
                        <tr
                          onClick={() => onRowClick?.(row.original)}
                          onDoubleClick={() => onRowDoubleClick?.(row.original)}
                          className={cn(
                            rowHeightClass,
                            'hover:bg-surface-neutral transition-colors cursor-pointer group'
                          )}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <td key={cell.id} className="px-3 text-text-secondary whitespace-nowrap">
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          ))}
                        </tr>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem onClick={() => onRowClick?.(row.original)}>
                          <ExternalLink className="mr-2 h-3.5 w-3.5" />
                          <span>Open Document</span>
                        </ContextMenuItem>
                        <ContextMenuItem onClick={() => onRowDoubleClick?.(row.original)}>
                          <FileText className="mr-2 h-3.5 w-3.5" />
                          <span>Open in New Tab</span>
                        </ContextMenuItem>
                        <ContextMenuSeparator />
                        {item?.number && (
                          <ContextMenuItem
                            onClick={() => navigator.clipboard.writeText(item.number)}
                          >
                            <Copy className="mr-2 h-3.5 w-3.5" />
                            <span>Copy Number ({item.number})</span>
                          </ContextMenuItem>
                        )}
                        {item?.total !== undefined && (
                          <ContextMenuItem
                            onClick={() =>
                              navigator.clipboard.writeText((item.total / 100).toFixed(2))
                            }
                          >
                            <Copy className="mr-2 h-3.5 w-3.5" />
                            <span>Copy Amount (${(item.total / 100).toFixed(2)})</span>
                          </ContextMenuItem>
                        )}
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          onClick={() => {
                            const json = JSON.stringify(row.original, null, 2);
                            navigator.clipboard.writeText(json);
                          }}
                        >
                          <Download className="mr-2 h-3.5 w-3.5" />
                          <span>Export Selection (JSON)</span>
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={columns.length} className="h-28 text-center text-xs text-text-muted">
                    No matching records found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Bar */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-surface-neutral/40 text-xs text-text-muted">
          <div>
            Showing{' '}
            <span className="font-medium text-text-primary">
              {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1}
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
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="p-1 rounded border border-border bg-surface disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-neutral transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="px-2 font-mono text-[11px]">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
            </span>
            <button
              type="button"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="p-1 rounded border border-border bg-surface disabled:opacity-40 disabled:cursor-not-allowed hover:bg-surface-neutral transition-colors"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
