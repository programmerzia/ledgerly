/**
 * Exchange rates and month-end adjustment, live mode (step 3.2). Rates are decimal strings from the server and are
 * shown as received: no number parsing, no change %, no sparkline (that would be arithmetic on rates in the browser,
 * docs/15 rule 4). The adjustment figures come from GET /fx-revaluations/preview; the browser only displays them.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ColumnDef } from '@tanstack/react-table';
import { toast } from 'sonner';
import { RefreshCw, Plus, Layers } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { DataTable } from '@/components/domain/DataTable';
import { EmptyState } from '@/components/domain/EmptyState';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { useLedgerStore } from '@/mock/store';
import { formatMoney } from '@/lib/format';
import { useFxRates, useFxRuns, useRevalPreview, useFxActions } from '@/data/fx';
import { useFiscalYears } from '@/data/fiscal';
import { isRateText, type LiveRate } from '@/api/adapters/fx';
import { createIntent } from '@/api/idempotency';
import { describeError } from '@/api/messages';
import { describeProblem } from '@/api/live/writeProblems';
import { isSignCancelled, useSignedRunner } from '@/api/live/signedRunner';
import { ApiError } from '@/api/errors';

type Tab = 'rates' | 'revaluation';

const BLOCKERS: Record<string, string> = {
  fx_revaluation_exists: 'This month already has an adjustment.',
  fx_rate_missing: 'A rate is missing for one of the currencies below.',
  period_closed: 'This month is closed.',
};

const Loading: React.FC<{ what: string }> = ({ what }) => <p className="p-4 text-[13px] text-text-muted" role="status">Loading {what}…</p>;
const Failed: React.FC<{ error: unknown; retry: () => void }> = ({ error, retry }) => (
  <div className="p-4 text-[13px] text-danger" role="alert">
    {describeError(error)}{' '}
    <button type="button" onClick={retry} className="text-accent hover:underline cursor-pointer">Try again</button>
  </div>
);

export const LiveFxRates: React.FC = () => {
  const base = useLedgerStore((s) => s.currentCompany.base_currency);
  const uiDensity = useLedgerStore((s) => s.uiDensity);
  const rates = useFxRates();
  const runs = useFxRuns();
  const years = useFiscalYears();
  const actions = useFxActions();
  const signed = useSignedRunner();

  const [tab, setTab] = useState<Tab>('rates');
  const [isSyncing, setIsSyncing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Manual rate form
  const [addOpen, setAddOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [rateText, setRateText] = useState('');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [formProblem, setFormProblem] = useState<string | null>(null);
  const intent = useRef(createIntent());
  const openAdd = (seed?: Partial<LiveRate>) => {
    intent.current = createIntent();
    setFormProblem(null);
    setFrom(seed?.from_currency ?? '');
    setTo(seed?.to_currency ?? base);
    setRateText(seed?.rate ?? '');
    setDate('');
    setAddOpen(true);
  };

  // Adjustment
  const periods = useMemo(() => years.data.flatMap((y) => y.periods.filter((p) => p.kind !== 'adjustment').map((p) => ({ id: p.id, name: p.name, status: p.status }))), [years.data]);
  const [periodId, setPeriodId] = useState('');
  const [asOf, setAsOf] = useState('');
  useEffect(() => {
    if (!periodId && periods.length > 0) setPeriodId((periods.find((p) => p.status === 'open') ?? periods[0]).id);
  }, [periods, periodId]);
  const preview = useRevalPreview(periodId || undefined, asOf);
  const [success, setSuccess] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const runIntent = useRef(createIntent());
  const periodName = (id: string) => periods.find((p) => p.id === id)?.name ?? '';

  const cards = useMemo(() => {
    const byPair = new Map<string, LiveRate>();
    for (const r of rates.data) {
      const k = `${r.from_currency}/${r.to_currency}`;
      const cur = byPair.get(k);
      if (!cur || r.rate_date > cur.rate_date) byPair.set(k, r);
    }
    return [...byPair.entries()];
  }, [rates.data]);

  const syncRates = async () => {
    setIsSyncing(true);
    setProblem(null);
    try {
      const res = await actions.fetchProviderRates();
      toast.success(res.inserted > 0 ? `${res.inserted} ${res.inserted === 1 ? 'rate' : 'rates'} updated from ${res.provider}${res.rate_date ? ` for ${res.rate_date}` : ''}` : `No new rates came from ${res.provider}`);
    } catch (e) {
      setProblem(e instanceof ApiError && e.code === 'fx_provider_unavailable' ? 'The rate provider is not answering. No rates were changed; try again later or add a rate by hand.' : describeProblem(e));
    } finally {
      setIsSyncing(false);
    }
  };

  const submitRate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isRateText(rateText)) return;
    setBusy(true);
    setFormProblem(null);
    try {
      await actions.addRate({ from, to, date, rate: rateText }, intent.current);
      toast.success('Rate saved');
      setAddOpen(false);
    } catch (err) {
      setFormProblem(describeProblem(err));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!preview.data) return;
    setRunning(true);
    setProblem(null);
    setSuccess(null);
    try {
      const res = await signed.run(() => actions.runRevaluation(periodId, asOf, runIntent.current), {
        title: `FX month-end adjustment, ${periodName(periodId)}`,
        consequence: `This posts the exchange gain or loss the server calculated for ${periodName(periodId)} and schedules its automatic reversal. Posted entries cannot be edited, only reversed.`,
        actionTitle: 'Sign and record adjustment',
      });
      runIntent.current = createIntent();
      setSuccess(`Month-end adjustment recorded (journal ${res.journal_id ?? 'pending'}).${res.reversal_pending ? ' Its reversal waits for the next month to exist and be open.' : ' It is reversed automatically at the start of the next month.'}`);
    } catch (e) {
      if (!isSignCancelled(e)) setProblem(describeProblem(e));
    } finally {
      setRunning(false);
    }
  };

  const columns: ColumnDef<LiveRate>[] = [
    { id: 'pair', header: 'Currencies', cell: ({ row }) => <span className="font-mono font-semibold text-text-primary">{row.original.from_currency} <span className="text-text-muted">to</span> {row.original.to_currency}</span> },
    { accessorKey: 'rate_date', header: 'Date', cell: ({ row }) => <span className="text-text-muted">{row.original.rate_date}</span> },
    { accessorKey: 'rate', header: () => <div className="text-right">Rate</div>, cell: ({ row }) => <div className="text-right font-mono font-semibold tabular-nums text-text-primary">{row.original.rate}</div> },
    { accessorKey: 'source', header: 'Source', cell: ({ row }) => <span className="rounded-[3px] bg-surface-neutral px-2 py-0.5 text-xs font-medium capitalize text-text-secondary">{row.original.source}</span> },
  ];

  const tabBtn = (id: Tab, label: string) => (
    <button type="button" onClick={() => setTab(id)} className={`rounded-[4px] px-3 py-1 text-[13px] font-medium transition cursor-pointer ${tab === id ? 'bg-surface text-text-primary' : 'text-text-muted hover:text-text-primary'}`}>
      {label}
    </button>
  );

  const p = preview.data;
  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Exchange rates"
        subtitle={`Rates used to convert other currencies into ${base}, and the month-end adjustment`}
        actions={
          <>
            <button type="button" onClick={() => void syncRates()} disabled={isSyncing} className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition hover:bg-surface-neutral cursor-pointer disabled:opacity-60">
              <RefreshCw className={`size-4 text-text-muted ${isSyncing ? 'animate-spin' : ''}`} />
              <span>{isSyncing ? 'Updating…' : 'Update rates'}</span>
            </button>
            <button type="button" onClick={() => openAdd()} className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover cursor-pointer">
              <Plus className="size-4" />
              <span>Add rate</span>
            </button>
          </>
        }
      />

      {problem && <div className="rounded-lg border border-danger/30 bg-danger-soft px-4 py-3 text-[13px] font-medium text-danger" role="alert">{problem}</div>}

      <div className="flex w-fit items-center gap-1 rounded-md bg-surface-neutral p-0.5">
        {tabBtn('rates', 'Rates')}
        {tabBtn('revaluation', 'Month-end adjustment')}
      </div>

      {tab === 'rates' &&
        (rates.isLoading ? (
          <Loading what="rates" />
        ) : rates.error ? (
          <Failed error={rates.error} retry={rates.refetch} />
        ) : rates.data.length === 0 ? (
          <EmptyState icon={RefreshCw} title="No exchange rates yet" description="Add a rate by hand, or update rates from the provider. Rates are needed before you can adjust foreign-currency balances." actionLabel="Add rate" onAction={() => openAdd()} />
        ) : (
          <div className="flex flex-col gap-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cards.map(([pair, r]) => (
                <div key={pair} className="rounded-md border border-border bg-surface p-4 transition hover:border-border-strong">
                  <div className="text-[13px] font-medium text-text-primary">{r.from_currency} / {r.to_currency}</div>
                  <div className="mt-1 text-[22px] leading-7 font-medium tabular-nums text-text-primary">{r.rate}</div>
                  <div className="mt-2 text-xs text-text-muted">{r.rate_date} · <span className="capitalize">{r.source}</span></div>
                </div>
              ))}
            </div>
            <DataTable
              columns={columns}
              data={rates.data}
              searchPlaceholder="Filter rates by currency or date"
              rowDensity={uiDensity}
              rowActions={() => [
                { label: 'Use as new rate', icon: Plus, onClick: (row: LiveRate) => openAdd(row) },
                { label: 'Copy rate', icon: Layers, onClick: (row: LiveRate) => { void navigator.clipboard?.writeText(row.rate); toast.success('Rate copied'); } },
              ]}
              contextMenuTitle={(r: LiveRate) => `${r.from_currency}/${r.to_currency} · ${r.rate_date}`}
            />
          </div>
        ))}

      {tab === 'revaluation' && (
        <div className="flex flex-col gap-5">
          {success && <div className="p-3 bg-success-soft border border-success/30 rounded-md text-success text-xs" role="status">{success}</div>}

          {years.isLoading ? (
            <Loading what="periods" />
          ) : years.error ? (
            <Failed error={years.error} retry={years.refetch} />
          ) : periods.length === 0 ? (
            <EmptyState icon={RefreshCw} title="No financial year yet" description="The month-end adjustment works on a month of a financial year. Set one up first." />
          ) : (
            <>
              <div className="p-4 bg-surface border border-border rounded-lg grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div className="flex flex-col gap-1">
                  <label htmlFor="reval-period" className="text-xs font-medium text-text-muted">Accounting period</label>
                  <select id="reval-period" value={periodId} onChange={(e) => { setPeriodId(e.target.value); setSuccess(null); runIntent.current = createIntent(); }} className="h-8 px-2.5 rounded-md border border-border bg-surface text-text-primary focus:outline-none focus:border-accent">
                    {periods.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="reval-asof" className="text-xs font-medium text-text-muted">Adjust as of</label>
                  <input id="reval-asof" type="date" value={asOf} onChange={(e) => { setAsOf(e.target.value); runIntent.current = createIntent(); }} className="h-8 px-2.5 font-mono text-text-primary rounded-md border border-border bg-surface focus:outline-none focus:border-accent" />
                  <span className="text-[11px] text-text-muted">Leave empty for the end of the month.</span>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-xs font-medium text-text-muted">Adjusted as of</span>
                  <div className="h-8 px-2.5 flex items-center rounded-md border border-border bg-surface-neutral font-mono font-medium text-text-primary">{p?.as_of ?? '—'}</div>
                </div>
              </div>

              {preview.isLoading ? (
                <Loading what="the adjustment" />
              ) : preview.error ? (
                <Failed error={preview.error} retry={preview.refetch} />
              ) : p ? (
                <div className="p-4 bg-surface border border-border rounded-lg flex flex-col gap-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-text-primary text-sm">Foreign-currency balances to adjust</span>
                    <span className="text-[11px] text-text-muted">Open customer, supplier and bank balances are restated at the month-end rate</span>
                  </div>

                  {(p.blockers.length > 0 || p.missing_rates.length > 0) && (
                    <div className="rounded-md border border-warning/40 bg-warning-soft p-3 text-[12px] text-text-primary" role="status">
                      {p.blockers.map((b) => <div key={b}>{BLOCKERS[b] ?? b}</div>)}
                      {p.missing_rates.length > 0 && <div>No rate yet for: <span className="font-mono">{p.missing_rates.join(', ')}</span>. Add them on the Rates tab.</div>}
                    </div>
                  )}

                  {p.items.length === 0 ? (
                    <p className="rounded-md border border-border bg-surface-neutral/40 p-4 text-[13px] text-text-muted">No foreign-currency balances need an adjustment for this month.</p>
                  ) : (
                    <div className="border border-border rounded-md overflow-x-auto">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead>
                          <tr className="h-8 bg-surface-neutral border-b border-border text-[11px] font-semibold text-text-muted uppercase">
                            <th className="px-3">Account</th>
                            <th className="px-3">Currency</th>
                            <th className="px-3 text-right">Balance</th>
                            <th className="px-3 text-right">Value then</th>
                            <th className="px-3 text-right">Rate now</th>
                            <th className="px-3 text-right">Value now</th>
                            <th className="px-3 text-right">Gain / (loss)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {p.items.map((item, i) => (
                            <tr key={`${item.account_id}-${i}`} className="h-9 hover:bg-surface-neutral transition">
                              <td className="px-3 font-medium text-text-primary"><span className="font-code text-text-muted">{item.account_code}</span></td>
                              <td className="px-3 font-medium text-text-primary">{item.currency}</td>
                              <td className="px-3 text-right text-num text-text-primary">{formatMoney(item.amount_fc, item.currency)}</td>
                              <td className="px-3 text-right text-num text-text-primary">{formatMoney(item.carried_base, p.base_currency)}</td>
                              <td className="px-3 text-right text-num text-text-muted" title={`${item.rate_date} ${item.rate_source}`}>{item.closing_rate}</td>
                              <td className="px-3 text-right text-num text-text-primary">{formatMoney(item.revalued_base, p.base_currency)}</td>
                              <td className="px-3 text-right text-num font-semibold text-text-primary">{formatMoney(item.unrealised, p.base_currency, { parenthesesNegative: true })}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {p.residuals.length > 0 && (
                    <p className="text-[11px] text-text-muted">
                      Left alone (a base-currency amount remains with no foreign balance): {p.residuals.map((r) => `${r.account_code} ${r.currency} ${formatMoney(r.carried_base, p.base_currency)}`).join('; ')}.
                    </p>
                  )}

                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 pt-4 border-t border-border">
                    <div className="p-3 bg-surface-neutral border border-border rounded-md text-text-primary max-w-lg">
                      <span className="font-semibold text-xs text-text-primary block mb-1">What this does</span>
                      <p className="text-xs text-text-muted leading-relaxed">
                        This records the exchange gain or loss shown here for {periodName(periodId)}. It is reversed automatically at the start of the next month so it is not counted twice.
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-3">
                      <div className="text-right">
                        <span className="text-text-muted text-xs block">Net gain / (loss)</span>
                        <span className="text-xl font-medium text-num text-text-primary">{formatMoney(p.total_unrealised, p.base_currency, { parenthesesNegative: true })}</span>
                      </div>
                      <button type="button" onClick={() => void run()} disabled={!p.can_run || running || p.items.length === 0} className="h-8 px-5 bg-accent hover:bg-accent-hover text-white rounded-md font-medium text-[13px] transition flex items-center gap-1.5 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                        <span>{running ? 'Recording…' : 'Sign and record adjustment'}</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              <div className="p-4 bg-surface border border-border rounded-lg flex flex-col gap-2 text-xs">
                <span className="font-semibold text-text-primary text-sm">Earlier adjustments</span>
                {runs.isLoading ? (
                  <Loading what="earlier adjustments" />
                ) : runs.error ? (
                  <Failed error={runs.error} retry={runs.refetch} />
                ) : runs.data.length === 0 ? (
                  <p className="text-[13px] text-text-muted">None recorded yet.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {runs.data.map((r) => (
                      <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                        <span className="text-text-primary">{periodName(r.period_id) || 'Month'} · as of <span className="font-mono">{r.as_of}</span> · <span className="capitalize">{r.status}</span></span>
                        <span className="text-num font-medium text-text-primary">{formatMoney(r.total_unrealised, r.base_currency, { parenthesesNegative: true })}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <Dialog open={addOpen} onOpenChange={(o) => !busy && setAddOpen(o)}>
        <DialogContent className="max-w-[420px] p-5">
          <form onSubmit={submitRate} className="flex flex-col gap-4 text-xs">
            <DialogHeader><DialogTitle className="text-sm font-semibold text-text-primary">Add exchange rate</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-1">
              <label className="text-[11px] text-text-muted font-medium">Currencies (1 of the first = the rate of the second)</label>
              <div className="flex items-center gap-2">
                <input aria-label="From currency" maxLength={3} value={from} onChange={(e) => setFrom(e.target.value.toUpperCase())} placeholder="EUR" className="w-1/2 h-8 px-2 font-mono rounded-md border border-border bg-surface text-text-primary" />
                <span>/</span>
                <input aria-label="To currency" maxLength={3} value={to} onChange={(e) => setTo(e.target.value.toUpperCase())} placeholder={base} className="w-1/2 h-8 px-2 font-mono rounded-md border border-border bg-surface text-text-primary" />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="fx-rate" className="text-[11px] text-text-muted font-medium">Rate</label>
              <input id="fx-rate" inputMode="decimal" value={rateText} onChange={(e) => setRateText(e.target.value)} placeholder="1.12000000" className="h-8 px-2 font-mono text-right rounded-md border border-border bg-surface text-text-primary" />
              {rateText.trim() !== '' && !isRateText(rateText) && <span className="text-danger">Use digits with up to 8 decimals, for example 1.1234.</span>}
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="fx-date" className="text-[11px] text-text-muted font-medium">Effective date</label>
              <input id="fx-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-8 px-2 font-mono rounded-md border border-border bg-surface text-text-primary" />
            </div>
            {formProblem && <p className="text-danger" role="alert">{formProblem}</p>}
            <DialogFooter className="gap-2 pt-2 border-t border-border">
              <button type="button" onClick={() => setAddOpen(false)} disabled={busy} className="h-8 px-3 rounded-md border border-border bg-surface hover:bg-surface-neutral text-text-secondary transition">Cancel</button>
              <button type="submit" disabled={busy || !isRateText(rateText) || !date || from.length !== 3 || to.length !== 3} className="h-8 px-3 rounded-md bg-accent text-white text-[13px] font-medium hover:bg-accent-hover transition disabled:opacity-50">{busy ? 'Saving…' : 'Save rate'}</button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {signed.dialog}
    </div>
  );
};
