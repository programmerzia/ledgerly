/**
 * SignDialog: 6-digit signing PIN modal per ADR-0004 and 08_Mock_Refactor_Prompt.md Block D,
 * polished for 09_Mock_Polish_Prompt.md Block 1 & 5.
 * Rebuilt using Radix Dialog primitive: consequence panel on the left, PIN boxes on the right,
 * 20px padding, Esc and backdrop close, 3-strike lockout, and signature caching.
 */

import React, { useState, useRef, useEffect } from 'react';
import { useLedgerStore } from '@/mock/store';
import { formatMoney } from '@/lib/format';
import { ShieldCheck, AlertTriangle, Lock, Clock, CheckCircle2 } from 'lucide-react';
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
  actionTitle = 'Approve & Sign',
  consequenceText,
  requireReason = false,
}) => {
  const { currentUser, activeSignature, setActiveSignature, recordFailedPin, resetFailedPin } =
    useLedgerStore();

  const [pin, setPin] = useState(['', '', '', '', '', '']);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

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
  }, [isOpen, currentUser]);

  // Focus first input on open
  useEffect(() => {
    if (isOpen && lockoutSeconds === 0) {
      setTimeout(() => {
        inputRefs.current[0]?.focus();
      }, 50);
    }
  }, [isOpen, lockoutSeconds]);

  // If active signature is valid and non-expired (cached for 2 min)
  const isSignatureCached =
    activeSignature &&
    activeSignature.userId === currentUser.id &&
    activeSignature.expiresAt > Date.now();

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
      setError('Please provide a mandatory reason for this dual-approver action.');
      return;
    }

    // Check if using cached signature
    if (isSignatureCached) {
      onConfirm(activeSignature!.pin, reason);
      onClose();
      return;
    }

    const fullPin = pin.join('');
    if (fullPin.length < 6) {
      setError('Please enter all 6 digits of your signing PIN.');
      return;
    }

    // Check against mock PIN
    if (fullPin !== currentUser.signingPin) {
      recordFailedPin(currentUser.id);
      const updatedUser = useLedgerStore.getState().currentUser;
      if (updatedUser.signingLockoutUntil) {
        setLockoutSeconds(30);
        setError('Incorrect PIN entered 3 times. Account signing locked for 30 seconds.');
      } else {
        const count = updatedUser.failedPinAttempts || 1;
        setError(`Incorrect PIN. Attempt ${count} of 3 before temporary lockout.`);
      }
      setPin(['', '', '', '', '', '']);
      inputRefs.current[0]?.focus();
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

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[780px] p-0 overflow-hidden border-border bg-surface-elevated shadow-lg">
        {/* Header */}
        <DialogHeader className="px-5 py-3 border-b border-border bg-surface-neutral/40">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <ShieldCheck className="w-4 h-4 text-accent" />
            <span>Digital Authorization & Signature</span>
          </DialogTitle>
        </DialogHeader>

        {/* 2-Column Layout: Consequence panel on Left, PIN Entry on Right (Block 5.4) */}
        <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
          {/* Left: Consequence & Document Summary Panel */}
          <div className="p-5 flex flex-col justify-between space-y-4 bg-canvas/40">
            <div className="space-y-3">
              <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                Document Consequence
              </div>

              {/* Summary Box */}
              <div className="bg-surface p-3 rounded-md border border-border space-y-1.5 shadow-xs">
                <div className="flex justify-between items-center text-text-primary font-medium text-xs">
                  <span className="truncate">{documentTitle}</span>
                  {amount !== undefined && (
                    <span className="font-mono text-xs font-semibold text-accent">
                      {formatMoney(amount, currency)}
                    </span>
                  )}
                </div>
                <div className="flex justify-between text-text-muted text-[11px]">
                  <span>Period: {periodName || 'Oct 2026'}</span>
                  {makerName && <span>Prepared by: {makerName}</span>}
                </div>
                {documentNumber && (
                  <div className="text-[10px] font-mono text-text-muted">Ref: {documentNumber}</div>
                )}
              </div>

              {/* Consequence Preview */}
              <div className="p-3 bg-accent-soft/60 border border-accent/20 rounded-md text-text-secondary space-y-1 text-xs">
                <div className="font-semibold text-text-primary text-[11px] flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-accent" />
                  <span>Ledger Impact</span>
                </div>
                <p className="text-[11px] leading-relaxed">
                  {consequenceText ||
                    `Approving this transaction commits balanced journal lines to period ${
                      periodName || 'Oct 2026'
                    }. This action will be cryptographically chained into the SHA-256 audit ledger.`}
                </p>
              </div>
            </div>

            <div className="text-[11px] text-text-muted border-t border-border/60 pt-2 flex items-center justify-between">
              <span>Signer: <strong>{currentUser.name}</strong></span>
              <span className="font-mono text-[10px] text-accent">PIN: {currentUser.signingPin}</span>
            </div>
          </div>

          {/* Right: PIN Entry & Actions */}
          <div className="p-5 flex flex-col justify-between space-y-4">
            <div className="space-y-3">
              <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                Authorized Checker PIN
              </div>

              {/* Cached Signature Notice */}
              {isSignatureCached ? (
                <div className="p-3 bg-success-soft border border-success/30 rounded-md text-xs space-y-1">
                  <div className="font-semibold text-success flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>Cached Signature Active</span>
                  </div>
                  <p className="text-[11px] text-text-secondary">
                    Your signing session was authenticated less than 2 minutes ago. Click confirm to
                    apply your signature token immediately.
                  </p>
                </div>
              ) : lockoutSeconds > 0 ? (
                <div className="p-4 bg-danger-soft border border-danger/30 rounded-md text-center space-y-2">
                  <Lock className="w-6 h-6 text-danger mx-auto animate-pulse" />
                  <div className="font-semibold text-danger text-xs">Signing Locked Out</div>
                  <p className="text-[11px] text-text-secondary">
                    Too many incorrect PIN attempts. Please wait{' '}
                    <span className="font-mono font-bold text-danger">{lockoutSeconds}s</span> before
                    retrying.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[11px] text-text-secondary">
                    Enter your 6-digit signing PIN to digitally seal and post this transaction:
                  </p>

                  {/* 6 Digit Input Boxes */}
                  <div className="flex items-center justify-between gap-1.5">
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
                        onChange={(e) => handleDigitChange(idx, e.target.value)}
                        onKeyDown={(e) => handleKeyDown(idx, e)}
                        className="w-10 h-10 text-center text-sm font-mono font-bold border border-border bg-surface text-text-primary rounded-sm focus:outline-none focus:ring-1 focus:ring-accent"
                        disabled={lockoutSeconds > 0}
                      />
                    ))}
                  </div>

                  {error && (
                    <div className="text-[11px] text-danger font-medium flex items-center gap-1 mt-1">
                      <AlertTriangle className="w-3 h-3 shrink-0" />
                      <span>{error}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Mandatory Reason Field (if required) */}
              {requireReason && (
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-text-secondary flex items-center justify-between">
                    <span>Justification / Reason</span>
                    <span className="text-danger">* Required</span>
                  </label>
                  <textarea
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Enter audit reason for reopening or override..."
                    className="w-full p-2 text-xs border border-border rounded-sm bg-surface text-text-primary focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  />
                </div>
              )}
            </div>

            {/* Footer Buttons */}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-sm border border-border text-xs text-text-secondary hover:bg-surface-neutral transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={lockoutSeconds > 0}
                className="px-3.5 py-1.5 rounded-sm bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-xs disabled:opacity-50 transition"
              >
                {actionTitle}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
