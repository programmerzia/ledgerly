import * as React from 'react';
import { cn } from '@/lib/utils';

/** Keyboard-hint chip. Usage: <Kbd>⌘K</Kbd> */
export const Kbd = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <kbd
      ref={ref}
      className={cn(
        'inline-flex h-[18px] min-w-[18px] select-none items-center justify-center rounded border border-border bg-surface-neutral px-1 font-sans text-[11px] font-medium leading-none text-text-muted',
        className
      )}
      {...props}
    />
  )
);
Kbd.displayName = 'Kbd';
