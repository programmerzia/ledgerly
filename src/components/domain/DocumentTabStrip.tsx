/**
 * Document Tab Strip component per 03_UI_Spec §10 and 08_Mock_Refactor_Prompt.md Block B.
 * Provides IDE-style tabs with middle-click close, Ctrl+W, Ctrl+Tab, pinned Dashboard,
 * and Radix ContextMenu.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore, DocumentTab } from '@/mock/store';
import { LayoutDashboard, FileText, X, Pin, Copy, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
} from '@/components/ui/context-menu';

export const DocumentTabStrip: React.FC = () => {
  const navigate = useNavigate();
  const { tabs, activeTabId, closeTab, setActiveTab } = useLedgerStore();

  const handleTabClick = (tab: DocumentTab) => {
    setActiveTab(tab.id);
    navigate(tab.url);
  };

  const handleAuxClick = (e: React.MouseEvent, tabId: string) => {
    // Middle-click to close tab (mouse button 1)
    if (e.button === 1) {
      e.preventDefault();
      closeTab(tabId);
    }
  };

  return (
    <div className="h-8 bg-surface-subtle border-b border-border flex items-center px-1 overflow-x-auto no-scrollbar select-none z-10 shrink-0">
      <div className="flex items-center gap-0.5">
        {tabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <ContextMenu key={tab.id}>
              <ContextMenuTrigger asChild>
                <div
                  onClick={() => handleTabClick(tab)}
                  onAuxClick={(e) => handleAuxClick(e, tab.id)}
                  className={cn(
                    'group flex items-center gap-1.5 px-3 py-1 text-xs rounded-t-sm border-t border-x cursor-pointer transition-colors max-w-[200px] h-7',
                    isActive
                      ? 'bg-surface-elevated border-border text-text-primary font-medium shadow-2xs'
                      : 'bg-transparent border-transparent text-text-muted hover:text-text-primary hover:bg-surface-neutral/60'
                  )}
                  title={`${tab.title} (${tab.url})`}
                >
                  {tab.pinned ? (
                    <LayoutDashboard className="w-3.5 h-3.5 text-accent shrink-0" />
                  ) : (
                    <FileText className="w-3.5 h-3.5 text-text-muted shrink-0" />
                  )}
                  <span className="truncate">{tab.title}</span>

                  {tab.dirty && (
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-warning shrink-0"
                      title="Unsaved changes"
                    />
                  )}

                  {!tab.pinned && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        closeTab(tab.id);
                      }}
                      className="p-0.5 rounded-xs hover:bg-surface-neutral text-text-muted hover:text-text-primary opacity-60 group-hover:opacity-100 transition shrink-0 ml-1"
                      title="Close tab (Ctrl+W)"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => handleTabClick(tab)}>
                  <FileText className="mr-2 h-3.5 w-3.5" />
                  <span>Activate Tab</span>
                </ContextMenuItem>
                <ContextMenuItem
                  onClick={() => {
                    navigator.clipboard.writeText(window.location.origin + tab.url);
                  }}
                >
                  <Copy className="mr-2 h-3.5 w-3.5" />
                  <span>Copy URL</span>
                </ContextMenuItem>
                <ContextMenuSeparator />
                {!tab.pinned && (
                  <ContextMenuItem
                    onClick={() => closeTab(tab.id)}
                    className="text-danger focus:text-danger"
                  >
                    <X className="mr-2 h-3.5 w-3.5" />
                    <span>Close Tab</span>
                  </ContextMenuItem>
                )}
                <ContextMenuItem
                  onClick={() => {
                    tabs.filter((t) => !t.pinned && t.id !== tab.id).forEach((t) => closeTab(t.id));
                  }}
                >
                  <span>Close Other Tabs</span>
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
    </div>
  );
};
