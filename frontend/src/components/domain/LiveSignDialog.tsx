/**
 * Live-mode signing prompt (13 §signing). The mock SignDialog checks a PIN stored in the browser; this one never
 * sees a stored PIN: it hands the six digits to `onVerify`, which calls POST /signing/verify, and shows the
 * server's verdict (wrong PIN, locked, no PIN set) keyed on the error `code`. Same look as SignDialog.
 */
import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/api/errors';

export interface LiveSignDialogProps {
  open: boolean;
  title: string;
  consequence: string;
  actionTitle?: string;
  /** Throws an ApiError when the PIN is refused; resolves when the server granted the signature. */
  onVerify: (pin: string) => Promise<void>;
  onClose: () => void;
}

/** User-facing text for a signing verdict. Branches on `code`, never on message text. */
export function describeSigningError(e: unknown): string {
  if (e instanceof ApiError) {
    switch (e.code) {
      case 'signing_failed':
        return 'That PIN is not right.';
      case 'signing_locked':
        return 'Signing is paused after too many wrong PINs. Try again in a few minutes.';
      case 'signing_pin_not_set':
        return 'You have not set a signing PIN yet. Set one in Settings, then Security.';
      case 'validation_failed':
        return 'Enter all 6 digits of your PIN.';
      default:
        return e.detail || 'The PIN could not be checked. Try again.';
    }
  }
  return 'The PIN could not be checked. Try again.';
}

export const LiveSignDialog: React.FC<LiveSignDialogProps> = ({ open, title, consequence, actionTitle = 'Sign', onVerify, onClose }) => {
  const [pin, setPin] = useState(['', '', '', '', '', '']);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const [busy, setBusy] = useState(false);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    setPin(['', '', '', '', '', '']);
    setError(null);
    setLocked(false);
    const t = setTimeout(() => refs.current[0]?.focus(), 50);
    return () => clearTimeout(t);
  }, [open]);

  const change = (i: number, val: string) => {
    if (val.length > 1) {
      const digits = val.replace(/\D/g, '').slice(0, 6).split('');
      const next = ['', '', '', '', '', ''];
      digits.forEach((d, k) => (next[k] = d));
      setPin(next);
      refs.current[Math.min(digits.length, 5)]?.focus();
      return;
    }
    const digit = val.replace(/\D/g, '').slice(-1);
    const next = [...pin];
    next[i] = digit;
    setPin(next);
    setError(null);
    if (digit && i < 5) refs.current[i + 1]?.focus();
  };

  const submit = async () => {
    const full = pin.join('');
    if (full.length < 6) {
      setError('Enter all 6 digits of your PIN.');
      return;
    }
    setBusy(true);
    try {
      await onVerify(full);
    } catch (e) {
      setError(describeSigningError(e));
      setLocked(e instanceof ApiError && e.code === 'signing_locked');
      setPin(['', '', '', '', '', '']);
      refs.current[0]?.focus();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-[560px] overflow-hidden border-border bg-surface-elevated p-0 shadow-popover">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold text-text-primary">Confirm with your PIN</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-5 p-6">
          <div className="rounded-lg border border-border bg-surface p-4">
            <div className="text-[13px] font-medium text-text-primary">{title}</div>
            <div className="mt-2 flex gap-2.5 text-xs leading-relaxed text-text-secondary">
              <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-accent" />
              <p>{consequence}</p>
            </div>
          </div>
          {locked ? (
            <div className="space-y-2 rounded-lg border border-danger/30 bg-danger-soft p-5 text-center" role="alert">
              <Lock className="mx-auto size-6 text-danger" />
              <div className="text-sm font-semibold text-danger">Signing is paused</div>
              <p className="text-xs text-text-secondary">{error}</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="text-sm font-semibold text-text-primary">Enter your 6-digit PIN</div>
                <p className="mt-0.5 text-xs text-text-muted">This is your personal signing PIN, not your login password.</p>
              </div>
              <div className="flex items-center gap-2">
                {pin.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      refs.current[i] = el;
                    }}
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={digit}
                    aria-label={`PIN digit ${i + 1}`}
                    disabled={busy}
                    onChange={(e) => change(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' && !pin[i] && i > 0) refs.current[i - 1]?.focus();
                      else if (e.key === 'Enter') {
                        e.preventDefault();
                        void submit();
                      }
                    }}
                    className={cn(
                      'size-11 flex-1 rounded-lg border bg-surface text-center text-lg font-semibold text-text-primary transition outline-none',
                      'focus:border-accent focus:ring-2 focus:ring-accent/25',
                      digit && 'border-border-strong bg-surface-neutral',
                      error ? 'border-danger focus:border-danger focus:ring-danger/25' : !digit && 'border-border',
                    )}
                  />
                ))}
              </div>
              {error && (
                <div className="flex items-start gap-1.5 text-xs font-medium text-danger" role="alert">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          )}
          <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
            <button type="button" onClick={onClose} disabled={busy} className="h-8 rounded-md border border-border px-3 text-[13px] font-medium text-text-secondary transition hover:bg-surface-neutral">
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={busy || locked}
              className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? 'Checking…' : actionTitle}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
