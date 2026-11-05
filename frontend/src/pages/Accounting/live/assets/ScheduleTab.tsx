import React, { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Download } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { useAssetSchedule } from '@/data/fixedAssets';
import { useFiscalYears } from '@/data/fiscal';
import { useActiveCompany } from '@/data/session';
import { eventLabel, scheduleQuery, type ScheduleFigures } from '@/api/adapters/fixedAssets';
import { defaultYear } from '@/api/adapters/fiscal';
import { exportReport, saveFile, type ExportFormat } from '@/api/live/reports';
import { describeError } from '@/api/messages';
import { formatDate, formatMoney } from '@/lib/format';
import { ErrorLine, LoadingLine } from '../parts';
import { Badge, fieldClass, secondaryBtn, todayISO } from './parts';

const FORMATS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'xlsx', label: 'Excel (.xlsx)' },
  { value: 'csv', label: 'CSV (.csv)' },
  { value: 'pdf', label: 'PDF (.pdf)' },
];

const FIGURE_COLUMNS: Array<{ key: string; label: string; get: (f: ScheduleFigures) => number }> = [
  { key: 'c-open', label: 'Cost at start', get: (f) => f.cost.opening },
  { key: 'c-add', label: 'Added', get: (f) => f.cost.additions },
  { key: 'c-ob', label: 'Opening assets', get: (f) => f.cost.opening_assets },
  { key: 'c-disp', label: 'Sold or scrapped', get: (f) => f.cost.disposals },
  { key: 'c-reval', label: 'Revalued', get: (f) => f.cost.revaluation },
  { key: 'c-close', label: 'Cost at end', get: (f) => f.cost.closing },
  { key: 'a-open', label: 'Depreciation at start', get: (f) => f.accumulated.opening },
  { key: 'a-ob', label: 'Opening assets', get: (f) => f.accumulated.opening_assets },
  { key: 'a-charge', label: 'Charged', get: (f) => f.accumulated.charge },
  { key: 'a-imp', label: 'Write-downs', get: (f) => f.accumulated.impairment },
  { key: 'a-disp', label: 'Sold or scrapped', get: (f) => f.accumulated.disposals },
  { key: 'a-reval', label: 'Revalued', get: (f) => f.accumulated.revaluation },
  { key: 'a-close', label: 'Depreciation at end', get: (f) => f.accumulated.closing },
  { key: 'v-open', label: 'Value at start', get: (f) => f.carrying_opening },
  { key: 'v-close', label: 'Value at end', get: (f) => f.carrying_closing },
];

