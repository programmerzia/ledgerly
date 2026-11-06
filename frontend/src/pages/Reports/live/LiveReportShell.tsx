import React, { useRef, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { localDateISO } from '@/api/adapters/onboarding';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import { exportReport, saveFile, type ExportFormat, type ReportName } from '@/api/live/reports';
import type { Comparison, ReportSelection } from '@/api/adapters/report';
import type { PeriodChoice, ReportKind } from '@/api/adapters/reportSelection';
import { PageHeader } from '@/components/domain/PageHeader';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { reportQuery, REPORT_PARAMS, useReportDimensions } from '@/data/reports';
import { useRouteCompany } from '@/data/session';
import { CheckToggle, SelectBox } from '../ReportParts';
import { generatedLabel } from './parts';

const CUSTOM = '__custom';
const dateInput = 'h-8 px-2 rounded-md border border-border bg-surface text-xs text-text-primary hover:border-border-strong focus:outline-none focus:border-accent';

const FORMATS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'csv', label: 'CSV (.csv)' },
  { value: 'pdf', label: 'PDF (.pdf)' },
];

function exportFailure(e: unknown): string {
  if (e instanceof ApiError && e.status === 403) return 'Your role can view reports but not export them.';
  if (e instanceof ApiError && e.requestId && e.status >= 500) console.error('report export failed', e.requestId);
  return describeError(e);
}

export interface LiveReportShellProps {
  title: string;
  /** The API's report name, which is also what an export asks for. */
  report: ReportName;
  kind: ReportKind;
  selection: ReportSelection;
  onChange: (next: ReportSelection) => void;
  periods: PeriodChoice[];
  /** Text after the company name. */
  descriptor?: string;
  generatedAt?: string | null;
  /** Extra controls placed before the export buttons (account or contact pickers, side switches). */
  toolbar?: React.ReactNode;
  /** The export is impossible until something is chosen (a contact for a statement, an account for the ledger). */
  exportDisabled?: boolean;
  children: React.ReactNode;
}

export const LiveReportShell: React.FC<LiveReportShellProps> = ({
  title, report, kind, selection, onChange, periods, descriptor, generatedAt, toolbar, exportDisabled, children,
}) => {
  const company = useRouteCompany();
  const dims = useReportDimensions();
  const params = REPORT_PARAMS[report];
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const abort = useRef<AbortController | null>(null);
  const when = selection.when;
  const ordered = [...periods].filter((p) => p.kind !== 'adjustment').sort((a, b) => b.starts_on.localeCompare(a.starts_on));
  const today = localDateISO();

  const pickWhen = (value: string) => {
    if (value !== CUSTOM) {
      onChange({ ...selection, when: { kind: 'period', periodId: value } });
      return;
    }
    const p = when.kind === 'period' ? periods.find((x) => x.id === when.periodId) : undefined;
    onChange({
      ...selection,
      when: kind === 'asof' ? { kind: 'asof', date: p?.ends_on ?? today } : { kind: 'range', from: p?.starts_on ?? '', to: p?.ends_on ?? today },
    });
  };

  const runExport = async (format: ExportFormat) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(format);
    try {
      const file = await exportReport(company.id, report, format, reportQuery(report, selection), {
        signal: ctl.signal,
        onQueued: () => toast.message('This export is large, so it is being prepared. It will download when ready.'),
      });
      saveFile(file);
      toast.success(`Saved ${file.filename}`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) toast.error(exportFailure(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title={title}
        subtitle={[company.name, descriptor, generatedLabel(generatedAt ?? null)].filter(Boolean).join(' · ')}
      />
      <div className="flex flex-wrap items-center gap-3 print:hidden" data-testid="report-params">
        <SelectBox aria-label={kind === 'asof' ? 'As of' : 'Period'} value={when.kind === 'period' ? when.periodId : CUSTOM} onChange={(e) => pickWhen(e.target.value)}>
          <option value={CUSTOM}>{kind === 'asof' ? 'Specific date' : 'Date range'}</option>
          {ordered.map((p) => (
            <option key={p.id} value={p.id}>{kind === 'asof' ? `End of ${p.name}` : p.name}</option>
          ))}
        </SelectBox>
        {when.kind === 'asof' && (
          <input type="date" aria-label="As of date" value={when.date} onChange={(e) => e.target.value && onChange({ ...selection, when: { kind: 'asof', date: e.target.value } })} className={dateInput} />
        )}
        {when.kind === 'range' && (
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <input type="date" aria-label="From" value={when.from} max={when.to} onChange={(e) => onChange({ ...selection, when: { kind: 'range', from: e.target.value, to: when.to } })} className={dateInput} />
            to
            <input type="date" aria-label="To" value={when.to} min={when.from} onChange={(e) => e.target.value && onChange({ ...selection, when: { kind: 'range', from: when.from, to: e.target.value } })} className={dateInput} />
          </span>
        )}
        {when.kind === 'period' && params.basis && (
          <SelectBox aria-label="Range within the year" value={selection.basis} onChange={(e) => onChange({ ...selection, basis: e.target.value as ReportSelection['basis'] })}>
            <option value="month">This period only</option>
            <option value="ytd">Year to date</option>
          </SelectBox>
        )}
        {params.comparison && (
          <SelectBox aria-label="Compare with" disabled={Boolean(selection.breakdown)} title={selection.breakdown ? 'A breakdown by dimension cannot be compared with another period.' : undefined} value={selection.comparison} onChange={(e) => onChange({ ...selection, comparison: e.target.value as Comparison })}>
            <option value="none">No comparison</option>
            <option value="previous_period">Previous period</option>
            <option value="previous_year">Same time last year</option>
          </SelectBox>
        )}
        {params.dims &&
          dims.map((d) => (
            <SelectBox
              key={d.id}
              aria-label={d.name}
              value={selection.dims[d.id] ?? ''}
              onChange={(e) => {
                const next = { ...selection.dims };
                if (e.target.value) next[d.id] = e.target.value;
                else delete next[d.id];
                onChange({ ...selection, dims: next });
              }}
            >
              <option value="">{d.name}: all</option>
              {d.values.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </SelectBox>
          ))}
        {params.breakdown && dims.length > 0 && selection.view !== 'movement' && (
          <SelectBox
            aria-label="Break down by"
            value={selection.breakdown ?? ''}
            onChange={(e) => onChange({ ...selection, breakdown: e.target.value || undefined, comparison: e.target.value ? 'none' : selection.comparison })}
          >
            <option value="">No breakdown</option>
            {dims.map((d) => (
              <option key={d.id} value={d.id}>By {d.name}</option>
            ))}
          </SelectBox>
        )}
        {toolbar}
        {params.hideZero && (
          <CheckToggle checked={selection.hideZero} onChange={(v) => onChange({ ...selection, hideZero: v })}>
            Hide empty rows
          </CheckToggle>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => window.print()}
            className="flex items-center gap-1.5 h-8 px-3 rounded-md border border-border hover:bg-surface-neutral bg-surface text-text-primary text-[13px] font-medium transition-colors cursor-pointer"
          >
            <Printer className="size-3.5" />
            <span>Print</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={busy !== null || exportDisabled}
                className="flex items-center gap-1.5 h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded-md text-[13px] font-medium transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
              >
                <Download className="size-3.5" />
                <span>{busy ? 'Preparing…' : 'Export'}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44 rounded-lg p-1">
              {FORMATS.map((f) => (
                <DropdownMenuItem key={f.value} onSelect={() => void runExport(f.value)}>
                  {f.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {children}
    </div>
  );
};
