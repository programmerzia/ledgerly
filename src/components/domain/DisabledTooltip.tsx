import React from 'react';
import { useLedgerStore } from '@/mock/store';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { AlertCircle } from 'lucide-react';

interface DisabledTooltipProps {
  reason?: string;
  disabled?: boolean;
  children: React.ReactElement<{ className?: string; disabled?: boolean }>;
}

export const DisabledTooltip: React.FC<DisabledTooltipProps> = ({
  reason = 'Action is currently unavailable',
  disabled = true,
  children,
}) => {
  const setFocusedElementShortcuts = useLedgerStore((s) => s.setFocusedElementShortcuts);

  if (!disabled) {
    return children;
  }

  const handleMouseEnter = () => {
    setFocusedElementShortcuts([`Disabled: ${reason}`]);
  };

  const handleMouseLeave = () => {
    setFocusedElementShortcuts(null);
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          className="inline-block cursor-not-allowed"
        >
          {React.cloneElement(children, {
            disabled: true,
            className: `${children.props.className || ''} opacity-50 cursor-not-allowed pointer-events-none`,
          })}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs p-2 bg-surface border border-danger/30 text-danger shadow-md flex items-center gap-1.5">
        <AlertCircle className="w-3.5 h-3.5 shrink-0" />
        <span>{reason}</span>
      </TooltipContent>
    </Tooltip>
  );
};
