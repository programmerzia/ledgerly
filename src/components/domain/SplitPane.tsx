import React, { useState, useEffect, useRef, useCallback } from 'react';
import { X, ChevronRight } from 'lucide-react';

interface SplitPaneProps {
  storageKey?: string;
  minWidth?: number;
  maxWidth?: number;
  defaultWidth?: number;
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  badge?: React.ReactNode;
  children: React.ReactNode; // Left side / list
  detailContent: React.ReactNode; // Right side / preview
}

export const SplitPane: React.FC<SplitPaneProps> = ({
  storageKey = 'ledgerly_split_width',
  minWidth = 320,
  maxWidth = 640,
  defaultWidth = 420,
  isOpen,
  onClose,
  title,
  badge,
  children,
  detailContent,
}) => {
  const [width, setWidth] = useState<number>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= minWidth && parsed <= maxWidth) {
          return parsed;
        }
      }
    }
    return defaultWidth;
  });

  const isDraggingRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isDraggingRef.current || !containerRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const newWidth = containerRect.right - ev.clientX;
      const clamped = Math.max(minWidth, Math.min(maxWidth, newWidth));
      setWidth(clamped);
      localStorage.setItem(storageKey, clamped.toString());
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [minWidth, maxWidth, storageKey]);

  // Keyboard shortcut: Esc closes detail pane
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  return (
    <div ref={containerRef} className="flex-1 flex overflow-hidden relative w-full h-full">
      {/* Master Content (List) */}
      <div className="flex-1 flex flex-col overflow-y-auto min-w-0">
        {children}
      </div>

      {/* Resizable Detail Pane */}
      {isOpen && (
        <>
          {/* Draggable Divider with double-click collapse */}
          <div
            role="separator"
            aria-orientation="vertical"
            tabIndex={0}
            onMouseDown={handleMouseDown}
            onDoubleClick={onClose}
            className="w-1.5 hover:w-2 -ml-0.5 z-20 cursor-col-resize bg-line-border hover:bg-brand-teal transition-all shrink-0 select-none flex items-center justify-center group"
            title="Drag to resize, double-click or press Esc to close"
          >
            <div className="h-6 w-0.5 bg-ink-muted/40 rounded group-hover:bg-brand-teal" />
          </div>

          {/* Detail Side Panel */}
          <div
            style={{ width: `${width}px` }}
            className="shrink-0 bg-surface-elevated border-l border-line-border flex flex-col overflow-y-auto animate-in slide-in-from-right-4 duration-150 z-10"
          >
            {/* Detail Pane Header */}
            <div className="h-10 px-4 border-b border-line-border flex items-center justify-between shrink-0 bg-surface-subtle">
              <div className="flex items-center gap-2 truncate">
                <span className="text-xs font-semibold text-ink-900 truncate">
                  {title || 'Record Preview'}
                </span>
                {badge}
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1 rounded text-ink-muted hover:text-ink-900 hover:bg-surface-neutral transition"
                title="Close preview (Esc)"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Detail Pane Body */}
            <div className="flex-1 p-4 overflow-y-auto">
              {detailContent}
            </div>
          </div>
        </>
      )}
    </div>
  );
};
