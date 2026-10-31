import React from 'react';
import { HelpCircle } from 'lucide-react';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';

interface FieldHelpProps {
  help: string;
  example?: string;
}

export const FieldHelp: React.FC<FieldHelpProps> = ({ help, example }) => {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          className="inline-flex items-center justify-center ml-1 text-text-muted hover:text-accent cursor-help focus:outline-none"
          aria-label="Field documentation"
        >
          <HelpCircle className="w-3.5 h-3.5" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs p-2.5 flex flex-col gap-1 bg-surface-elevated border border-border shadow-md">
        <p className="text-text-primary text-[11px] leading-snug">{help}</p>
        {example && (
          <p className="text-text-muted text-[10px] font-mono mt-0.5">
            e.g. <span className="text-accent">{example}</span>
          </p>
        )}
      </TooltipContent>
    </Tooltip>
  );
};
