/** Print and Export buttons for the listing reports (3c.20), using the same export route, limits and audit as every report. */
import React, { useRef, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import { exportReport, saveFile, type ExportFormat, type ReportName } from '@/api/live/reports';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useRouteCompany } from '@/data/session';

const FORMATS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'csv', label: 'CSV (.csv)' },
  { value: 'pdf', label: 'PDF (.pdf)' },
];

export const ExportMenu: React.FC<{ report: ReportName; query: Record<string, string>; disabled?: boolean; children?: React.ReactNode }> = ({ report, query, disabled, children }) => {
  const company = useRouteCompany();
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const abort = useRef<AbortController | null>(null);

  const run = async (format: ExportFormat) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(format);
    try {
      const file = await exportReport(company.id, report, format, query, { signal: ctl.signal, onQueued: () => toast.message('This export is large, so it is being prepared. It will download when ready.') });
      saveFile(file);
      toast.success(`Saved ${file.filename}`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) {
        toast.error(e instanceof ApiError && e.status === 403 ? 'Your role can view reports but not export them.' : describeError(e));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="ml-auto flex items-center gap-2 print:hidden">
      {children}
      <button type="button" onClick={() => window.print()} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition-colors hover:bg-surface-neutral">
        <Printer className="size-3.5" />
        <span>Print</span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={busy !== null || disabled} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-default disabled:opacity-60">
            <Download className="size-3.5" />
            <span>{busy ? 'Preparing…' : 'Export'}</span>
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44 rounded-lg p-1">
          {FORMATS.map((f) => (
            <DropdownMenuItem key={f.value} onSelect={() => void run(f.value)}>{f.label}</DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
