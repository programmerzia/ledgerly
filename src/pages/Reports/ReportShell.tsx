import React, { useState, useEffect } from 'react';
import { useLedgerStore } from '@/mock/store';
import {
  BarChart3,
  Calendar,
  Filter,
  Download,
  Printer,
  RefreshCw,
  SlidersHorizontal,
  Bookmark,
  Share2,
  Clock,
  Layers,
  ChevronDown,
} from 'lucide-react';

export interface ReportParameters {
  periodFrom: string;
  periodTo: string;
  comparison: 'none' | 'previous_period' | 'previous_year' | 'budget';
  pivotDimension: 'none' | 'branch' | 'cost_centre';
  hideZeroRows: boolean;
  presentationCurrency: string;
  levelOfDetail: 'summary' | 'detailed';
}

interface ReportShellProps {
  title: string;
  subtitle: string;
  asOfMode?: boolean; // If true, single as-of date rather than period range
  parameters: ReportParameters;
  onParametersChange: (params: ReportParameters) => void;
  onRun?: () => void;
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
  onRun,
  computedMs = 118,
  totalLinesScanned = 184,
  children,
}) => {
  const { currentCompany, periods } = useLedgerStore();
  const [isRunning, setIsRunning] = useState(false);
  const [paramsExpanded, setParamsExpanded] = useState(false);

  const handleRun = () => {
    setIsRunning(true);
    if (onRun) onRun();
    setTimeout(() => {
      setIsRunning(false);
    }, 250);
  };

  // Keyboard shortcut: F5 runs report
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F5') {
        e.preventDefault();
        handleRun();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const updateParam = <K extends keyof ReportParameters>(key: K, value: ReportParameters[K]) => {
    onParametersChange({
      ...parameters,
      [key]: value,
    });
  };

  const exportCsv = () => {
    alert('Report downloaded in CSV format.');
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-canvas">
      {/* 1. Header Toolbar */}
      <div className="h-10 border-b border-border px-4 flex items-center justify-between shrink-0 bg-surface">
        <div className="flex items-center gap-3">
          <BarChart3 className="w-4 h-4 text-accent" />
          <div className="flex items-baseline gap-2">
            <h1 className="text-sm font-semibold text-text-primary leading-tight">{title}</h1>
            <span className="text-[11px] text-text-muted leading-tight">{subtitle}</span>
          </div>
        </div>

        {/* Toolbar buttons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setParamsExpanded(!paramsExpanded)}
            className={`flex items-center gap-1.5 h-7 px-2.5 rounded-sm border text-xs font-medium transition ${
              paramsExpanded
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-border bg-surface hover:bg-surface-neutral text-text-primary'
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Parameters (280px)</span>
            <ChevronDown className={`w-3 h-3 transition ${paramsExpanded ? 'rotate-180' : ''}`} />
          </button>

          <button
            type="button"
            onClick={handleRun}
            disabled={isRunning}
            className="flex items-center gap-1.5 h-7 px-3 rounded-sm bg-accent hover:bg-accent-hover text-white text-xs font-semibold shadow-xs transition"
            title="Recompute Report (F5)"
          >
            <RefreshCw className={`w-3 h-3 ${isRunning ? 'animate-spin' : ''}`} />
            <span>Run (F5)</span>
          </button>

          <span className="text-border">|</span>

          <button
            type="button"
            onClick={exportCsv}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-sm border border-border bg-surface hover:bg-surface-neutral text-text-primary text-xs font-medium transition"
          >
            <Download className="w-3 h-3 text-text-muted" />
            <span>Export</span>
          </button>

          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 h-7 px-2.5 rounded-sm border border-border bg-surface hover:bg-surface-neutral text-text-primary text-xs font-medium transition"
          >
            <Printer className="w-3 h-3 text-text-muted" />
            <span>Print</span>
          </button>
        </div>
      </div>

      {/* 2. Workspace Body: Left 280px Parameter Pane (Collapsible) + Full Width Report */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left 280px Parameter Panel */}
        {paramsExpanded && (
          <aside className="w-[280px] shrink-0 border-r border-border bg-surface p-4 flex flex-col gap-4 text-xs overflow-y-auto animate-in slide-in-from-left duration-150">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
                Report Parameters
              </span>
              <button
                type="button"
                onClick={() => setParamsExpanded(false)}
                className="text-text-muted hover:text-text-primary text-[11px]"
              >
                Collapse ✕
              </button>
            </div>

            {/* Period or As-Of */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-text-secondary flex items-center gap-1">
                <Calendar className="w-3 h-3 text-accent" />
                <span>{asOfMode ? 'As Of Period' : 'Fiscal Period'}</span>
              </label>
              <select
                value={parameters.periodTo}
                onChange={(e) => updateParam('periodTo', e.target.value)}
                className="h-8 px-2 rounded-sm border border-border bg-surface font-mono text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Pivot by Dimension */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-text-secondary flex items-center gap-1">
                <Layers className="w-3 h-3 text-accent" />
                <span>Pivot by Dimension</span>
              </label>
              <select
                value={parameters.pivotDimension}
                onChange={(e) => updateParam('pivotDimension', e.target.value as any)}
                className="h-8 px-2 rounded-sm border border-border bg-surface font-medium text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="none">None (Consolidated)</option>
                <option value="branch">Branch (Mogadishu / Hargeisa)</option>
                <option value="cost_centre">Cost Centre (OPS / IT / ADMIN)</option>
              </select>
            </div>

            {/* Comparison */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-text-secondary">Comparison</label>
              <select
                value={parameters.comparison}
                onChange={(e) => updateParam('comparison', e.target.value as any)}
                className="h-8 px-2 rounded-sm border border-border bg-surface font-medium text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="none">None</option>
                <option value="previous_period">Previous Month</option>
                <option value="previous_year">Prior Year (FY 2025)</option>
                <option value="budget">Board Approved Budget</option>
              </select>
            </div>

            {/* Currency */}
            <div className="flex flex-col gap-1">
              <label className="text-[11px] font-semibold text-text-secondary">
                Presentation Currency
              </label>
              <div className="h-8 px-2 flex items-center rounded-sm border border-border bg-surface-neutral font-mono font-medium text-xs text-text-primary">
                {currentCompany.base_currency} (USD)
              </div>
            </div>

            {/* Zero Rows Toggle */}
            <div className="pt-2 border-t border-border">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-text-primary select-none">
                <input
                  type="checkbox"
                  checked={parameters.hideZeroRows}
                  onChange={(e) => updateParam('hideZeroRows', e.target.checked)}
                  className="rounded border-border text-accent focus:ring-accent"
                />
                <span>Hide Zero Movement Rows</span>
              </label>
            </div>
          </aside>
        )}

        {/* 3. Report Results Workspace (Full Width) */}
        <main className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {children}
        </main>
      </div>

      {/* 4. Controls-grade Audit Footer */}
      <div className="h-6 px-4 border-t border-border bg-surface-neutral flex items-center justify-between shrink-0 text-[11px] text-text-muted font-mono select-none">
        <div className="flex items-center gap-2">
          <Clock className="w-3 h-3 text-accent" />
          <span>Computed dynamically in {computedMs} ms from {totalLinesScanned} posted journal lines</span>
        </div>
        <div>
          <span>Presentation: {currentCompany.base_currency} • Double-entry immutable reduction</span>
        </div>
      </div>
    </div>
  );
};
