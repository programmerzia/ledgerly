/**
 * BottomStatusBar: 24px fixed desktop status bar per 03_UI_Spec §10,
 * 08_Mock_Refactor_Prompt.md Block B.1, and 09_Mock_Polish_Prompt.md Block 2 & 3.
 * Shows save state, selection summary, balance difference, and shortcut hints in 12px Inter.
 */

import React, { useEffect, useState } from 'react';
import { useLedgerStore } from '@/mock/store';
import { shortcutRegistry } from '@/lib/shortcuts';
import { ShieldCheck, CloudOff, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { formatMoney } from '@/lib/format';

export interface StatusBarProps {
  selectionCount?: number;
  selectionSum?: number;
  currency?: string;
  formBalanceDifference?: number;
  contextHint?: string;
}

export const BottomStatusBar: React.FC<StatusBarProps> = ({
  selectionCount = 0,
  selectionSum = 0,
  currency = 'USD',
  formBalanceDifference,
  contextHint,
}) => {
  const {
    activeSignature,
    isOffline,
    outbox,
    isSyncing,
    clearSignature,
    tableSelection,
    focusedElementShortcuts,
  } = useLedgerStore();
  const effectiveCount = selectionCount || tableSelection?.count || 0;
  const effectiveSum = selectionSum || tableSelection?.sum || 0;
  const effectiveCurrency = currency || tableSelection?.currency || 'USD';
  const [signatureTimeRemaining, setSignatureTimeRemaining] = useState<string | null>(null);

  useEffect(() => {
    if (!activeSignature) {
      setSignatureTimeRemaining(null);
      return;
    }

    const updateTimer = () => {
      const remainingMs = activeSignature.expiresAt - Date.now();
      if (remainingMs <= 0) {
        setSignatureTimeRemaining(null);
        clearSignature();
      } else {
        const mins = Math.floor(remainingMs / 60000);
        const secs = Math.floor((remainingMs % 60000) / 1000);
        setSignatureTimeRemaining(`${mins}:${String(secs).padStart(2, '0')}`);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [activeSignature]);

  const kbd = 'font-sans text-[10px] leading-none text-text-muted bg-surface-neutral border border-border px-1 h-4 min-w-4 inline-flex items-center justify-center rounded';
  return (
    <footer className="h-7 bg-surface border-t border-border px-3 sm:px-4 flex items-center justify-between gap-3 text-[11px] text-text-muted select-none shrink-0 font-sans overflow-hidden">
      {/* Left: sync state */}
      <div className="flex items-center gap-3 truncate min-w-0">
        {isOffline ? (
          <span className="flex items-center gap-1.5 text-warning font-medium shrink-0">
            <CloudOff className="size-3 shrink-0" />
            <span>{outbox.length > 0 ? `Offline · ${outbox.length} ${outbox.length === 1 ? 'change' : 'changes'} will sync` : 'Offline'}</span>
          </span>
        ) : isSyncing ? (
          <span className="flex items-center gap-1.5 text-accent shrink-0">
            <RefreshCw className="size-3 animate-spin shrink-0" />
            <span>Syncing your changes…</span>
          </span>
        ) : (
          <span className="flex items-center gap-1.5 shrink-0">
            <span className="size-1.5 rounded-full bg-success shrink-0" />
            <span>All changes saved</span>
          </span>
        )}

        {activeSignature && signatureTimeRemaining && (
          <span className="flex items-center gap-1 text-accent bg-accent-soft px-1.5 h-5 rounded-full shrink-0">
            <ShieldCheck className="size-3 shrink-0" />
            <span>Signed <span className="tabular-nums">{signatureTimeRemaining}</span></span>
          </span>
        )}

        {contextHint && <span className="hidden xl:inline truncate">{contextHint}</span>}
      </div>

      {/* Center: selection / balance */}
      <div className="flex items-center gap-4 shrink-0">
        {effectiveCount > 0 ? (
          <span className="text-text-primary font-medium flex items-center gap-1.5">
            <span className="size-1.5 rounded-full bg-accent shrink-0" />
            {effectiveCount} selected · <span className="tabular-nums">{formatMoney(effectiveSum, effectiveCurrency)}</span>
          </span>
        ) : formBalanceDifference !== undefined ? (
          formBalanceDifference === 0 ? (
            <span className="text-success flex items-center gap-1 font-medium"><CheckCircle2 className="size-3 shrink-0" />Balanced</span>
          ) : (
            <span className="text-danger font-medium flex items-center gap-1">
              <AlertTriangle className="size-3 shrink-0" />
              Diff: <span className="tabular-nums">{formatMoney(Math.abs(formBalanceDifference), currency)}</span> {formBalanceDifference > 0 ? 'Dr' : 'Cr'}
            </span>
          )
        ) : null}
      </div>

      {/* Right: shortcut hints */}
      <div className="hidden sm:flex items-center gap-3 shrink-0">
        {focusedElementShortcuts && focusedElementShortcuts.length > 0 ? (
          focusedElementShortcuts.map((hint, idx) => (
            <span key={idx} className="flex items-center gap-1">
              <kbd className={kbd}>{hint.split(' ')[0]}</kbd>
              <span>{hint.split(' ').slice(1).join(' ')}</span>
            </span>
          ))
        ) : (
          <>
            <span className="hidden md:flex items-center gap-1"><kbd className={kbd}>⌘K</kbd>Search</span>
            <span className="hidden md:flex items-center gap-1"><kbd className={kbd}>G</kbd><kbd className={kbd}>D</kbd>Go to</span>
          </>
        )}
        <button
          type="button"
          onClick={() => shortcutRegistry.toggleOverlay()}
          className="hover:text-text-primary flex items-center gap-1 transition cursor-pointer"
          title="Press '?' for keyboard shortcuts guide"
        >
          <kbd className={kbd}>?</kbd>
          <span>Shortcuts</span>
        </button>
      </div>
    </footer>
  );
};
