/**
 * 409 Conflict Dialog per 02_AppFlow §13 and 08_Mock_Refactor_Prompt.md Block E.3,
 * rebuilt using Radix Dialog primitive per 09_Mock_Polish_Prompt.md Block 1.
 */

import React from 'react';
import { useLedgerStore } from '@/mock/store';
import { AlertCircle, RefreshCw, Copy, Check } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export const ConflictDialog: React.FC = () => {
  const { pendingConflict, setPendingConflict } = useLedgerStore();

  if (!pendingConflict) return null;

  const handleReload = () => {
    // Drop local version and reload server version
    setPendingConflict(null);
  };

  const handleOverwrite = () => {
    // Keep local version and force write
    setPendingConflict(null);
  };

  const handleKeepBoth = () => {
    // Clone local as copy and reload server
    setPendingConflict(null);
  };

  return (
    <Dialog open={!!pendingConflict} onOpenChange={(open) => !open && setPendingConflict(null)}>
      <DialogContent className="max-w-lg p-0 overflow-hidden border-border bg-surface-elevated shadow-lg">
        {/* Header */}
        <DialogHeader className="px-5 py-3 border-b border-border bg-warning-soft flex flex-row items-center gap-2.5">
          <AlertCircle className="w-5 h-5 text-warning shrink-0" />
          <DialogTitle className="text-sm font-semibold text-text-primary">
            Concurrent Edit Conflict (HTTP 409)
          </DialogTitle>
        </DialogHeader>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs text-text-secondary">
          <p className="leading-relaxed">
            This record was modified on another device or by another user (<strong>Fatima Hassan</strong>) while your offline outbox was queued.
          </p>

          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="bg-surface-neutral p-3 rounded-md border border-border space-y-1">
              <div className="font-semibold text-text-primary">Server Version</div>
              <p className="text-text-muted">
                {pendingConflict.serverVersion?.memo || 'Modified remotely by finance manager.'}
              </p>
            </div>
            <div className="bg-accent-soft p-3 rounded-md border border-accent/20 space-y-1">
              <div className="font-semibold text-accent">Your Queued Version</div>
              <p className="text-text-muted">
                {pendingConflict.localVersion?.memo || 'Local offline draft changes.'}
              </p>
            </div>
          </div>

          <p className="text-[11px] text-text-muted italic">
            Choose how you would like Ledgerly to reconcile these changes:
          </p>
        </div>

        {/* Actions */}
        <div className="px-5 py-3 bg-surface-neutral/40 border-t border-border flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleKeepBoth}
            className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-neutral rounded-sm border border-border transition flex items-center gap-1.5"
          >
            <Copy className="w-3.5 h-3.5" />
            <span>Keep Both (Save Copy)</span>
          </button>
          <button
            type="button"
            onClick={handleOverwrite}
            className="px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning-soft rounded-sm border border-warning/30 transition flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Overwrite Server</span>
          </button>
          <button
            type="button"
            onClick={handleReload}
            className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded-sm shadow-xs hover:bg-accent-hover transition flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Discard & Reload Server</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
