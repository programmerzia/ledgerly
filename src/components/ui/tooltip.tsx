import * as React from 'react';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

const TooltipProvider = TooltipPrimitive.Provider;
const Tooltip = TooltipPrimitive.Root;
const TooltipTrigger = TooltipPrimitive.Trigger;

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content> & {
    shortcut?: string;
  }
>(({ className, sideOffset = 6, shortcut, children, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'ui-pop z-[60] flex items-center gap-1.5 rounded-md bg-[var(--tooltip-bg)] px-2 py-1 text-xs font-medium text-[var(--tooltip-fg)] shadow-md',
        className
      )}
      {...props}
    >
      <span>{children}</span>
      {shortcut && (
        <kbd className="rounded border border-white/20 bg-white/10 px-1 text-[10px] font-medium text-[var(--tooltip-fg)] opacity-80 font-sans">
          {shortcut}
        </kbd>
      )}
      <TooltipPrimitive.Arrow width={10} height={5} className="fill-[var(--tooltip-bg)]" />
    </TooltipPrimitive.Content>
  </TooltipPrimitive.Portal>
));
TooltipContent.displayName = TooltipPrimitive.Content.displayName;

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider };
