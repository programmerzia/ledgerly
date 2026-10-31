import React, { useState } from 'react';
import { ChevronRight, X } from 'lucide-react';

export interface CoachStep {
  title: string;
  desc: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface CoachPanelProps {
  moduleId: string;
  moduleName: string;
  steps: CoachStep[];
}

export const CoachPanel: React.FC<CoachPanelProps> = ({ moduleId, moduleName, steps }) => {
  const storageKey = `ledgerly_coach_${moduleId}`;
  const [isDismissed, setIsDismissed] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem(storageKey) === 'dismissed';
    }
    return false;
  });
  const [expanded, setExpanded] = useState(false);
  const [activeStep, setActiveStep] = useState<number>(0);

  const handleDismiss = () => {
    setIsDismissed(true);
    localStorage.setItem(storageKey, 'dismissed');
  };

  const handleReset = () => {
    setIsDismissed(false);
    localStorage.removeItem(storageKey);
  };

  if (isDismissed) {
    return (
      <button
        type="button"
        onClick={handleReset}
        className="fixed bottom-10 right-6 z-40 flex items-center gap-1.5 h-7 px-2.5 rounded-md bg-surface border border-border hover:border-border-strong text-text-muted hover:text-text-primary text-[11px] font-medium transition-colors cursor-pointer"
        title={`Show the ${moduleName} guide again`}
      >
        <span>{moduleName} guide</span>
      </button>
    );
  }

  return (
    <div className="rounded-md bg-surface border border-border my-1">
      <div className="h-10 px-3 flex items-center gap-2 text-xs">
        <span className="flex-1 min-w-0 truncate text-text-secondary">
          How {moduleName} works, in {steps.length} steps
        </span>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="h-6 px-2 rounded text-[12px] font-medium text-accent hover:underline cursor-pointer shrink-0"
        >
          {expanded ? 'Hide' : 'Show'}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-neutral transition cursor-pointer shrink-0"
          title="Dismiss"
          aria-label="Dismiss guide"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {expanded && (
        <div className="px-3 pb-3 grid grid-cols-1 md:grid-cols-3 gap-3">
          {steps.map((step, idx) => {
            const isActive = activeStep === idx;
            return (
              <div
                key={idx}
                onClick={() => setActiveStep(idx)}
                className={`p-2.5 rounded border text-xs cursor-pointer transition flex flex-col justify-between ${
                  isActive
                    ? 'bg-surface-neutral border-border-strong text-text-primary'
                    : 'bg-surface border-border text-text-secondary hover:border-border-strong'
                }`}
              >
                <div className="flex flex-col gap-1">
                  <span className="text-[11px] font-medium text-text-muted">Step {idx + 1}</span>
                  <div className="font-semibold text-text-primary">{step.title}</div>
                  <p className="text-[11px] text-text-muted leading-relaxed">{step.desc}</p>
                </div>
                {step.onAction && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      step.onAction?.();
                    }}
                    className="mt-2 h-6 px-2 bg-accent hover:bg-accent-hover text-white rounded-md text-[11px] font-medium transition-colors self-start flex items-center gap-1"
                  >
                    <span>{step.actionLabel || 'Open'}</span>
                    <ChevronRight className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
