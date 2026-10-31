import * as React from 'react';
import { cn } from '@/lib/utils';

/** One neutral tone for everyone: colour is reserved for meaning (status, money), not decoration. */
const TONE = 'bg-surface-neutral text-text-secondary ring-1 ring-inset ring-border';

export function nameHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h;
}

export function initialsOf(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const SIZES = {
  sm: 'size-6 text-[10px]',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
} as const;

interface AvatarProps extends React.HTMLAttributes<HTMLSpanElement> {
  name: string;
  size?: keyof typeof SIZES;
  /** Square-ish (companies) instead of circle (people). */
  square?: boolean;
}

/** Initials avatar. */
export const Avatar = ({ name, size = 'md', square, className, ...props }: AvatarProps) => (
  <span
    aria-hidden="true"
    title={name}
    className={cn(
      'inline-flex shrink-0 select-none items-center justify-center font-medium',
      square ? 'rounded-md' : 'rounded-full',
      SIZES[size],
      TONE,
      className
    )}
    {...props}
  >
    {initialsOf(name)}
  </span>
);
