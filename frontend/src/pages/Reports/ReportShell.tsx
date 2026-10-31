import React from 'react';
import { BarChart3, Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { useLedgerStore } from '@/mock/store';
import { BUSINESS_TODAY } from '@/lib/docStatus';
import { PageHeader } from '@/components/domain/PageHeader';
import { CheckToggle, SelectBox, longDate } from './ReportParts';

export interface ReportParameters {
  periodFrom: string;
  periodTo: string;
  comparison: 'none' | 'previous_period' | 'previous_year' | 'budget';
  pivotDimension: 'none' | 'branch' | 'cost_centre';
  hideZeroRows: boolean;
  presentationCurrency: string;
  levelOfDetail: 'summary' | 'detailed';
}

export const defaultReportParameters = (periodTo = 'per-2026-10', detail: 'summary' | 'detailed' = 'summary'): ReportParameters => ({
  periodFrom: 'per-2026-01',
  periodTo,
  comparison: 'none',
  pivotDimension: 'none',
  hideZeroRows: false,
  presentationCurrency: 'USD',
  levelOfDetail: detail,
});

interface ReportShellProps {
  title: string;
  /** Text after "Company ·". Defaults to the selected period / as-of date. */
  subtitle?: string;
  /** Single as-of date instead of a period. */
  asOfMode?: boolean;
  parameters: ReportParameters;
  onParametersChange: (params: ReportParameters) => void;
  /** Extra controls (toggles, tabs) shown in the parameter bar before Print/Export. */
  toolbar?: React.ReactNode;
  /** Hide the standard period picker (reports with their own range). */
  hidePeriod?: boolean;
  /** Show the "Hide empty rows" toggle. */
  showHideEmpty?: boolean;
  onRun?: () => void;
  /** Kept for API compatibility; no longer shown. */
  computedMs?: number;
  totalLinesScanned?: number;
  children: React.ReactNode;
}

export const ReportShell: React.FC<ReportShellProps> = ({
  title,
  subtitle,
  asOfMode = false,
  parameters,
  onParametersChange,
  toolbar,
  hidePeriod,
  showHideEmpty = true,
  children,
}) => {
  const { currentCompany, periods } = useLedgerStore();
  const selectable = periods.filter((p) => p.kind !== 'adjustment' && p.starts_on <= BUSINESS_TODAY);
  const period = selectable.find((p) => p.id === parameters.periodTo) ?? selectable[selectable.length - 1];
  const descriptor = subtitle ?? (period ? (asOfMode ? `As of ${longDate(period.ends_on)}` : period.name) : '');

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        icon={<BarChart3 />}
        title={title}
        subtitle={descriptor ? `${currentCompany.name} · ${descriptor}` : currentCompany.name}
      />
      <div className="flex flex-wrap items-center gap-3 print:hidden">
        {!hidePeriod && (
          <SelectBox
            aria-label={asOfMode ? 'As of' : 'Period'}
            value={period?.id ?? ''}
            onChange={(e) => onParametersChange({ ...parameters, periodTo: e.target.value })}
          >
            {selectable.map((p) => (
              <option key={p.id} value={p.id}>
                {asOfMode ? `As of ${longDate(p.ends_on)}` : p.name}
              </option>
            ))}
          </SelectBox>
        )}
        {toolbar}
        {showHideEmpty && (
          <CheckToggle
            checked={parameters.hideZeroRows}
            onChange={(v) => onParametersChange({ ...parameters, hideZeroRows: v })}
          >
            Hide empty rows
          </CheckToggle>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border hover:bg-surface-neutral bg-surface text-text-primary text-xs font-medium transition-colors cursor-pointer"
          >
            <Printer className="size-3.5" />
            <span>Print</span>
          </button>
          <button
            type="button"
            onClick={() => toast.success(`${title} exported`)}
            className="flex items-center gap-1.5 h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded-lg text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Download className="size-3.5" />
            <span>Export</span>
          </button>
        </div>
      </div>
      {children}
    </div>
  );
};

/** Resolves the period picked in the parameter bar (falls back to the latest started period). */
export function useSelectedPeriod(periodTo: string) {
  const periods = useLedgerStore((s) => s.periods);
  const selectable = periods.filter((p) => p.kind !== 'adjustment' && p.starts_on <= BUSINESS_TODAY);
  return selectable.find((p) => p.id === periodTo) ?? selectable[selectable.length - 1];
}
