/**
 * SignDialog: 6-digit signing PIN modal per ADR-0004 and 08_Mock_Refactor_Prompt.md Block D,
 * polished for 09_Mock_Polish_Prompt.md Block 1 & 5.
 * Rebuilt using Radix Dialog primitive: consequence panel on the left, PIN boxes on the right,
 * 20px padding, Esc and backdrop close, 3-strike lockout, and signature caching.
 */

import React, { useState, useRef, useEffect } from 'react';
import { useLedgerStore } from '@/mock/store';
import { formatMoney } from '@/lib/format';
import { AlertTriangle, Lock, CheckCircle2 } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface SignDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (pin: string, reason?: string) => void;
  documentTitle: string;
  documentNumber?: string;
  amount?: number;
  currency?: string;
  periodName?: string;
  makerName?: string;
  actionTitle?: string;
  consequenceText?: string;
  requireReason?: boolean;
}

export const SignDialog: React.FC<SignDialogProps> = ({
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
  const {
    currentUser,
    activeSignature,
    setActiveSignature,
    recordFailedPin,
    resetFailedPin,
    appendAuditEvent,
    auditEvents,
  } = useLedgerStore();

  const [pin, setPin] = useState(['', '', '', '', '', '']);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);
  const [isShaking, setIsShaking] = useState(false);
  const [cachedTimeRemaining, setCachedTimeRemaining] = useState<string>('2:00');

  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Check lockout
  useEffect(() => {
    if (!isOpen) return;

    if (currentUser.signingLockoutUntil) {
      const remainingMs = new Date(currentUser.signingLockoutUntil).getTime() - Date.now();
      if (remainingMs > 0) {
        setLockoutSeconds(Math.ceil(remainingMs / 1000));
        const timer = setInterval(() => {
          const rem = new Date(currentUser.signingLockoutUntil!).getTime() - Date.now();
          if (rem <= 0) {
            clearInterval(timer);
            setLockoutSeconds(0);
            resetFailedPin(currentUser.id);
          } else {
            setLockoutSeconds(Math.ceil(rem / 1000));
          }
        }, 1000);
        return () => clearInterval(timer);
      }
    }
  }, [isOpen, currentUser, resetFailedPin]);

  // If active signature is valid and non-expired (cached for 2 min)
  const isSignatureCached =
    Boolean(activeSignature &&
    activeSignature.userId === currentUser.id &&
    activeSignature.expiresAt > Date.now());

  // Cached countdown timer
  useEffect(() => {
    if (!isSignatureCached || !activeSignature) return;

    const updateCachedTime = () => {
      const remainingMs = activeSignature.expiresAt - Date.now();
      if (remainingMs <= 0) {
        setCachedTimeRemaining('0:00');
      } else {
        const mins = Math.floor(remainingMs / 60000);
        const secs = Math.floor((remainingMs % 60000) / 1000);
        setCachedTimeRemaining(`${mins}:${String(secs).padStart(2, '0')}`);
      }
    };

    updateCachedTime();
    const interval = setInterval(updateCachedTime, 1000);
    return () => clearInterval(interval);
  }, [isSignatureCached, activeSignature]);

  // Global key listener for Enter when cached
  useEffect(() => {
    if (!isOpen) return;
    const handleGlobalKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && isSignatureCached && lockoutSeconds === 0) {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener('keydown', handleGlobalKey);
    return () => window.removeEventListener('keydown', handleGlobalKey);
  }, [isOpen, isSignatureCached, lockoutSeconds, activeSignature, reason]);

  // Focus first input on open
  useEffect(() => {
    if (isOpen && lockoutSeconds === 0 && !isSignatureCached) {
      setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 50);
    }
  }, [isOpen, lockoutSeconds, isSignatureCached]);

  const handleDigitChange = (index: number, val: string) => {
    if (val.length > 1) {
      // Handle paste of 6 digits
      const digits = val.replace(/\D/g, '').slice(0, 6).split('');
      const newPin = [...pin];
      digits.forEach((d, i) => {
        newPin[i] = d;
      });
      setPin(newPin);
      const nextIdx = Math.min(digits.length, 5);
      inputRefs.current[nextIdx]?.focus();
      return;
    }

    const digit = val.slice(-1);
    const newPin = [...pin];
    newPin[index] = digit;
    setPin(newPin);
    setError(null);

    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !pin[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSubmit = () => {
    if (lockoutSeconds > 0) return;

    if (requireReason && !reason.trim()) {
      setError('Please write a short reason before continuing.');
      return;
    }

    // Check if using cached signature
    if (isSignatureCached && activeSignature) {
      onConfirm(activeSignature.pin, reason);
      onClose();
      return;
    }

    const fullPin = pin.join('');
    if (fullPin.length < 6) {
      setError('Enter all 6 digits of your PIN.');
      return;
    }

    // Check against mock PIN
    if (fullPin !== currentUser.signingPin) {
      recordFailedPin(currentUser.id);
      const updatedUser = useLedgerStore.getState().currentUser;
      const count = updatedUser.failedPinAttempts || 1;
      const attemptsLeft = Math.max(0, 3 - count);

      setIsShaking(true);
      setTimeout(() => setIsShaking(false), 500);
      setPin(['', '', '', '', '', '']);

      if (attemptsLeft === 0 || updatedUser.signingLockoutUntil) {
        setLockoutSeconds(30);
        // Record audit event per 1.1
        const now = new Date().toISOString();
        const prevHash = auditEvents[0]?.hash || '0000000000000000000000000000000000000000000000000000000000000000';
        appendAuditEvent({
          id: `aud-lockout-${Date.now()}`,
          occurred_at: now,
          actor_id: currentUser.id,
          actor_name: currentUser.name,
          action: 'signing.locked_out',
          subject_type: 'user',
          subject_id: currentUser.id,
          subject_number: currentUser.name,
          detail: `Signing locked for 30 s: 3 consecutive invalid PIN entries by ${currentUser.name}`,
          prev_hash: prevHash,
          hash: `hash-lockout-${Date.now()}`,
        });

        toast.error('Signing locked for 30 s');
        onClose();
      } else {
        setError(`That PIN is not right. ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left before signing is paused for 30 seconds.`);
        inputRefs.current[0]?.focus();
      }
      return;
    }

    // Valid PIN: cache for 2 minutes and proceed
    resetFailedPin(currentUser.id);
    setActiveSignature({
      userId: currentUser.id,
      pin: fullPin,
      signedAt: new Date().toISOString(),
      expiresAt: Date.now() + 2 * 60 * 1000,
    });

    onConfirm(fullPin, reason);
    onClose();
  };

  const attemptsUsed = currentUser.failedPinAttempts || 0;
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[760px] overflow-hidden border-border bg-surface-elevated p-0 shadow-popover">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle className="flex items-center gap-3 text-base font-semibold text-text-primary">
            Confirm with your PIN
          </DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-[1fr_1.1fr] md:divide-x divide-border">
          {/* What you are signing */}
          <div className="flex flex-col justify-between gap-5 bg-surface-neutral/40 p-6">
            <div className="space-y-4">
              <div className="text-[11px] font-semibold tracking-wide text-text-muted">What you are signing</div>
              <div className="rounded-lg border border-border bg-surface p-4">
                <div className="truncate text-[13px] font-medium text-text-primary">{documentTitle}</div>
                {amount !== undefined && (
                  <div className="mt-1 text-[22px] leading-7 font-medium tabular-nums text-text-primary">
                    {formatMoney(amount, currency)}
                  </div>
                )}
                <div className="mt-2 flex flex-wrap justify-between gap-x-3 text-xs text-text-muted">
                  <span>Period {periodName || 'Oct 2026'}</span>
                  {documentNumber && <span>{documentNumber}</span>}
                </div>
                {makerName && (
                  <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 text-xs text-text-muted">
                    <Avatar name={makerName} size="sm" /> Prepared by <span className="font-medium text-text-secondary">{makerName}</span>
                  </div>
                )}
              </div>
              <div className="flex gap-2.5 text-xs leading-relaxed text-text-secondary">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-accent" />
                <p>
                  {consequenceText ||
                    `This will post the document to ${periodName || 'Oct 2026'}. Posted entries cannot be edited, only reversed.`}
                </p>
              </div>
            </div>
            <div className="text-xs text-text-muted">
              Signing as <span className="font-medium text-text-secondary">{currentUser.name}</span> ({currentUser.roleTitle})
            </div>
          </div>

          {/* PIN */}
          <div className="flex flex-col justify-between gap-5 p-6">
            <div className="space-y-4">
              {isSignatureCached ? (
                <div className="space-y-2 rounded-lg border border-border bg-surface-neutral p-4">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-text-primary">
                    <CheckCircle2 className="size-4 shrink-0 text-accent" />
                    You signed a moment ago ({cachedTimeRemaining} left)
                  </div>
                  <p className="text-xs leading-relaxed text-text-secondary">
                    No need to type your PIN again. Press <Kbd>Enter</Kbd> to continue.
                  </p>
                </div>
              ) : lockoutSeconds > 0 ? (
                <div className="space-y-2 rounded-lg border border-danger/30 bg-danger-soft p-5 text-center">
                  <Lock className="mx-auto size-6 text-danger" />
                  <div className="text-sm font-semibold text-danger">Signing is paused</div>
                  <p className="text-xs text-text-secondary">
                    Three wrong PINs in a row. Try again in <span className="font-semibold tabular-nums text-danger">{lockoutSeconds}s</span>.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <div>
                    <div className="text-sm font-semibold text-text-primary">Enter your 6-digit PIN</div>
                    <p className="mt-0.5 text-xs text-text-muted">This is your personal signing PIN, not your login password.</p>
                  </div>
                  <div className={cn('flex items-center gap-2', isShaking && 'animate-shake')}>
                    {pin.map((digit, idx) => (
                      <input
                        key={idx}
                        ref={(el) => {
                          inputRefs.current[idx] = el;
                        }}
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        value={digit}
                        aria-label={`PIN digit ${idx + 1}`}
                        onChange={(e) => handleDigitChange(idx, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(idx, e)}
                        className={cn(
                          'size-11 flex-1 rounded-lg border bg-surface text-center text-lg font-semibold text-text-primary transition outline-none',
                          'focus:border-accent focus:ring-2 focus:ring-accent/25',
                          digit && 'border-border-strong bg-surface-neutral',
                          error ? 'border-danger focus:border-danger focus:ring-danger/25' : !digit && 'border-border'
                        )}
                        disabled={lockoutSeconds > 0}
                      />
                    ))}
                  </div>
                  {error ? (
                    <div className="flex items-start gap-1.5 text-xs font-medium text-danger">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      <span>{error}</span>
                    </div>
                  ) : (
                    attemptsUsed > 0 && (
                      <div className="text-xs text-warning">{3 - attemptsUsed} {3 - attemptsUsed === 1 ? 'try' : 'tries'} left before signing pauses.</div>
                    )
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
                className="h-8 rounded-md border border-border px-3 text-[13px] font-medium text-text-secondary transition hover:bg-surface-neutral"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={lockoutSeconds > 0}
                className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:opacity-50"
              >
                {isSignatureCached ? `Sign as ${currentUser.name.split(' ')[0]}` : actionTitle}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
