/**
 * Signed actions (ADR-0004, docs/15 rule 6). `run(fn)` calls the action; when the server answers 403
 * `signature_required` it opens the SignDialog, the dialog verifies the PIN at POST /signing/verify, and then the SAME
 * `fn` runs again, so the closure's Idempotency intent is reused. The PIN never reaches this module.
 */
import { useCallback, useRef, useState } from 'react';
import { ApiError } from '@/api/errors';

export class SigningCancelled extends Error {
  constructor() {
    super('Signing was cancelled.');
    this.name = 'SigningCancelled';
  }
}

interface Pending {
  fn: () => Promise<unknown>;
  resolve: (v: unknown) => void;
  reject: (e: unknown) => void;
}

export const isSigningCancelled = (e: unknown): boolean => e instanceof SigningCancelled;

export function useSignedRun() {
  const [open, setOpen] = useState(false);
  const pending = useRef<Pending | null>(null);

  const attempt = useCallback(async (p: Pending): Promise<void> => {
    try {
      p.resolve(await p.fn());
    } catch (e) {
      if (e instanceof ApiError && e.isSignatureRequired) {
        pending.current = p;
        setOpen(true);
        return;
      }
      p.reject(e);
    }
  }, []);

  const run = useCallback(
    <T,>(fn: () => Promise<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        void attempt({ fn, resolve: resolve as (v: unknown) => void, reject });
      }),
    [attempt],
  );

  /** SignDialog calls this once the server accepted the PIN. */
  const onConfirm = useCallback(() => {
    const p = pending.current;
    pending.current = null;
    setOpen(false);
    if (p) void attempt(p);
  }, [attempt]);

  const onClose = useCallback(() => {
    const p = pending.current;
    pending.current = null;
    setOpen(false);
    p?.reject(new SigningCancelled());
  }, []);

  return { run, signProps: { isOpen: open, onConfirm, onClose } };
}
