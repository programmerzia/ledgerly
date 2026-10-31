import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Panel, Group, Separator, Layout } from 'react-resizable-panels';
import { X, Columns2, PanelRightClose, ExternalLink } from 'lucide-react';

export interface SplitPaneProps {
  storageKey?: string;
  minWidth?: number;
  maxWidth?: number;
  defaultWidth?: number;
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  badge?: React.ReactNode;
  /** Accepted for older callers and not rendered. */
  icon?: React.ReactNode;
  headerActions?: React.ReactNode;
  onOpenFull?: () => void;
  openFullLabel?: string;
  children: React.ReactNode; // Left side / list
  detailContent: React.ReactNode; // Right side / preview
  defaultMode?: 'drawer' | 'split';
}

export const SplitPane: React.FC<SplitPaneProps> = ({
  storageKey = 'ledgerly_split_width',
  isOpen,
  onClose,
  title,
  subtitle,
  badge,
  headerActions,
  onOpenFull,
  openFullLabel = 'Open full',
  children,
  detailContent,
  defaultMode = 'drawer',
}) => {
  // View mode: 'drawer' (slide-over sheet overlay) vs 'split' (docked resizable split)
  const [viewMode, setViewMode] = useState<'drawer' | 'split'>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ledgerly_detail_view_mode');
      if (saved === 'split' || saved === 'drawer') return saved;
    }
    return defaultMode;
  });

  // Mobile / tablet screen detection (< 1024px)
  const [isMobile, setIsMobile] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return window.innerWidth < 1024;
    }
    return false;
  });

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth < 1024);
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Split mode percentage (38% default, sanitized against legacy bug values)
  const [splitSize, setSplitSize] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = parseFloat(saved);
        // Only accept clean percentages (28% to 60%). Old bug values <= 25 were pixels.
        if (!isNaN(parsed) && parsed >= 28 && parsed <= 60) return parsed;
      }
    }
    return 38;
  });

  // Drawer mode pixel width (540px default, resizable between 420px and 850px)
  const [drawerWidth, setDrawerWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ledgerly_drawer_width');
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 400 && parsed <= 900) return parsed;
      }
    }
    return 540;
  });

  const isDraggingDrawer = useRef(false);

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => {
      const next = prev === 'drawer' ? 'split' : 'drawer';
      localStorage.setItem('ledgerly_detail_view_mode', next);
      return next;
    });
  }, []);

  // Global key bindings while drawer is open
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;

      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl?.getAttribute('contenteditable') === 'true';

      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      // Enter to trigger primary open full record action (if not typing in input)
      if (e.key === 'Enter' && !isInput && onOpenFull) {
        e.preventDefault();
        onOpenFull();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, onOpenFull]);

  // Drawer left-edge mouse drag resizer
  const handleMouseDownResize = (e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingDrawer.current = true;
    const startX = e.clientX;
    const startWidth = drawerWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingDrawer.current) return;
      const deltaX = startX - moveEvent.clientX;
      const newWidth = Math.min(Math.max(startWidth + deltaX, 420), 860);
      setDrawerWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (isDraggingDrawer.current) {
        isDraggingDrawer.current = false;
        setDrawerWidth((current) => {
          localStorage.setItem('ledgerly_drawer_width', current.toString());
          return current;
        });
      }
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  // If closed, render children full width
  if (!isOpen) {
    return <div className="flex-1 flex flex-col overflow-y-auto min-w-0 w-full h-full">{children}</div>;
  }

  // Force 'drawer' mode on mobile/tablet screens to prevent table compression
  const effectiveMode = isMobile ? 'drawer' : viewMode;

  // Shared Header Content
  const renderHeader = () => (
    <div className="h-12 px-4 border-b border-border flex items-center justify-between shrink-0 bg-surface-neutral select-none">
      <div className="flex items-center gap-2.5 truncate min-w-0">
        <div className="flex flex-col truncate min-w-0">
          <div className="flex items-center gap-2 truncate">
            <span className="text-sm font-semibold text-text-primary truncate">
              {title || 'Record details'}
            </span>
            {badge}
          </div>
          {subtitle && (
            <span className="text-[10px] text-text-muted truncate font-mono">
              {subtitle}
            </span>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1 shrink-0 ml-2">
        {headerActions}

        {onOpenFull && (
          <button
            type="button"
            onClick={onOpenFull}
            className="flex items-center gap-1 h-7 px-2 rounded-sm text-text-secondary hover:text-text-primary hover:bg-surface-neutral transition text-[11px] font-medium cursor-pointer"
            title={`${openFullLabel} (Enter)`}
          >
            <ExternalLink className="w-3.5 h-3.5 text-text-muted" />
            <span className="hidden sm:inline">{openFullLabel}</span>
          </button>
        )}

        {!isMobile && (
          <button
            type="button"
            onClick={toggleViewMode}
            className="p-1.5 rounded-sm text-text-muted hover:text-text-primary hover:bg-surface-neutral transition cursor-pointer"
            title={effectiveMode === 'drawer' ? 'Dock side by side' : 'Float as drawer'}
          >
            {effectiveMode === 'drawer' ? (
              <Columns2 className="w-4 h-4" />
            ) : (
              <PanelRightClose className="w-4 h-4" />
            )}
          </button>
        )}

        <button
          type="button"
          onClick={onClose}
          className="p-1.5 rounded-sm text-text-muted hover:text-text-primary hover:bg-surface-neutral transition cursor-pointer"
          title="Close (Esc)"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );

  // Shared Footer Content
  const renderFooter = () => (
    <div className="h-8 px-4 border-t border-border bg-surface-neutral/40 flex items-center justify-between shrink-0 text-[10px] text-text-muted font-mono select-none">
      <div className="flex items-center gap-2">
        <span><kbd className="px-1 py-0.5 bg-surface border border-border rounded text-[9px]">J</kbd> / <kbd className="px-1 py-0.5 bg-surface border border-border rounded text-[9px]">K</kbd> Navigate</span>
        <span>•</span>
        {onOpenFull && <span><kbd className="px-1 py-0.5 bg-surface border border-border rounded text-[9px]">Enter</kbd> Open</span>}
      </div>
      <div>
        <span><kbd className="px-1 py-0.5 bg-surface border border-border rounded text-[9px]">Esc</kbd> Close</span>
      </div>
    </div>
  );

  // MODE 1: Slide-Over Drawer (Fixed overlay on right edge)
  if (effectiveMode === 'drawer') {
    return (
      <div className="flex-1 flex flex-col overflow-y-auto min-w-0 w-full h-full relative">
        {/* Master list stays full width */}
        {children}

        {/* Backdrop for focused slide-over */}
        <div
          className="fixed inset-0 z-40 bg-black/30"
          onClick={onClose}
          aria-hidden="true"
        />

        {/* Slide-over Drawer Panel */}
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={title || 'Record details'}
          className="fixed inset-y-0 right-0 z-50 bg-surface border-l border-border shadow-lg flex flex-col outline-none"
          style={{
            width: isMobile ? '100%' : `${drawerWidth}px`,
            maxWidth: '100vw',
          }}
        >
          {/* Left-edge resize drag handle (desktop only) */}
          {!isMobile && (
            <div
              className="absolute left-0 top-0 bottom-0 w-2 -ml-1 cursor-col-resize hover:bg-accent/40 active:bg-accent transition-colors z-20 flex items-center justify-center group select-none"
              title="Drag to resize drawer, double-click to reset"
              onMouseDown={handleMouseDownResize}
              onDoubleClick={() => {
                setDrawerWidth(540);
                localStorage.setItem('ledgerly_drawer_width', '540');
              }}
            >
              <div className="h-8 w-1 bg-text-muted/30 rounded group-hover:bg-accent group-active:bg-accent" />
            </div>
          )}

          {renderHeader()}

          {/* Drawer Body */}
          <div className="flex-1 p-5 overflow-y-auto bg-surface-elevated/40">
            {detailContent}
          </div>

          {renderFooter()}
        </aside>
      </div>
    );
  }

  // MODE 2: Docked Split View (Resizable side-by-side panels)
  return (
    <Group
      orientation="horizontal"
      className="flex-1 w-full h-full overflow-hidden"
      defaultLayout={{ master: 100 - splitSize, detail: splitSize }}
      onLayoutChanged={(layout: Layout) => {
        if (layout && typeof layout.detail === 'number') {
          const pct = Math.round(layout.detail);
          if (pct >= 28 && pct <= 60) {
            setSplitSize(pct);
            localStorage.setItem(storageKey, pct.toString());
          }
        }
      }}
    >
      <Panel id="master" minSize="35%" className="flex flex-col overflow-y-auto min-w-0">
        {children}
      </Panel>

      <Separator
        className="w-2 hover:w-2.5 -ml-1 z-20 cursor-col-resize bg-border hover:bg-accent transition-all shrink-0 select-none flex items-center justify-center group"
        title="Drag to resize, double-click to reset"
        onDoubleClick={() => {
          setSplitSize(38);
          localStorage.setItem(storageKey, '38');
        }}
      >
        <div className="h-8 w-1 bg-text-muted/40 rounded group-hover:bg-accent group-active:bg-accent" />
      </Separator>

      <Panel
        id="detail"
        defaultSize={`${splitSize}%`}
        minSize="360px"
        maxSize="65%"
        className="bg-surface-elevated border-l border-border flex flex-col overflow-y-auto z-10"
      >
        {renderHeader()}

        {/* Detail Body */}
        <div className="flex-1 p-4 sm:p-5 overflow-y-auto">{detailContent}</div>

        {renderFooter()}
      </Panel>
    </Group>
  );
};

