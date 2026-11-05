/**
 * Bulk actions on a list (plan 3c.33). A bulk run is nothing but the single-document action called once per row, in
 * order, each with its own Idempotency intent and its own server verdict. Nothing here decides what a document may do:
 * a row the `can` hint does not offer is reported as not attempted, and a row the server refuses is reported with the
 * server's reason. Signing goes through `useSignedRun`, the only signing path (ADR-0004): the PIN is asked when the
 * server says `signature_required`, then the same call is retried with the same intent.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError } from '@/api/errors';
import { createIntent, type Intent } from '@/api/idempotency';
import { describeError } from '@/api/messages';
import { isSigningCancelled, useSignedRun } from '@/data/signing';

export interface BulkItem {
  id: string;
  /** What the person calls it in the list: the number, or "Draft" plus the contact. */
  label: string;
}

export interface BulkOutcome {
  id: string;
  label: string;
  state: 'done' | 'refused' | 'skipped';
  text: string;
}

export interface BulkResult {
  verb: string;
  outcomes: BulkOutcome[];
}

export function summarise(r: BulkResult): string {
  const done = r.outcomes.filter((o) => o.state === 'done').length;
  return `${done} of ${r.outcomes.length} ${r.verb}`;
}

/** The server's refusal in words: its violations when it lists them, else the standard message for the error. */
export function refusalText(e: unknown, describe?: (e: unknown) => string): string {
  if (e instanceof ApiError && e.isVersionConflict) return 'It changed after this list was loaded. Open it, check it, and try again.';
  return (describe ?? describeError)(e);
}

/**
 * The loop itself, apart from React so it can be tested. `run` is `useSignedRun().run`: it calls the function and, if
 * the server asks for a signature, waits for the PIN and calls it again.
 */
export async function runBulkRows<R extends BulkItem>(
  run: <T>(fn: () => Promise<T>) => Promise<T>,
  verb: string,
  rows: R[],
  offered: (r: R) => boolean,
  notOfferedText: string,
  call: (row: R, intent: Intent) => Promise<string>,
  describe?: (e: unknown) => string,
): Promise<BulkResult> {
  const outcomes: BulkOutcome[] = [];
  let cancelled = false;
  for (const row of rows) {
    if (!offered(row)) {
      outcomes.push({ id: row.id, label: row.label, state: 'skipped', text: notOfferedText });
      continue;
    }
    if (cancelled) {
      outcomes.push({ id: row.id, label: row.label, state: 'skipped', text: 'Not attempted: signing was cancelled.' });
      continue;
    }
    const intent = createIntent();
    try {
      const text = await run(() => call(row, intent));
      outcomes.push({ id: row.id, label: row.label, state: 'done', text });
    } catch (e) {
      if (isSigningCancelled(e)) {
        cancelled = true;
        outcomes.push({ id: row.id, label: row.label, state: 'skipped', text: 'Not attempted: signing was cancelled.' });
      } else outcomes.push({ id: row.id, label: row.label, state: 'refused', text: refusalText(e, describe) });
    }
  }
  return { verb, outcomes };
}

export function useBulkRun() {
  const { run, signProps } = useSignedRun();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  /**
   * @param verb past tense for the summary ("submitted")
   * @param offered rows the `can` hints offer this action for; the rest are listed as not attempted with `notOfferedText`
   * @param call the existing single-document action; returns a short success note ("Posted as INV-12")
   */
  const execute = useCallback(
    async <R extends BulkItem>(verb: string, rows: R[], offered: (r: R) => boolean, notOfferedText: string, call: (row: R, intent: Intent) => Promise<string>, describe?: (e: unknown) => string): Promise<BulkResult> => {
      setBusy(true);
      try {
        const r = await runBulkRows(run, verb, rows, offered, notOfferedText, call, describe);
        setResult(r);
        return r;
      } finally {
        setBusy(false);
      }
    },
    [run],
  );

  return { execute, busy, result, clearResult: () => setResult(null), signProps };
}

/** Row selection that survives a refetch but drops rows that left the list (another tab, a filter, a posted draft). */
export function useRowSelection<T extends { id: string }>(rows: T[]) {
  const [ids, setIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    setIds((prev) => {
      if (prev.size === 0) return prev;
      const present = new Set(rows.map((r) => r.id));
      const next = new Set([...prev].filter((id) => present.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [rows]);
  const selected = useMemo(() => rows.filter((r) => ids.has(r.id)), [rows, ids]);
  const toggle = useCallback(
    (id: string) =>
      setIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    [],
  );
  const clear = useCallback(() => setIds(new Set()), []);
  const allSelected = rows.length > 0 && rows.every((r) => ids.has(r.id));
  const toggleAll = useCallback(() => setIds(allSelected ? new Set() : new Set(rows.map((r) => r.id))), [allSelected, rows]);
  return { selected, isSelected: (id: string) => ids.has(id), toggle, toggleAll, clear, allSelected, some: ids.size > 0 };
}
