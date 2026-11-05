/**
 * Keyboard shortcuts that belong to one live screen (plan 3c.36). The global ones (go-to chords, command palette, new)
 * live in `shortcuts.ts` and AppShell; these are registered while the screen is mounted.
 *
 * - `useFormShortcuts`: Ctrl/Cmd+S saves the draft, Ctrl/Cmd+Enter submits. They run the very functions the buttons run,
 *   so a shortcut can never do what the button would refuse: pass `undefined` while the button is disabled.
 * - `useListKeys`: J/K move through the rows, X ticks a row, Enter or O opens it, "/" goes to the search box.
 */
import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

const typing = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable));
};
const inDialog = (): boolean => document.querySelector('[role="dialog"]') !== null;

export function useFormShortcuts(handlers: { save?: () => unknown; submit?: () => unknown }): void {
  const ref = useRef(handlers);
  ref.current = handlers;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.defaultPrevented || inDialog()) return;
      const key = e.key.toLowerCase();
      if (key === 's' && !e.shiftKey) {
        e.preventDefault(); // always: the browser's own "save page" is never wanted here
        void ref.current.save?.();
      } else if (key === 'enter' && ref.current.submit) {
        e.preventDefault();
        void ref.current.submit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export interface ListKeysOptions<T extends { id: string }> {
  rows: T[];
  onOpen: (row: T) => void;
  onToggle?: (row: T) => void;
  searchRef?: RefObject<HTMLInputElement | null>;
  /** Off while something else owns the keyboard. */
  enabled?: boolean;
}

/** Returns the id of the row the keys are on; the list marks it. */
export function useListKeys<T extends { id: string }>({ rows, onOpen, onToggle, searchRef, enabled = true }: ListKeysOptions<T>): string | null {
  const [index, setIndex] = useState<number | null>(null);
  const ref = useRef({ rows, onOpen, onToggle, searchRef, index });
  ref.current = { rows, onOpen, onToggle, searchRef, index };

  useEffect(() => {
    // The rows changed under the cursor (another tab, a filter): start again rather than point at a stranger.
    setIndex(null);
  }, [rows.length > 0 ? rows[0].id : '', rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || inDialog()) return;
      const { rows: rs, index: i } = ref.current;
      if (e.key === '/' && !typing(e.target)) {
        const input = ref.current.searchRef?.current;
        if (input) {
          e.preventDefault();
          input.focus();
          input.select();
        }
        return;
      }
      if (typing(e.target) || rs.length === 0) return;
      const row = i === null ? undefined : rs[i];
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setIndex(i === null ? 0 : Math.min(i + 1, rs.length - 1));
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setIndex(i === null ? 0 : Math.max(i - 1, 0));
      } else if (e.key === 'x' && row && ref.current.onToggle) {
        e.preventDefault();
        ref.current.onToggle(row);
      } else if ((e.key === 'o' || e.key === 'Enter') && row) {
        // Enter on a button or link is that control's own business.
        if (e.key === 'Enter' && (e.target as HTMLElement | null)?.closest?.('button, a, [role="checkbox"]')) return;
        e.preventDefault();
        ref.current.onOpen(row);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);

  const row = index === null ? undefined : rows[index];
  const id = row?.id ?? null;
  useEffect(() => {
    if (id) document.querySelector(`[data-row-id="${id}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [id]);
  return id;
}
