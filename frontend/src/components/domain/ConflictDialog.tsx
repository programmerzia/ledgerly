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

/**
 * Live mode (13 §11): a 409 `version_conflict` carries only the server's version number. The page that caught it passes
 * `conflict`; each button is a real action it offers (reload, resend on top of the server's version, save as a copy).
 */
export interface VersionConflict {
  /** What the user was editing, e.g. "journal". */
  noun: string;
  serverVersion: unknown;
  localVersion?: number;
  onReload: () => void;
  onOverwrite?: () => void;
  onKeepBoth?: () => void;
  onClose: () => void;
  busy?: boolean;
}

const VersionConflictDialog: React.FC<{ conflict: VersionConflict }> = ({ conflict: c }) => (
  <Dialog open onOpenChange={(open) => !open && !c.busy && c.onClose()}>
    <DialogContent className="max-w-xl p-0 overflow-hidden border-border bg-surface-elevated shadow-lg">
      <DialogHeader className="px-5 py-3 border-b border-border bg-warning-soft flex flex-row items-center gap-2.5">
        <AlertCircle className="w-5 h-5 text-warning shrink-0" />
        <DialogTitle className="text-sm font-semibold text-text-primary">Someone else changed this {c.noun}</DialogTitle>
      </DialogHeader>
      <div className="p-5 space-y-4 text-xs text-text-secondary" data-testid="version-conflict">
        <p className="leading-relaxed">
          This {c.noun} was saved by another person or in another tab after you opened it, so your changes were not applied.
        </p>
        <div className="grid grid-cols-2 gap-3 text-[11px]">
          <div className="bg-surface-neutral p-3 rounded-md border border-border space-y-1">
            <div className="font-semibold text-text-primary">Saved version</div>
            <p className="text-text-muted tabular-nums">Version {String(c.serverVersion)}</p>
          </div>
          <div className="bg-surface-neutral p-3 rounded-md border border-border space-y-1">
            <div className="font-semibold text-accent">Your version</div>
            <p className="text-text-muted tabular-nums">{c.localVersion === undefined ? 'Unsaved changes' : `Based on version ${c.localVersion}`}</p>
          </div>
        </div>
      </div>
      <div className="px-5 py-3 bg-surface-neutral/40 border-t border-border flex flex-wrap items-center justify-end gap-2">
        {c.onKeepBoth && (
          <button type="button" disabled={c.busy} onClick={c.onKeepBoth} className="px-3 py-1.5 text-xs font-medium text-text-secondary hover:text-text-primary hover:bg-surface-neutral rounded-sm border border-border transition flex items-center gap-1.5 disabled:opacity-50">
            <Copy className="w-3.5 h-3.5" />
            <span>Keep both (save mine as a copy)</span>
          </button>
        )}
        {c.onOverwrite && (
          <button type="button" disabled={c.busy} onClick={c.onOverwrite} className="px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning-soft rounded-sm border border-warning/30 transition flex items-center gap-1.5 disabled:opacity-50">
            <Check className="w-3.5 h-3.5" />
            <span>Save mine over theirs</span>
          </button>
        )}
        <button type="button" disabled={c.busy} onClick={c.onReload} className="px-3 py-1.5 text-[13px] font-medium bg-accent text-white rounded-md hover:bg-accent-hover transition flex items-center gap-1.5 disabled:opacity-50">
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Discard mine and reload</span>
        </button>
      </div>
    </DialogContent>
  </Dialog>
);

export const ConflictDialog: React.FC<{ conflict?: VersionConflict | null }> = ({ conflict }) => {
  const { pendingConflict, setPendingConflict } = useLedgerStore();

  if (conflict) return <VersionConflictDialog conflict={conflict} />;
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
            Edit conflict (HTTP 409)
          </DialogTitle>
        </DialogHeader>

        {/* Content */}
        <div className="p-5 space-y-4 text-xs text-text-secondary">
          <p className="leading-relaxed">
            This record was modified on another device or by another user (<strong>Fatima Hassan</strong>) while your offline outbox was queued.
          </p>

          <div className="grid grid-cols-2 gap-3 text-[11px]">
            <div className="bg-surface-neutral p-3 rounded-md border border-border space-y-1">
              <div className="font-semibold text-text-primary">Server version</div>
              <p className="text-text-muted">
                {pendingConflict.serverVersion?.memo || 'Modified remotely by finance manager.'}
              </p>
            </div>
            <div className="bg-surface-neutral p-3 rounded-md border border-border space-y-1">
              <div className="font-semibold text-accent">Your queued version</div>
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
            <span>Keep both (save a copy)</span>
          </button>
          <button
            type="button"
            onClick={handleOverwrite}
            className="px-3 py-1.5 text-xs font-medium text-warning hover:bg-warning-soft rounded-sm border border-warning/30 transition flex items-center gap-1.5"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Overwrite server version</span>
          </button>
          <button
            type="button"
            onClick={handleReload}
            className="px-3 py-1.5 text-[13px] font-medium bg-accent text-white rounded-md hover:bg-accent-hover transition flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Discard & Reload Server</span>
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