export const ScheduleTab: React.FC = () => {
  const navigate = useNavigate();
  const { company } = useActiveCompany();
  const cur = company.base_currency;
  const years = useFiscalYears();
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const abort = useRef<AbortController | null>(null);

  const fy = defaultYear(years.data);
  const today = todayISO();
  const initial = fy ? { from: fy.starts_on, to: fy.ends_on && fy.ends_on < today ? fy.ends_on : today } : { from: '', to: '' };
  const from = (range ?? initial).from;
  const to = (range ?? initial).to;
  const setFrom = (v: string) => setRange({ from: v, to });
  const setTo = (v: string) => setRange({ from, to: v });

  const periods = useMemo(() => years.data.flatMap((y) => y.periods).filter((p) => p.kind !== 'adjustment').sort((a, b) => b.starts_on.localeCompare(a.starts_on)), [years.data]);
  const ready = Boolean(from && to && from <= to);
  const query = scheduleQuery({ from, to });
  const report = useAssetSchedule(query, ready);
  const r = report.data;

  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const runExport = async (format: ExportFormat) => {
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setBusy(format);
    try {
      const file = await exportReport(company.id, 'asset-schedule', format, query, {
        signal: ctl.signal,
        onQueued: () => toast.message('This export is large, so it is being prepared. It will download when ready.'),
      });
      saveFile(file);
      toast.success(`Saved ${file.filename}`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) toast.error(describeError(e));
    } finally {
      setBusy(null);
    }
  };

  const row = (label: React.ReactNode, f: ScheduleFigures, o: { strong?: boolean; indent?: boolean; lead?: React.ReactNode } = {}) => (
    <>
      <td className={`sticky left-0 bg-surface px-3 py-2 ${o.indent ? 'pl-9' : ''} ${o.strong ? 'font-semibold text-text-primary' : 'text-text-secondary'}`}>{o.lead}{label}</td>
      {FIGURE_COLUMNS.map((c) => <td key={c.key} className={`px-3 py-2 text-right tabular-nums ${o.strong ? 'font-semibold text-text-primary' : ''}`}>{formatMoney(c.get(f), cur)}</td>)}
    </>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-[11px] font-medium text-text-muted">Month
          <select aria-label="Month" value="" onChange={(e) => { const p = periods.find((x) => x.id === e.target.value); if (p) { setRange({ from: p.starts_on, to: p.ends_on }); } }} className={fieldClass}>
            <option value="">Pick a month</option>
            {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-text-muted">From
          <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className={fieldClass} />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-text-muted">To
          <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className={fieldClass} />
        </label>
        <div className="ml-auto flex items-center gap-3">
          {r && <Badge tone={r.ties_to_ledger ? 'posted' : 'pending_approval'} title="Whether the asset list adds up to the fixed asset accounts in the general ledger at the end date">{r.ties_to_ledger ? 'Matches the books' : 'Does not match the books'}</Badge>}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" disabled={!ready || busy !== null} className={`${secondaryBtn} flex items-center gap-1.5`}>
                <Download className="size-3.5" />{busy ? 'Preparing…' : 'Export'}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {FORMATS.map((f) => <DropdownMenuItem key={f.value} onSelect={() => void runExport(f.value)}>{f.label}</DropdownMenuItem>)}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {!ready ? (
        <p className="text-[13px] text-text-muted">{from && to ? 'The start date must be on or before the end date.' : 'Choose the dates to report on.'}</p>
      ) : report.isLoading || years.isLoading ? (
        <LoadingLine what="the asset schedule" />
      ) : report.error ? (
        <ErrorLine error={report.error} onRetry={report.refetch} />
      ) : r ? (
        <>
          {!r.ties_to_ledger && <p role="status" className="rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-text-primary">The asset list and the general ledger differ. Check the match card on the Asset list tab before relying on this schedule.</p>}
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full border-collapse text-left text-xs" data-testid="asset-schedule">
              <thead>
                <tr className="h-8 border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase text-text-muted">
                  <th className="sticky left-0 bg-surface-neutral px-3">Category</th>
                  {FIGURE_COLUMNS.map((c) => <th key={c.key} className="whitespace-nowrap px-3 text-right">{c.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {r.categories.length === 0 && <tr><td colSpan={FIGURE_COLUMNS.length + 1} className="px-3 py-8 text-center text-text-muted">No assets in this range.</td></tr>}
                {r.categories.map((c) => (
                  <React.Fragment key={c.category_id}>
                    <tr className="cursor-pointer hover:bg-surface-neutral/50" onClick={() => toggle(c.category_id)}>
                      {row(c.category_name, c, { strong: true, lead: open.has(c.category_id) ? <ChevronDown className="mr-1 inline size-3.5" /> : <ChevronRight className="mr-1 inline size-3.5" /> })}
                    </tr>
                    {open.has(c.category_id) && c.assets.map((a) => <tr key={a.asset_id}>{row(<><span className="font-mono text-text-muted">{a.number}</span> {a.name}</>, a, { indent: true })}</tr>)}
                  </React.Fragment>
                ))}
              </tbody>
              {r.categories.length > 0 && <tfoot><tr className="border-t border-border-strong bg-surface-neutral/50">{row('Total', r.totals, { strong: true })}</tr></tfoot>}
            </table>
          </div>

          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-semibold text-text-primary">What happened in this range</h2>
            {r.events.length === 0 ? (
              <p className="text-[13px] text-text-muted">No movements.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border bg-surface">
                <table className="w-full border-collapse text-left text-xs" data-testid="schedule-events">
                  <thead>
                    <tr className="h-8 border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase text-text-muted">
                      <th className="px-3">Date</th><th className="px-3">What</th><th className="px-3">Asset</th><th className="px-3 text-right">Cost</th><th className="px-3 text-right">Depreciation</th><th className="px-3">Journal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {r.events.map((e, i) => (
                      <tr key={i} className="h-8">
                        <td className="px-3 tabular-nums text-text-muted">{formatDate(e.date)}</td>
                        <td className="px-3 text-text-primary">{eventLabel(e.kind)}</td>
                        <td className="px-3 font-mono text-text-secondary">{e.asset_number}</td>
                        <td className="px-3 text-right tabular-nums">{formatMoney(e.cost, cur)}</td>
                        <td className="px-3 text-right tabular-nums">{formatMoney(e.accumulated, cur)}</td>
                        <td className="px-3">{e.journal_id ? <button type="button" onClick={() => navigate(`/${company.slug}/journals/${e.journal_id}`)} className="font-medium text-accent hover:underline">{e.journal_number || 'Open'}</button> : <span className="text-text-muted">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
};
