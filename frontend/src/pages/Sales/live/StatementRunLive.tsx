/** Customers → Send statements (3c.7a): choose a date or period, see who has a balance, send. Live only. */
import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { PageHeader } from '@/components/domain/PageHeader';
import { Checkbox } from '@/components/ui/checkbox';
import { IntentSlot } from '@/api/intentSlot';
import { describeError } from '@/api/messages';
import type { RunPeriod, RunResult } from '@/api/live/statementRun';
import { defaultSelection, describeResult, fitsAllowance, periodProblem, summarise } from '@/api/adapters/statementRun';
import { useRouteCompany } from '@/data/session';
import { useRunCustomers, useRunStatements, useSendStatuses } from '@/data/statementRun';
import { formatDate, formatDateTime, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { BTN_ACCENT, ErrorLine, LoadingLine, TableCard, inputClass } from './parts';

const TONE = { ok: 'bg-success-soft text-success', wait: 'bg-surface-neutral text-text-secondary', bad: 'bg-danger-soft text-danger' } as const;

export const StatementRunLive: React.FC = () => {
  const company = useRouteCompany();
  const [basis, setBasis] = useState<'as_of' | 'period'>('as_of');
  const [asOf, setAsOf] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loaded, setLoaded] = useState<RunPeriod | null>(null);
  const [selected, setSelected] = useState<string[] | null>(null);
  const [results, setResults] = useState<RunResult[] | null>(null);
  const [error, setError] = useState('');
  const slot = useRef(new IntentSlot()).current;

  const draft: RunPeriod = basis === 'as_of' ? { basis, as_of: asOf } : { basis, from, to };
  const problem = periodProblem(draft);
  const list = useRunCustomers(company.id, loaded);
  const run = useRunStatements(company.id);
  const sendIds = useMemo(() => (results ?? []).flatMap((r) => (r.send_id ? [r.send_id] : [])), [results]);
  const statuses = useSendStatuses(company.id, sendIds);
  const byId = useMemo(() => Object.fromEntries((statuses.data ?? []).map((s) => [s.id, s])), [statuses.data]);

  const rows = list.data?.rows ?? [];
  const chosen = selected ?? (list.data ? defaultSelection(rows) : []);
  const allowance = run.data?.allowance ?? list.data?.allowance;
  const fit = allowance ? fitsAllowance(chosen.length, allowance) : ({ ok: true } as const);
  const sendable = rows.filter((r) => r.has_email);

  const load = (e: React.FormEvent) => {
    e.preventDefault();
    if (problem) return setError(problem);
    setError('');
    setSelected(null);
    setResults(null);
    run.reset();
    setLoaded(draft);
  };
  const toggle = (id: string) => setSelected(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);

  const send = async () => {
    if (!loaded || chosen.length === 0 || !fit.ok) return;
    setError('');
    try {
      const out = await run.mutateAsync({ period: loaded, ids: chosen, intent: slot.for(JSON.stringify([loaded, chosen])) });
      slot.clear();
      setResults(out.results);
      toast.success(`Statements: ${summarise(out.results)}.`);
    } catch (e) {
      setError(describeError(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Send statements" subtitle="Email a statement to every customer who owes you something, in one step." />
      <form onSubmit={load} className="flex flex-wrap items-end gap-4 rounded-lg border border-border bg-surface p-4" aria-label="Statement period">
        <fieldset className="flex items-center gap-4 text-[13px]">
          <legend className="sr-only">What to send</legend>
          <label className="flex items-center gap-1.5"><input type="radio" name="basis" checked={basis === 'as_of'} onChange={() => setBasis('as_of')} /> As of a date</label>
          <label className="flex items-center gap-1.5"><input type="radio" name="basis" checked={basis === 'period'} onChange={() => setBasis('period')} /> For a period</label>
        </fieldset>
        {basis === 'as_of' ? (
          <label className="flex flex-col gap-1 text-xs text-text-muted">As of
            <input type="date" aria-label="As of" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={cn(inputClass, 'w-40')} />
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-xs text-text-muted">From
              <input type="date" aria-label="From" value={from} onChange={(e) => setFrom(e.target.value)} className={cn(inputClass, 'w-40')} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-text-muted">To
              <input type="date" aria-label="To" value={to} onChange={(e) => setTo(e.target.value)} className={cn(inputClass, 'w-40')} />
            </label>
          </>
        )}
        <button type="submit" className={BTN_ACCENT} disabled={Boolean(problem)}>Show customers</button>
        <p className="basis-full text-xs text-text-muted">
          {basis === 'as_of' ? 'The statement covers the last three months up to the date, and its balance is the balance on that date.' : 'The statement covers exactly this period.'}
        </p>
      </form>

      {error && <p role="alert" className="text-[13px] text-danger">{error}</p>}
      {list.isPending && loaded && <LoadingLine what="customers" />}
      {list.isError && <ErrorLine error={list.error} onRetry={() => void list.refetch()} />}

      {list.data && !results && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 text-[13px] text-text-secondary">
            <span>{rows.length === 0 ? `No customer has a balance on ${formatDate(list.data.to)}.` : `${rows.length} customer${rows.length === 1 ? '' : 's'} with a balance on ${formatDate(list.data.to)}. ${sendable.length < rows.length ? `${rows.length - sendable.length} have no email address.` : ''}`}</span>
            {allowance && <span data-testid="allowance">{allowance.remaining} of {allowance.limit} emails left this hour</span>}
          </div>
          {rows.length > 0 && (
            <TableCard>
              <table className="w-full text-[13px]" data-testid="run-customers">
                <thead className="border-b border-border text-left text-xs text-text-muted">
                  <tr>
                    <th className="w-10 px-3 py-2">
                      <Checkbox aria-label="Select all customers with an email" checked={sendable.length > 0 && sendable.every((r) => chosen.includes(r.contact_id))} onCheckedChange={(v) => setSelected(v ? sendable.map((r) => r.contact_id) : [])} />
                    </th>
                    <th className="px-3 py-2 font-medium">Customer</th>
                    <th className="px-3 py-2 font-medium">Email</th>
                    <th className="px-3 py-2 text-right font-medium">Balance</th>
                    <th className="px-3 py-2 font-medium">Last statement</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.contact_id} className="border-t border-border" data-customer={r.name}>
                      <td className="px-3 py-2"><Checkbox aria-label={`Select ${r.name}`} disabled={!r.has_email} checked={chosen.includes(r.contact_id)} onCheckedChange={() => toggle(r.contact_id)} /></td>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2">{r.has_email ? r.email : <span className="font-medium text-warning">No email address</span>}</td>
                      <td className={cn('px-3 py-2 text-right tabular-nums', r.balance.amount < 0 && 'text-text-muted')}>{formatMoney(r.balance.amount, r.balance.currency)}</td>
                      <td className="px-3 py-2 text-text-muted">{r.last_sent_at ? formatDateTime(r.last_sent_at) : 'Never'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableCard>
          )}
          {!fit.ok && <p role="alert" className="text-[13px] text-danger" data-testid="over-limit">{fit.message}</p>}
          {rows.length > 0 && (
            <div>
              <button type="button" className={BTN_ACCENT} disabled={chosen.length === 0 || !fit.ok || run.isPending} onClick={() => void send()}>
                {run.isPending ? 'Sending…' : `Send ${chosen.length} statement${chosen.length === 1 ? '' : 's'}`}
              </button>
            </div>
          )}
        </>
      )}

      {results && (
        <>
          <div className="text-[13px] text-text-secondary" role="status">Done: {summarise(results)}.</div>
          <TableCard>
            <table className="w-full text-[13px]" data-testid="run-results">
              <thead className="border-b border-border text-left text-xs text-text-muted"><tr><th className="px-3 py-2 font-medium">Customer</th><th className="px-3 py-2 font-medium">Result</th><th className="px-3 py-2 font-medium">Detail</th></tr></thead>
              <tbody>
                {results.map((r) => {
                  const d = describeResult(r, byId);
                  return (
                    <tr key={r.contact_id} className="border-t border-border" data-customer={r.name}>
                      <td className="px-3 py-2">{r.name}</td>
                      <td className="px-3 py-2"><span className={cn('rounded px-2 py-0.5 text-xs font-medium', TONE[d.tone])}>{d.label}</span></td>
                      <td className="px-3 py-2 text-text-muted">{d.detail}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableCard>
          <div className="flex gap-3 text-[13px]">
            <button type="button" className="text-accent hover:underline" onClick={() => { setResults(null); setSelected(null); run.reset(); }}>Back to the list</button>
            <Link to={`/${company.slug}/customers`} className="text-accent hover:underline">Customers</Link>
          </div>
        </>
      )}
    </div>
  );
};
