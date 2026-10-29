/**
 * BottomStatusBar: 24px fixed desktop status bar per 03_UI_Spec §10,
 * 08_Mock_Refactor_Prompt.md Block B.1, and 09_Mock_Polish_Prompt.md Block 2 & 3.
 * Shows invariants check, selection summary, balance difference, and shortcut hints in 12px Inter.
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
  const { activeSignature, isOffline, outbox, isSyncing } = useLedgerStore();
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

  return (
    <footer className="h-6 bg-surface border-t border-border px-2 sm:px-3 flex items-center justify-between text-[11px] sm:text-xs text-text-muted select-none shrink-0 font-sans overflow-hidden">
      {/* Left Region: State + Invariants Check */}
      <div className="flex items-center gap-2 sm:gap-4 truncate min-w-0">
        <span className="flex items-center gap-1 sm:gap-1.5 text-text-secondary shrink-0">
          <span className="w-1.5 h-1.5 rounded-full bg-success inline-block shrink-0" />
          <span className="truncate">Ready<span className="hidden sm:inline"> · Ledger Invariants Verified</span></span>
        </span>

        {isOffline && (
          <span className="flex items-center gap-1 text-warning font-medium bg-warning-soft px-1.5 py-0.5 rounded-xs border border-warning/20 shrink-0">
            <CloudOff className="w-3 h-3 shrink-0" />
            <span className="hidden sm:inline">Offline {outbox.length > 0 && `(${outbox.length} queued)`}</span>
            <span className="sm:hidden font-mono text-[10px]">{outbox.length > 0 ? `${outbox.length}q` : 'Off'}</span>
          </span>
        )}

        {isSyncing && (
          <span className="flex items-center gap-1 text-accent animate-pulse shrink-0">
            <RefreshCw className="w-3 h-3 animate-spin shrink-0" />
            <span className="hidden sm:inline">Syncing outbox ops...</span>
          </span>
        )}

        {activeSignature && signatureTimeRemaining && (
          <span className="flex items-center gap-1 text-accent bg-accent-soft px-1.5 py-0.5 rounded-xs border border-accent/20 shrink-0">
            <ShieldCheck className="w-3 h-3 shrink-0" />
            <span>
              Signed (<span className="font-mono">{signatureTimeRemaining}</span>)
            </span>
          </span>
        )}

        {contextHint && <span className="text-text-muted hidden xl:inline">| {contextHint}</span>}
      </div>

      {/* Center: Selection Summary & Form Balance Difference */}
      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        {selectionCount > 0 ? (
          <span className="text-text-primary font-semibold flex items-center gap-1.5 text-[10px] sm:text-xs">
            <span className="w-1.5 h-1.5 rounded-full bg-accent inline-block shrink-0" />
            <span>
              {selectionCount} sel · <span className="font-mono">{formatMoney(selectionSum, currency)}</span>
            </span>
          </span>
        ) : formBalanceDifference !== undefined ? (
          formBalanceDifference === 0 ? (
            <span className="text-success flex items-center gap-1 font-medium text-[10px] sm:text-xs">
              <CheckCircle2 className="w-3 h-3 shrink-0" />
              <span>Balanced</span>
            </span>
          ) : (
            <span className="text-danger font-semibold flex items-center gap-1 text-[10px] sm:text-xs">
              <AlertTriangle className="w-3 h-3 shrink-0" />
              <span>
                Diff: <span className="font-mono">{formatMoney(Math.abs(formBalanceDifference), currency)}</span>{' '}
                {formBalanceDifference > 0 ? 'Dr' : 'Cr'}
              </span>
            </span>
          )
        ) : null}
      </div>

      {/* Right Region: Shortcut hints and '? Shortcuts' button */}
      <div className="hidden sm:flex items-center gap-3 text-text-muted shrink-0">
        <span className="hidden md:inline">⌘K Search</span>
        <span className="hidden md:inline">·</span>
        <button
          type="button"
          onClick={() => shortcutRegistry.toggleOverlay()}
          className="hover:text-text-primary flex items-center gap-1 transition cursor-pointer"
          title="Press '?' for keyboard shortcuts guide"
        >
          <kbd className="px-1 py-0.2 bg-surface-neutral border border-border rounded-xs text-[10px] text-text-primary font-mono font-bold">
            ?
          </kbd>
          <span>Shortcuts</span>
        </button>
      </div>
    </footer>
  );
};
