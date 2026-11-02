import React from 'react';
import { describeError } from '@/api/messages';
import { ApiError } from '@/api/errors';
import { describeViolation } from '@/api/violations';

/** One line while loading (docs/03 §1.1: no spinners as decoration). */
export const LoadingLine: React.FC<{ what: string }> = ({ what }) => (
  <p className="p-4 text-[13px] text-text-muted" role="status">
    Loading {what}…
  </p>
);

/** One line plus "Try again". */
export const ErrorLine: React.FC<{ error: unknown; onRetry?: () => void }> = ({ error, onRetry }) => (
  <div className="p-4 text-[13px] text-danger" role="alert">
    {describeError(error)}{' '}
    {onRetry && (
      <button type="button" onClick={onRetry} className="cursor-pointer text-accent hover:underline">
        Try again
      </button>
    )}
  </div>
);

/** A server verdict as text for a toast or banner: the message plus each violation in plain language. */
export function verdictText(e: unknown): string {
  if (e instanceof ApiError && e.violations?.length) return e.violations.map(describeViolation).join(' ');
  return describeError(e);
}

export const inputClass =
  'h-8 rounded-md border border-border bg-surface px-2.5 text-xs text-text-primary focus:border-accent focus:outline-none';
