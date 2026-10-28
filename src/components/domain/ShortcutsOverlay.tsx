/**
 * Keyboard Shortcuts Overlay ('?') per 08_Mock_Refactor_Prompt.md Block C.1,
 * rebuilt using Radix Dialog primitive per 09_Mock_Polish_Prompt.md Block 1.
 */

import React, { useEffect, useState } from 'react';
import { shortcutRegistry, ShortcutDefinition } from '@/lib/shortcuts';
import { Keyboard } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export const ShortcutsOverlay: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    shortcutRegistry.setOverlayHandler(setIsOpen);
    return () => shortcutRegistry.setOverlayHandler(() => {});
  }, []);

  const groups: Record<string, ShortcutDefinition[]> = {
    'Navigation (Go to)': [
      { id: 'g-d', key: 'g d', description: 'Go to Dashboard', scope: 'global', action: () => {} },
      { id: 'g-i', key: 'g i', description: 'Go to Invoices (Sales)', scope: 'global', action: () => {} },
      { id: 'g-b', key: 'g b', description: 'Go to Bills (Purchases)', scope: 'global', action: () => {} },
      { id: 'g-j', key: 'g j', description: 'Go to Journals', scope: 'global', action: () => {} },
      { id: 'g-r', key: 'g r', description: 'Go to Reports', scope: 'global', action: () => {} },
      { id: 'g-p', key: 'g p', description: 'Go to Periods', scope: 'global', action: () => {} },
      { id: 'g-a', key: 'g a', description: 'Go to Approvals Inbox', scope: 'global', action: () => {} },
    ],
    'Document Actions': [
      { id: 'n', key: 'n', description: 'Create new record in active module', scope: 'page', action: () => {} },
      { id: 'ctrl-s', key: 'ctrl+s', description: 'Save document draft', scope: 'page', action: () => {} },
      { id: 'ctrl-enter', key: 'ctrl+enter', description: 'Submit document for approval', scope: 'page', action: () => {} },
      { id: 'alt-a', key: 'alt+a', description: 'Approve document / item', scope: 'page', action: () => {} },
      { id: 'alt-r', key: 'alt+r', description: 'Return document with note', scope: 'page', action: () => {} },
      { id: 'alt-p', key: 'alt+p', description: 'Post document to ledger', scope: 'page', action: () => {} },
      { id: 'alt-v', key: 'alt+v', description: 'Reverse posted entry', scope: 'page', action: () => {} },
      { id: 'f9', key: 'f9', description: 'Recalculate totals', scope: 'page', action: () => {} },
    ],
    'Lists & Grids': [
      { id: 'j-k', key: 'j / k', description: 'Move selection up / down', scope: 'grid', action: () => {} },
      { id: 'x', key: 'x', description: 'Toggle select row', scope: 'grid', action: () => {} },
      { id: 'enter', key: 'Enter / o', description: 'Open selected document as tab', scope: 'grid', action: () => {} },
      { id: 'slash', key: '/', description: 'Quick search / filter in list', scope: 'grid', action: () => {} },
      { id: 'ctrl-d', key: 'ctrl+d', description: 'Fill down in spreadsheet grid', scope: 'grid', action: () => {} },
      { id: 'f2', key: 'f2', description: 'Edit selected cell', scope: 'grid', action: () => {} },
    ],
    'General & Windows': [
      { id: 'ctrl-k', key: 'ctrl+k', description: 'Open Command Palette', scope: 'global', action: () => {} },
      { id: 'ctrl-w', key: 'ctrl+w', description: 'Close active document tab', scope: 'global', action: () => {} },
      { id: 'ctrl-tab', key: 'ctrl+tab', description: 'Switch to next document tab', scope: 'global', action: () => {} },
      { id: 'ctrl-shift-d', key: 'ctrl+shift+d', description: 'Toggle Dark / Light mode', scope: 'global', action: () => {} },
      { id: 'ctrl-comma', key: 'ctrl+,', description: 'Open Settings', scope: 'global', action: () => {} },
      { id: 'esc', key: 'Esc', description: 'Close modal, drawer, or tab', scope: 'global', action: () => {} },
      { id: 'question', key: '?', description: 'Toggle this keyboard shortcut guide', scope: 'global', action: () => {} },
    ],
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && shortcutRegistry.closeOverlay()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden border-border bg-surface-elevated shadow-lg">
        {/* Header */}
        <DialogHeader className="px-5 py-3 border-b border-border bg-surface-neutral/40">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Keyboard className="w-4 h-4 text-accent" />
            <span>Keyboard Shortcuts</span>
            <span className="text-xs text-text-muted font-normal">(Desktop Convention)</span>
          </DialogTitle>
        </DialogHeader>

        {/* Content */}
        <div className="p-5 max-h-[70vh] overflow-y-auto space-y-5 text-xs">
          {Object.entries(groups).map(([groupTitle, list]) => (
            <div key={groupTitle}>
              <h4 className="text-[11px] font-semibold tracking-wider uppercase text-text-muted mb-2">
                {groupTitle}
              </h4>
              <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                {list.map((item) => (
                  <div key={item.id} className="flex items-center justify-between py-1 border-b border-border/50">
                    <span className="text-text-secondary">{item.description}</span>
                    <div className="flex items-center gap-1">
                      {item.key.split(' ').map((token, idx) => (
                        <kbd
                          key={idx}
                          className="px-1.5 py-0.5 font-mono text-[10px] font-medium bg-surface-neutral text-text-primary border border-border rounded-xs shadow-xs"
                        >
                          {token}
                        </kbd>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
};
