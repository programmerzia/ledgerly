/**
 * Shared field styling and small pieces for the live-mode screens (auth, onboarding, settings).
 * Same look as pages/Auth/Login: plain inputs, one accent button, errors in words under the field.
 */
import React from 'react';
import { describeError } from '@/api/messages';

export const field =
  'h-9 px-3 bg-surface border border-border-strong rounded-md text-[14px] text-text-primary transition focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/15 disabled:opacity-60';
export const primary =
  'h-9 px-4 rounded-md bg-accent text-[14px] font-medium text-white transition hover:bg-accent-hover cursor-pointer disabled:opacity-60 disabled:cursor-default';
export const secondary =
  'h-9 px-4 rounded-md border border-border-strong bg-surface text-[14px] font-medium text-text-primary transition hover:bg-surface-neutral cursor-pointer disabled:opacity-60 disabled:cursor-default';

export const Field: React.FC<{ id: string; label: string; error?: string; hint?: string; children: React.ReactNode }> = ({ id, label, error, hint, children }) => (
  <div className="flex flex-col gap-1.5">
    <label htmlFor={id} className="text-[13px] font-medium text-text-primary">{label}</label>
    {children}
    {hint && !error && <span className="text-xs text-text-muted">{hint}</span>}
    {error && <span role="alert" className="text-xs text-danger">{error}</span>}
  </div>
);

export const FormError: React.FC<{ error: unknown }> = ({ error }) =>
  error ? <p role="alert" className="text-[13px] text-danger">{describeError(error)}</p> : null;

/** One quiet line for a loading state. */
export const Loading: React.FC<{ what?: string }> = ({ what = 'Loading' }) => (
  <p role="status" className="text-[13px] text-text-muted">{what}…</p>
);

/** Error line with a retry, the shape every live screen uses. */
export const LoadError: React.FC<{ error: unknown; onRetry: () => void }> = ({ error, onRetry }) => (
  <div role="alert" className="text-[13px] text-danger">
    {describeError(error)}{' '}
    <button type="button" onClick={onRetry} className="text-accent hover:underline cursor-pointer">Try again</button>
  </div>
);
