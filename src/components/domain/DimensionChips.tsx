import React, { useState } from 'react';
import { cn } from '@/lib/utils';
import { Dimension } from '@/types';
import { Tag, ChevronDown } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

interface DimensionChipsProps {
  dimensions: Dimension[];
  values: {
    branch?: string;
    cost_centre?: string;
    project?: string;
  };
  onChange: (newValues: { branch?: string; cost_centre?: string; project?: string }) => void;
  disabled?: boolean;
  error?: boolean;
  className?: string;
}

export const DimensionChips: React.FC<DimensionChipsProps> = ({
  dimensions,
  values,
  onChange,
  disabled = false,
  error = false,
  className,
}) => {
  const [open, setOpen] = useState(false);

  const branchDim = dimensions.find((d) => d.code === 'branch');
  const costCentreDim = dimensions.find((d) => d.code === 'cost_centre');
  const projectDim = dimensions.find((d) => d.code === 'project');

  const selectedBranch = branchDim?.values.find((v) => v.code === values.branch);
  const selectedCostCentre = costCentreDim?.values.find((v) => v.code === values.cost_centre);

  const hasMissingRequired = branchDim?.isRequired && !values.branch;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            'flex items-center gap-1.5 h-8 px-2 rounded-sm border text-xs transition-colors bg-surface',
            hasMissingRequired
              ? 'border-danger/70 text-danger bg-danger-soft'
              : error
              ? 'border-danger text-danger'
              : 'border-border hover:border-border-strong text-text-secondary',
            disabled && 'opacity-50 cursor-not-allowed bg-surface-neutral',
            className
          )}
        >
          <Tag className="w-3 h-3 text-text-muted shrink-0" />

          {values.branch ? (
            <span className="font-medium text-accent bg-accent-soft px-1 py-0.5 rounded-sm">
              {selectedBranch?.name || values.branch}
            </span>
          ) : (
            <span className="text-danger font-medium flex items-center">
              Branch<span className="text-danger ml-0.5">*</span>
            </span>
          )}

          {values.cost_centre && (
            <span className="text-text-muted bg-surface-neutral px-1 py-0.5 rounded-sm">
              {selectedCostCentre?.name || values.cost_centre}
            </span>
          )}

          <ChevronDown className="w-3 h-3 text-text-muted shrink-0 ml-0.5 opacity-60" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        className="w-64 p-3 border-border bg-surface-elevated shadow-md flex flex-col gap-3"
      >
        <div className="flex items-center justify-between pb-1.5 border-b border-border">
          <span className="text-xs font-semibold text-text-primary uppercase tracking-wide">
            Line Dimensions
          </span>
          <span className="text-[10px] text-text-muted">* Required</span>
        </div>

        {/* Branch dimension */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-text-secondary flex items-center">
            Branch <span className="text-danger ml-0.5">*</span>
          </label>
          <select
            value={values.branch || ''}
            onChange={(e) => onChange({ ...values, branch: e.target.value || undefined })}
            className="h-8 px-2 text-xs bg-surface text-text-primary border border-border rounded-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">— Select branch —</option>
            {branchDim?.values.map((v) => (
              <option key={v.id} value={v.code}>
                {v.name} ({v.code})
              </option>
            ))}
          </select>
        </div>

        {/* Cost Centre dimension */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-text-secondary">Cost Centre</label>
          <select
            value={values.cost_centre || ''}
            onChange={(e) =>
              onChange({ ...values, cost_centre: e.target.value || undefined })
            }
            className="h-8 px-2 text-xs bg-surface text-text-primary border border-border rounded-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">— Optional —</option>
            {costCentreDim?.values.map((v) => (
              <option key={v.id} value={v.code}>
                {v.name} ({v.code})
              </option>
            ))}
          </select>
        </div>

        {/* Project dimension */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-text-secondary">Project</label>
          <select
            value={values.project || ''}
            onChange={(e) => onChange({ ...values, project: e.target.value || undefined })}
            className="h-8 px-2 text-xs bg-surface text-text-primary border border-border rounded-sm focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">— Optional —</option>
            {projectDim?.values.map((v) => (
              <option key={v.id} value={v.code}>
                {v.name} ({v.code})
              </option>
            ))}
          </select>
        </div>
      </PopoverContent>
    </Popover>
  );
};
