import React, { useCallback, useState } from 'react';
import type { SortingState, Table, VisibilityState } from '@tanstack/react-table';
import { Bookmark, Columns3, Star, Trash2, Check } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

/** A saved arrangement of a list: search text, filter tab, sort and visible columns. */
export interface SavedView {
  id: string;
  name: string;
  search: string;
  tab?: string;
  sorting: SortingState;
  /** Column ids that are hidden. */
  hidden: string[];
}

interface ViewStore {
  views: SavedView[];
  defaultId?: string;
}

const storageKey = (tableId: string) => `ledgerly_table_views:${tableId}`;

export function readViewStore(tableId: string): ViewStore {
  try {
    const raw = localStorage.getItem(storageKey(tableId));
    if (raw) {
      const parsed = JSON.parse(raw) as ViewStore;
      if (Array.isArray(parsed.views)) return parsed;
    }
  } catch {
    /* ignore corrupt storage */
  }
  return { views: [] };
}

/** Saved views for one table, persisted in localStorage under `tableId`. */
export function useSavedViews(tableId: string) {
  const [store, setStore] = useState<ViewStore>(() => readViewStore(tableId));
  const persist = useCallback(
    (next: ViewStore) => {
      setStore(next);
      try {
        localStorage.setItem(storageKey(tableId), JSON.stringify(next));
      } catch {
        /* storage full or blocked: keep in memory */
      }
    },
    [tableId]
  );
  const save = (view: Omit<SavedView, 'id'>) => {
    const created: SavedView = { ...view, id: `view-${Date.now()}` };
    persist({ ...store, views: [...store.views, created] });
    return created;
  };
  const remove = (id: string) =>
    persist({ views: store.views.filter((v) => v.id !== id), defaultId: store.defaultId === id ? undefined : store.defaultId });
  const setDefault = (id: string | undefined) => persist({ ...store, defaultId: id });
  return { views: store.views, defaultId: store.defaultId, save, remove, setDefault };
}

interface ViewsMenuProps {
  views: SavedView[];
  defaultId?: string;
  currentLabel?: string;
  onApply: (view: SavedView) => void;
  onSave: (name: string) => void;
  onSetDefault: (id: string | undefined) => void;
  onDelete: (id: string) => void;
  activeViewId?: string;
}

export const ViewsMenu: React.FC<ViewsMenuProps> = ({ views, defaultId, onApply, onSave, onSetDefault, onDelete, activeViewId }) => {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave(trimmed);
    setName('');
    toast.success(`Saved view "${trimmed}"`);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Saved views"
          className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-text-secondary transition hover:border-border-strong hover:bg-surface-neutral hover:text-text-primary"
        >
          <Bookmark className="size-3.5" />
          <span>Views</span>
          {views.length > 0 && <span className="rounded-full bg-surface-neutral px-1.5 text-[10px] tabular-nums">{views.length}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2">
        <div className="px-2 pb-1 pt-0.5 text-[11px] font-semibold text-text-muted">Saved views</div>
        {views.length === 0 ? (
          <p className="px-2 pb-2 text-xs text-text-muted">
            Set up the list the way you like it (search, tab, sort, columns), then save it below.
          </p>
        ) : (
          <ul className="mb-2 flex max-h-56 flex-col gap-0.5 overflow-auto">
            {views.map((v) => (
              <li key={v.id} className="group flex items-center gap-1 rounded-md hover:bg-surface-neutral">
                <button
                  type="button"
                  onClick={() => {
                    onApply(v);
                    setOpen(false);
                  }}
                  className="flex h-8 min-w-0 flex-1 cursor-pointer items-center gap-2 px-2 text-left text-[13px] text-text-primary"
                >
                  {activeViewId === v.id ? <Check className="size-3.5 text-accent" /> : <span className="size-3.5" />}
                  <span className="truncate">{v.name}</span>
                  {defaultId === v.id && <span className="rounded bg-accent-soft px-1 text-[10px] font-medium text-accent">Default</span>}
                </button>
                <button
                  type="button"
                  title={defaultId === v.id ? 'Remove as default' : 'Open this view by default'}
                  aria-label={defaultId === v.id ? `Remove ${v.name} as default` : `Make ${v.name} the default`}
                  onClick={() => onSetDefault(defaultId === v.id ? undefined : v.id)}
                  className={cn(
                    'flex size-7 cursor-pointer items-center justify-center rounded-md text-text-muted hover:text-warning',
                    defaultId === v.id && 'text-warning'
                  )}
                >
                  <Star className={cn('size-3.5', defaultId === v.id && 'fill-current')} />
                </button>
                <button
                  type="button"
                  title="Delete view"
                  aria-label={`Delete ${v.name}`}
                  onClick={() => onDelete(v.id)}
                  className="flex size-7 cursor-pointer items-center justify-center rounded-md text-text-muted hover:text-danger"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex items-center gap-1.5 border-t border-border px-1 pt-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Name this view"
            aria-label="View name"
            className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-surface px-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim()}
            className="h-8 cursor-pointer rounded-lg bg-accent px-3 text-xs font-semibold text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            Save
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
};

export function ColumnsMenu<TData>({ table }: { table: Table<TData> }) {
  const cols = table.getAllLeafColumns().filter((c) => c.getCanHide());
  if (cols.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Show or hide columns"
          className="flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 text-xs font-medium text-text-secondary transition hover:border-border-strong hover:bg-surface-neutral hover:text-text-primary"
        >
          <Columns3 className="size-3.5" />
          <span>Columns</span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        {cols.map((c) => {
          const header = c.columnDef.header;
          const label = typeof header === 'string' && header ? header : c.id.replace(/[_-]/g, ' ');
          return (
            <DropdownMenuCheckboxItem
              key={c.id}
              checked={c.getIsVisible()}
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(v) => c.toggleVisibility(!!v)}
              className="capitalize"
            >
              {label}
            </DropdownMenuCheckboxItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const hiddenFromVisibility = (v: VisibilityState): string[] => Object.keys(v).filter((k) => v[k] === false);
export const visibilityFromHidden = (hidden: string[]): VisibilityState =>
  Object.fromEntries(hidden.map((h) => [h, false]));
