import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { useDepreciationPreview, useDepreciationRuns, useFixedAssetActions } from '@/data/fixedAssets';
import { useFiscalYears } from '@/data/fiscal';
import { useActiveCompany } from '@/data/session';
import { blockerText, unitsBody, type DepreciationLine, type DepreciationRun } from '@/api/adapters/fixedAssets';
import { defaultPeriod, defaultYear } from '@/api/adapters/fiscal';
import { formatDate, formatMoney } from '@/lib/format';
import { ErrorLine, LoadingLine } from '../parts';
import { DocActions, DocStatusBadge, Field, fieldClass, Note, primaryBtn, Problem, type Writer } from './parts';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const UnitsRow: React.FC<{ line: DepreciationLine; value: string; onChange: (v: string) => void }> = ({ line, value, onChange }) => (
  <tr className="h-9">
    <td className="px-3 font-mono text-accent">{line.asset_number}</td>
    <td className="px-3 text-text-primary">{line.asset_name}</td>
    <td className="px-3 text-right">
      <input aria-label={`Units used for ${line.asset_number}`} inputMode="numeric" value={value} onChange={(e) => onChange(e.target.value)} className={`${fieldClass} w-28 text-right`} />
    </td>
  </tr>
);

export const DepreciationTab: React.FC<{ writer: Writer }> = ({ writer }) => {
  const navigate = useNavigate();
  const { company } = useActiveCompany();
  const cur = company.base_currency;
  const years = useFiscalYears();
  const runs = useDepreciationRuns();
  const actions = useFixedAssetActions();

  const periods = useMemo(
    () => years.data.flatMap((y) => y.periods).filter((p) => p.kind !== 'adjustment').sort((a, b) => b.starts_on.localeCompare(a.starts_on)),
    [years.data],
  );
  const [picked, setPicked] = useState('');
  const [units, setUnits] = useState<Record<string, string>>({});
  const [memo, setMemo] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  const periodId = picked || defaultPeriod(defaultYear(years.data))?.id || periods[0]?.id || '';

  const debouncedUnits = useDebounced(units, 400);
  const preview = useDepreciationPreview(periodId, debouncedUnits);
  const p = preview.data;
  const periodName = (id: string) => periods.find((x) => x.id === id)?.name ?? '';
  const unitLines = p ? [...p.pending_units, ...p.lines.filter((l) => l.method === 'units_of_production')] : [];
  const blockedOnlyByUnits = p ? p.blockers.length > 0 && p.blockers.every((b) => b === 'units_required') : false;
  const canDraft = Boolean(p) && p!.blockers.length === 0 && p!.lines.length > 0;

  const draft = async () => {
    if (!p) return;
    setProblem(null);
    const body = { period_id: periodId, units: unitsBody(units), memo: memo.trim() || null };
    const r = await writer.exec('run:new', JSON.stringify(body), (intent) => actions.createRun(body, intent), { noun: 'depreciation run', onProblem: setProblem });
    if (r) {
      toast.success('Draft saved. Submit it below to record the depreciation.');
      setMemo('');
      setUnits({});
    }
  };

  const [openRun, setOpenRun] = useState<string | null>(null);
  const runRow = (r: DepreciationRun) => (
    <React.Fragment key={r.id}>
      <tr className="h-11 hover:bg-surface-neutral/50">
        <td className="px-3 font-mono text-text-primary">
          <button type="button" onClick={() => setOpenRun(openRun === r.id ? null : r.id)} className="hover:underline" aria-expanded={openRun === r.id}>{r.number || 'Draft'}</button>
        </td>
        <td className="px-3 text-text-secondary">{periodName(r.period_id) || (r.as_of ? formatDate(r.as_of) : '')}</td>
        <td className="px-3"><DocStatusBadge status={r.status} /></td>
        <td className="px-3 text-right font-semibold tabular-nums">{formatMoney(r.total, cur)}</td>
        <td className="px-3">
          {r.journal_id && <button type="button" onClick={() => navigate(`/${company.slug}/journals/${r.journal_id}`)} className="text-xs font-medium text-accent hover:underline">Journal</button>}
          {r.reversal_journal_id && <button type="button" onClick={() => navigate(`/${company.slug}/journals/${r.reversal_journal_id}`)} className="ml-3 text-xs font-medium text-accent hover:underline">Reversal journal</button>}
        </td>
        <td className="px-3 py-1.5">
          <DocActions
            doc={r}
            noun="Depreciation run"
            total={r.total}
            writer={writer}
            perform={(step, body, intent) => actions.transitionRun(r.id, step, body, intent)}
          />
        </td>
      </tr>
      {openRun === r.id && (
        <tr className="bg-surface-neutral/40">
          <td colSpan={6} className="px-4 py-3">
            {r.memo && <p className="mb-2 text-xs text-text-secondary">{r.memo}</p>}
            {r.lines.length === 0 ? (
              <p className="text-xs text-text-muted">No lines.</p>
            ) : (
              <table className="w-full text-xs">
                <tbody className="divide-y divide-border">
                  {r.lines.map((l) => (
                    <tr key={l.id} className="h-8">
                      <td className="font-mono text-text-muted">{l.asset_number}</td>
                      <td className="text-text-primary">{l.asset_name}</td>
                      <td className="text-text-muted">{l.catch_up_months > 0 ? `${l.months} months, ${l.catch_up_months} caught up` : `${l.months} month${l.months === 1 ? '' : 's'}`}</td>
                      <td className="text-right tabular-nums">{formatMoney(l.amount, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </React.Fragment>
  );

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-[16rem_1fr]">
          <Field label="Month to depreciate">
            <select value={periodId} onChange={(e) => { setPicked(e.target.value); setUnits({}); setProblem(null); }} className={fieldClass} aria-label="Month to depreciate">
              {periods.map((x) => <option key={x.id} value={x.id}>{x.name}{x.status === 'closed' || x.status === 'locked' ? ' (closed)' : ''}</option>)}
            </select>
          </Field>
          <Field label="Note (optional)"><input value={memo} onChange={(e) => setMemo(e.target.value)} className={fieldClass} placeholder="For example October depreciation" /></Field>
        </div>

        {years.isLoading || preview.isLoading ? (
          <LoadingLine what="this month's depreciation" />
        ) : preview.error ? (
          <ErrorLine error={preview.error} onRetry={preview.refetch} />
        ) : p ? (
          <>
            {p.blockers.length > 0 && (
              <ul role="status" data-testid="blockers" className="flex flex-col gap-1 rounded-md border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-text-primary">
                {p.blockers.map((b) => <li key={b}>{blockerText(b)}</li>)}
              </ul>
            )}

            {unitLines.length > 0 && (
              <div className="overflow-hidden rounded-lg border border-border">
                <div className="bg-surface-neutral px-3 py-1.5 text-[11px] font-semibold uppercase text-text-muted">Units needed</div>
                <table className="w-full text-left text-xs">
                  <tbody className="divide-y divide-border">
                    {unitLines.map((l) => <UnitsRow key={l.asset_id} line={l} value={units[l.asset_id] ?? (l.units ? String(l.units) : '')} onChange={(v) => setUnits((u) => ({ ...u, [l.asset_id]: v }))} />)}
                  </tbody>
                </table>
              </div>
            )}

            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full border-collapse text-left text-xs" data-testid="depreciation-preview">
                <thead>
                  <tr className="h-8 border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase text-text-muted">
                    <th className="px-3">Asset</th>
                    <th className="px-3">Name</th>
                    <th className="px-3">Months</th>
                    <th className="px-3 text-right">Amount</th>
                    <th className="px-3 text-right">Value before</th>
                    <th className="px-3 text-right">Value after</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {p.lines.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-text-muted">{blockedOnlyByUnits ? 'Enter the units above to see the amounts.' : 'Nothing to depreciate.'}</td></tr>
                  )}
                  {p.lines.map((l) => (
                    <tr key={l.asset_id} className="h-9">
                      <td className="px-3 font-mono text-accent">{l.asset_number}</td>
                      <td className="px-3 text-text-primary">{l.asset_name}</td>
                      <td className="px-3 text-text-secondary">
                        {l.months}
                        {l.catch_up_months > 0 && <span className="ml-1.5 rounded-[3px] bg-warning-soft px-1 text-[11px] font-medium text-warning" title="Earlier months that were never depreciated are included in this charge.">includes {l.catch_up_months} earlier month{l.catch_up_months === 1 ? '' : 's'}</span>}
                      </td>
                      <td className="px-3 text-right font-semibold tabular-nums text-danger">{formatMoney(l.amount, cur)}</td>
                      <td className="px-3 text-right tabular-nums text-text-muted">{formatMoney(l.carrying_before, cur)}</td>
                      <td className="px-3 text-right tabular-nums text-text-primary">{formatMoney(l.carrying_after, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
              <Note>Drafting saves the run but posts nothing. Submitting it records one journal: depreciation expense against depreciation so far. A second person may need to approve it.</Note>
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <span className="block text-xs text-text-muted">Total this month</span>
                  <span className="text-lg font-medium tabular-nums text-danger">{formatMoney(p.total, cur)}</span>
                </div>
                <button type="button" disabled={!canDraft || writer.busy === 'run:new'} onClick={() => void draft()} className={primaryBtn}>{writer.busy === 'run:new' ? 'Saving…' : 'Draft the run'}</button>
              </div>
            </div>
            <Problem message={problem} />
          </>
        ) : (
          <p className="text-[13px] text-text-muted">Choose a month.</p>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-text-primary">Depreciation runs</h2>
        {runs.isLoading ? (
          <LoadingLine what="runs" />
        ) : runs.error ? (
          <ErrorLine error={runs.error} onRetry={runs.refetch} />
        ) : runs.data.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-[13px] text-text-muted">No runs yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full border-collapse text-left text-xs" data-testid="run-rows">
              <thead>
                <tr className="h-8 border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase text-text-muted">
                  <th className="px-3">Run</th><th className="px-3">Month</th><th className="px-3">Status</th><th className="px-3 text-right">Total</th><th className="px-3" /><th className="px-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">{runs.data.map(runRow)}</tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
