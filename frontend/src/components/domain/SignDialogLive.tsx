/**
 * SignDialog against the real API (ADR-0004, 13 §10). Same props and layout as the demo dialog; the difference is
 * who decides. The PIN goes to POST /signing/verify and nowhere else: it is not compared in the browser, not kept in
 * the store, not cached for the next action (the server's 10-minute signing grant does that), and the boxes are
 * cleared the moment the answer arrives.
 *
 * Server verdicts handled here: `signing_failed` (wrong PIN), `signing_locked` (423, countdown), `signing_pin_not_set`
 * (409, a path to set it), `rate_limited`, and any other error as plain text.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Lock, KeyRound } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import { formatMoney } from '@/lib/format';
import { useLedgerStore } from '@/mock/store';
import { useMe } from '@/data/session';
import { verifySigningPin } from '@/api/live/signing';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import type { SignDialogProps } from './SignDialog';

/** The server locks for 15 minutes after three wrong PINs (PinPolicy) but does not send the remaining time. */
export const SIGNING_LOCK_SECONDS = 15 * 60;

/** When the lock ends, as far as this tab knows. Memory only, and never the PIN. */
let lockedUntilMs = 0;

export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const EMPTY = ['', '', '', '', '', ''];

export const SignDialogLive: React.FC<SignDialogProps> = ({
  isOpen,
  onClose,
  onConfirm,
  documentTitle,
  documentNumber,
  amount,
  currency = 'USD',
  periodName,
  makerName,
  actionTitle = 'Approve and sign',
  consequenceText,
  requireReason = false,
}) => {
  const currentUser = useLedgerStore((s) => s.currentUser);
  const slug = useLedgerStore((s) => s.currentCompany.slug);
  const me = useMe();
  const [pinNotSet, setPinNotSet] = useState(false);
  const [pin, setPin] = useState<string[]>(EMPTY);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [lockSeconds, setLockSeconds] = useState(0);
  const inputs = useRef<Array<HTMLInputElement | null>>([]);

  const noPin = pinNotSet || me.data?.signing_pin_set === false;

  useEffect(() => {
    if (!isOpen) return;
    const tick = () => setLockSeconds(Math.max(0, Math.ceil((lockedUntilMs - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && !busy && lockSeconds === 0 && !noPin) setTimeout(() => inputs.current[0]?.focus(), 50);
  }, [isOpen, busy, lockSeconds, noPin]);

  const clear = () => setPin(EMPTY);

  const change = (index: number, val: string) => {
    if (val.length > 1) {
      const digits = val.replace(/\D/g, '').slice(0, 6).split('');
      const next = [...pin];
      digits.forEach((d, i) => (next[i] = d));
      setPin(next);
      inputs.current[Math.min(digits.length, 5)]?.focus();
      return;
    }
    const next = [...pin];
    next[index] = val.replace(/\D/g, '').slice(-1);
    setPin(next);
    setError(null);
    if (next[index] && index < 5) inputs.current[index + 1]?.focus();
  };

  const submit = async () => {
    if (busy || lockSeconds > 0 || noPin) return;
    if (requireReason && !reason.trim()) {
      setError('Please write a short reason before continuing.');
      return;
    }
    const full = pin.join('');
    if (full.length < 6) {
      setError('Enter all 6 digits of your PIN.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifySigningPin(full);
    } catch (e) {
      clear();
      setBusy(false);
      if (e instanceof ApiError && e.code === 'signing_failed') {
        setShake(true);
        setTimeout(() => setShake(false), 500);
        setError('That PIN is not right. Signing pauses for 15 minutes after three wrong PINs in a row.');
        inputs.current[0]?.focus();
      } else if (e instanceof ApiError && e.code === 'signing_locked') {
        lockedUntilMs = Date.now() + (e.retryAfterSeconds ?? SIGNING_LOCK_SECONDS) * 1000;
        setLockSeconds(e.retryAfterSeconds ?? SIGNING_LOCK_SECONDS);
      } else if (e instanceof ApiError && e.code === 'signing_pin_not_set') {
        setPinNotSet(true);
      } else if (e instanceof ApiError && e.isValidation) {
        setError(e.errors?.pin?.[0] ?? describeError(e));
      } else {
        setError(describeError(e));
      }
      return;
    }
    // Accepted: the server now holds a grant for this session. Forget the PIN before anything else happens.
    clear();
    setBusy(false);
    try {
      await onConfirm('', reason);
    } finally {
      onClose();
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="max-w-[760px] overflow-hidden border-border bg-surface-elevated p-0 shadow-popover">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="flex items-center gap-3 text-base font-semibold text-text-primary">Confirm with your PIN</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 divide-border md:grid-cols-[1fr_1.1fr] md:divide-x">
          <div className="flex flex-col justify-between gap-5 bg-surface-neutral/40 p-6">
            <div className="space-y-4">
              <div className="text-[11px] font-semibold tracking-wide text-text-muted">What you are signing</div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <div className="truncate text-[13px] font-medium text-text-primary">{documentTitle}</div>
                {amount !== undefined && (
                  <div className="mt-1 text-[22px] leading-7 font-medium tabular-nums text-text-primary">{formatMoney(amount, currency)}</div>
                )}
                {(periodName || documentNumber) && (
                  <div className="mt-2 flex flex-wrap justify-between gap-x-3 text-xs text-text-muted">
                    {periodName ? <span>Period {periodName}</span> : <span />}
                    {documentNumber && <span>{documentNumber}</span>}
                  </div>
                )}
                {makerName && (
                  <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-xs text-text-muted">
                    <Avatar name={makerName} size="sm" /> Prepared by <span className="font-medium text-text-secondary">{makerName}</span>
                  </div>
                )}
              </div>
              <div className="flex gap-2.5 text-xs leading-relaxed text-text-secondary">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-accent" />
                <p>{consequenceText || 'Posted entries cannot be edited, only reversed.'}</p>
              </div>
            </div>
            <div className="text-xs text-text-muted">
              Signing as <span className="font-medium text-text-secondary">{currentUser.name}</span>
            </div>
          </div>

          <div className="flex flex-col justify-between gap-5 p-6">
            <div className="space-y-4">
              {noPin ? (
                <div className="space-y-3 rounded-lg border border-border bg-surface-neutral p-4" data-testid="signing-pin-not-set">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                    <KeyRound className="size-4 shrink-0 text-accent" />
                    You have not set a signing PIN yet
                  </div>
                  <p className="text-xs leading-relaxed text-text-secondary">
                    Posting and approving need a 6-digit PIN that is separate from your password. Set it in Settings, Security, then come back to this.
                  </p>
                  <Link
                    to={`/${slug}/settings/security`}
                    onClick={onClose}
                    className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover"
                  >
                    Set my signing PIN
                  </Link>
                </div>
              ) : lockSeconds > 0 ? (
                <div className="space-y-2 rounded-lg border border-danger/30 bg-danger-soft p-5 text-center" data-testid="signing-locked">
                  <Lock className="mx-auto size-6 text-danger" />
                  <div className="text-sm font-semibold text-danger">Signing is paused</div>
                  <p className="text-xs text-text-secondary">
                    Three wrong PINs in a row. Try again in <span className="font-semibold tabular-nums text-danger">{formatCountdown(lockSeconds)}</span>.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="text-sm font-semibold text-text-primary">Enter your 6-digit PIN</div>
                    <p className="mt-0.5 text-xs text-text-muted">This is your personal signing PIN, not your login password.</p>
                  </div>
                  <div className={cn('flex items-center gap-2', shake && 'animate-shake')}>
                    {pin.map((digit, idx) => (
                      <input
                        key={idx}
                        ref={(el) => {
                          inputs.current[idx] = el;
                        }}
                        type="password"
                        inputMode="numeric"
                        autoComplete="off"
                        maxLength={6}
                        value={digit}
                        disabled={busy}
                        aria-label={`PIN digit ${idx + 1}`}
                        onChange={(e) => change(idx, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Backspace' && !pin[idx] && idx > 0) inputs.current[idx - 1]?.focus();
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
                    <div role="alert" className="flex items-start gap-1.5 text-xs font-medium text-danger">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}
                </div>
              )}

              {requireReason && (
                <div className="space-y-1.5">
                  <label className="flex items-center justify-between text-xs font-medium text-text-secondary">
                    <span>Reason</span>
                    <span className="text-danger">Required</span>
                  </label>
                  <textarea
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Say why you are doing this. It is saved in the audit trail."
                    className="w-full resize-none rounded-lg border border-border bg-surface p-2.5 text-[13px] text-text-primary outline-none focus:border-accent focus:ring-2 focus:ring-accent/25"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-border pt-4">
              <button
                type="button"
                onClick={onClose}
                disabled={busy}
                className="h-8 rounded-md border border-border px-3 text-[13px] font-medium text-text-secondary transition hover:bg-surface-neutral disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={busy || lockSeconds > 0 || noPin}
                className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
              >
                {busy ? 'Checking...' : actionTitle}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
