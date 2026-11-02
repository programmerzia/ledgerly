import { toast } from 'sonner';
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import { useLedgerStore } from '@/mock/store';
import { isSigningCancelled } from '@/data/signing';

/**
 * Text for a failed live write. Violations the server lists (`violations[].message`) follow the main sentence, so
 * "period_checks_failed" reads as the server's verdict, not ours.
 */
export function describeProblem(e: unknown): string {
  const base = describeError(e);
  if (e instanceof ApiError && e.violations?.length) return `${base} ${e.violations.map((v) => v.message).join(' ')}`;
  return base;
}

/** First message of a 422 field error map, flattened (`errors` keyed by field). */
export function validationLines(e: unknown): string[] {
  if (!(e instanceof ApiError) || !e.errors) return [];
  return Object.values(e.errors).flat();
}

/**
 * Version conflict (409 version_conflict): the existing ConflictDialog is shown with the server's version, and the
 * affected queries are refetched so the screen shows the server's data once the dialog is dismissed.
 * Returns true when it handled the error.
 */
export function handleVersionConflict(e: unknown, opts: { subject: string; documentId: string; local: unknown; client: QueryClient; keys: QueryKey[] }): boolean {
  if (!(e instanceof ApiError) || !e.isVersionConflict) return false;
  const server = e.serverVersion;
  useLedgerStore.getState().setPendingConflict({
    documentId: opts.documentId,
    serverVersion: { memo: `${opts.subject} is now at version ${String(server ?? '?')} on the server.` },
    localVersion: { memo: `Your change was based on an older version${opts.local ? `: ${String(opts.local)}` : ''}.` },
  });
  for (const key of opts.keys) void opts.client.invalidateQueries({ queryKey: key });
  return true;
}

/** Toast for any failed write that the caller did not already handle. Cancelling the PIN prompt is silent. */
export function toastProblem(e: unknown): void {
  if (isSigningCancelled(e)) return;
  toast.error(describeProblem(e));
}

/** Thrown by a live action after it already told the user (e.g. opened the ConflictDialog); callers just stop. */
export class Handled extends Error {
  constructor(readonly original: unknown) {
    super('Handled');
    this.name = 'Handled';
  }
}
