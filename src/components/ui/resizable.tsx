import * as React from 'react';
import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ResizablePanelGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  direction?: 'horizontal' | 'vertical';
}

export const ResizablePanelGroup: React.FC<ResizablePanelGroupProps> = ({
  direction = 'horizontal',
  className,
  children,
  ...props
}) => {
  return (
    <div
      className={cn(
        'flex h-full w-full',
        direction === 'vertical' ? 'flex-col' : 'flex-row',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export const ResizablePanel: React.FC<React.HTMLAttributes<HTMLDivElement> & { defaultSize?: number }> = ({
  className,
  children,
  ...props
}) => {
  return (
    <div className={cn('flex-1 overflow-auto', className)} {...props}>
      {children}
    </div>
  );
};

export const ResizableHandle: React.FC<React.HTMLAttributes<HTMLDivElement> & { withHandle?: boolean }> = ({
  withHandle = false,
  className,
  ...props
}) => {
  return (
    <div
      className={cn(
        'relative flex w-[1px] items-center justify-center bg-border transition-colors hover:bg-accent cursor-col-resize select-none',
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-xs border border-border bg-surface-elevated shadow-xs">
          <GripVertical className="h-2.5 w-2.5 text-text-muted" />
        </div>
      )}
    </div>
  );
};
