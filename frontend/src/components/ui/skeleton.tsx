import * as React from 'react';
import { cn } from '@/lib/utils';

/** Shimmering placeholder block. Size it with className (e.g. "h-4 w-32"). */
export const Skeleton = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div aria-hidden="true" className={cn('ui-skeleton rounded-md', className)} {...props} />
);
