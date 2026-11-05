/**
 * Keyboard shortcuts Overlay ('?') per 08_Mock_Refactor_Prompt.md Block C.1,
 * rebuilt using Radix Dialog primitive per 09_Mock_Polish_Prompt.md Block 1.
 */

import React, { useEffect, useState } from 'react';
import { shortcutRegistry, ShortcutDefinition } from '@/lib/shortcuts';
import { Keyboard } from 'lucide-react';
import { IS_LIVE } from '@/api/config';
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

  type OverlayItem = ShortcutDefinition & { mockOnly?: boolean };
  const all: Record<string, OverlayItem[]> = {
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
      { id: 'n', key: 'n', description: IS_LIVE ? 'New invoice, bill, journal, order and so on from its list' : 'Create new record in active module', scope: 'page', action: () => {} },
      { id: 'ctrl-s', key: 'ctrl+s', description: IS_LIVE ? 'Save the draft you are editing' : 'Save document draft', scope: 'page', action: () => {} },
      { id: 'ctrl-enter', key: 'ctrl+enter', description: IS_LIVE ? 'Submit the invoice, bill, order or requisition' : 'Submit document for approval', scope: 'page', action: () => {} },
      { mockOnly: true, id: 'alt-a', key: 'alt+a', description: 'Approve document / item', scope: 'page', action: () => {} },
      { mockOnly: true, id: 'alt-r', key: 'alt+r', description: 'Return document with note', scope: 'page', action: () => {} },
      { mockOnly: true, id: 'alt-p', key: 'alt+p', description: 'Post document to ledger', scope: 'page', action: () => {} },
      { mockOnly: true, id: 'alt-v', key: 'alt+v', description: 'Reverse posted entry', scope: 'page', action: () => {} },
      { mockOnly: true, id: 'f9', key: 'f9', description: 'Recalculate totals', scope: 'page', action: () => {} },
    ],
    'Lists & Grids': [
      { id: 'j-k', key: 'j / k', description: IS_LIVE ? 'Move down / up through the rows' : 'Move selection up / down', scope: 'grid', action: () => {} },
      { id: 'x', key: 'x', description: 'Toggle select row', scope: 'grid', action: () => {} },
      { id: 'enter', key: 'Enter / o', description: IS_LIVE ? 'Open the row you are on' : 'Open selected document as tab', scope: 'grid', action: () => {} },
      { id: 'slash', key: '/', description: IS_LIVE ? 'Go to the search box' : 'Quick search / filter in list', scope: 'grid', action: () => {} },
      { mockOnly: true, id: 'ctrl-d', key: 'ctrl+d', description: 'Fill down in spreadsheet grid', scope: 'grid', action: () => {} },
      { mockOnly: true, id: 'f2', key: 'f2', description: 'Edit selected cell', scope: 'grid', action: () => {} },
    ],
    ...(IS_LIVE
      ? {
          'Bank reconciliation': [
            { id: 'rec-jk', key: 'j / k', description: 'Next / previous statement line', scope: 'page', action: () => {} },
            { id: 'rec-m', key: 'm', description: 'Show the Match tab', scope: 'page', action: () => {} },
            { id: 'rec-c', key: 'c', description: 'Show the Record tab', scope: 'page', action: () => {} },
            { id: 'rec-b', key: 'b', description: 'Show the New bill or New invoice tab', scope: 'page', action: () => {} },
          ] as OverlayItem[],
        }
      : {}),
    'General & Windows': [
      { id: 'ctrl-k', key: 'ctrl+k', description: 'Open command palette', scope: 'global', action: () => {} },
      { mockOnly: true, id: 'ctrl-w', key: 'ctrl+w', description: 'Close active document tab', scope: 'global', action: () => {} },
      { mockOnly: true, id: 'ctrl-tab', key: 'ctrl+tab', description: 'Switch to next document tab', scope: 'global', action: () => {} },
      { id: 'ctrl-shift-d', key: 'ctrl+shift+d', description: 'Toggle dark or light mode', scope: 'global', action: () => {} },
      { id: 'bracket', key: '[', description: 'Toggle navigation sidebar', scope: 'global', action: () => {} },
      { id: 'shift-f', key: 'shift+f', description: 'Toggle full screen', scope: 'global', action: () => {} },
      { id: 'ctrl-comma', key: 'ctrl+,', description: 'Open settings', scope: 'global', action: () => {} },
      { id: 'esc', key: 'Esc', description: IS_LIVE ? 'Close a dialog or drawer, or clear a selection' : 'Close modal, drawer, or tab', scope: 'global', action: () => {} },
      { id: 'question', key: '?', description: 'Toggle this keyboard shortcut guide', scope: 'global', action: () => {} },
    ],
  };

  // Against the API, keys that only the demo screens answer are not listed.
  const groups: Record<string, OverlayItem[]> = Object.fromEntries(
    Object.entries(all).map(([title, list]) => [title, list.filter((i) => !(IS_LIVE && i.mockOnly))] as const).filter(([, list]) => list.length > 0),
  );

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && shortcutRegistry.closeOverlay()}>
      <DialogContent className="max-w-2xl p-0 overflow-hidden border-border bg-surface-elevated shadow-lg">
        {/* Header */}
        <DialogHeader className="px-5 py-3 border-b border-border bg-surface-neutral/40">
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            <Keyboard className="w-4 h-4 text-accent" />
            <span>Keyboard shortcuts</span>
            
          </DialogTitle>
        </DialogHeader>

        {/* Content */}
        <div className="p-5 max-h-[70vh] overflow-y-auto space-y-5 text-xs">
          {Object.entries(groups).map(([groupTitle, list]) => (
            <div key={groupTitle}>
              <h4 className="text-xs font-semibold text-text-muted mb-2">
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
                          className="px-1.5 h-5 min-w-5 inline-flex items-center justify-center font-sans text-[11px] font-medium bg-surface-neutral text-text-primary border border-border rounded-md"
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
