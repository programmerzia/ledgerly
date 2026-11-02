/**
 * "signature_required -> SignDialog -> verify -> retry the same intent" (docs/15 rule 6/7).
 * `run(attempt, ctx)` calls `attempt()`; if the server answers 403 signature_required it opens the dialog,
 * verifies the PIN with POST /signing/verify and calls `attempt()` again. The caller's `attempt` closes over one
 * Intent, so the retry reuses the Idempotency-Key. Anything else is rethrown to the caller untouched.
 */
import React, { useCallback, useRef, useState } from 'react';
import { verifySigningPin } from './signing';
import { ApiError } from '@/api/errors';
import { LiveSignDialog } from '@/components/domain/LiveSignDialog';

export interface SignContext {
  title: string;
  consequence: string;
  actionTitle?: string;
}

/** The user closed the dialog without signing. Not an error to show. */
export class SignCancelled extends Error {
  constructor() {
    super('Signing cancelled');
    this.name = 'SignCancelled';
  }
}
export const isSignCancelled = (e: unknown): e is SignCancelled => e instanceof SignCancelled;

interface Pending<T = unknown> {
  ctx: SignContext;
  attempt: () => Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
}

export function useSignedRunner(): { run: <T>(attempt: () => Promise<T>, ctx: SignContext) => Promise<T>; dialog: React.ReactNode } {
  const [pending, setPending] = useState<Pending | null>(null);
  const ref = useRef<Pending | null>(null);
  ref.current = pending;

  const run = useCallback(<T,>(attempt: () => Promise<T>, ctx: SignContext): Promise<T> => {
    return attempt().catch((e: unknown) => {
      if (!(e instanceof ApiError) || !e.isSignatureRequired) throw e;
      return new Promise<T>((resolve, reject) => {
        setPending({ ctx, attempt, resolve: resolve as (v: unknown) => void, reject });
      });
    });
  }, []);

  const verify = async (pin: string) => {
    const p = ref.current;
    if (!p) return;
    await verifySigningPin(pin);
    // Granted. Retry the very same intent. A second signature_required (grant expired) keeps the dialog open.
    try {
      const value = await p.attempt();
      setPending(null);
      p.resolve(value);
    } catch (e) {
      if (e instanceof ApiError && e.isSignatureRequired) throw e;
      setPending(null);
      p.reject(e);
    }
  };

  const close = () => {
    const p = ref.current;
    setPending(null);
    p?.reject(new SignCancelled());
  };

  const dialog = (
    <LiveSignDialog
      open={pending !== null}
      title={pending?.ctx.title ?? ''}
      consequence={pending?.ctx.consequence ?? ''}
      actionTitle={pending?.ctx.actionTitle}
      onVerify={verify}
      onClose={close}
    />
  );
  return { run, dialog };
}
