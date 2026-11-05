/**
 * Month-end close pack, live (step 3c.3). Every figure is one the server produced: the close checks, the trial balance at
 * the period's last day, the receivables and payables aging, and the bank accounts. Where a figure has no honest source
 * (the bank's books balance at period end for a foreign-currency account, the names of who signs off) the pack says so or
 * leaves a blank line; it never fills a gap with an invented number.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Download, Printer, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/domain/PageHeader';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import { formatDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { exportReport, saveFile } from '@/api/live/reports';
import { reportQuery, useReport } from '@/data/reports';
import { useRouteCompany } from '@/data/session';
import { useCloseChecks, useFiscalYears } from '@/data/fiscal';
import { useBankAccounts } from '@/data/banking';
import { useSettings } from '@/data/admin';
import type { ReportSelection } from '@/api/adapters/report';
import { allPeriods, bankRows, checklistCsv, checklistFilename, controlTie, pickPeriod, type Tie } from '@/api/adapters/closePack';
import { ErrorLine, LoadingLine } from './parts';

const btn = 'flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-secondary transition hover:bg-surface-neutral disabled:cursor-not-allowed disabled:opacity-50';

const Section: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <section className="flex flex-col gap-3 break-inside-avoid">
    <h3 className="flex items-center gap-2 border-b border-border pb-2 text-sm font-semibold text-text-primary">
      <span className="tabular-nums text-text-muted">{n}.</span>
      {title}
    </h3>
    {children}
  </section>
);

/** One section's trouble, in words. A 403 is not an error of the pack: this person simply cannot see that figure. */
const Unavailable: React.FC<{ error: unknown; what: string; onRetry?: () => void }> = ({ error, what, onRetry }) =>
  error instanceof ApiError && error.status === 403 ? (
    <p className="rounded-lg border border-border bg-surface-neutral/50 p-4 text-[13px] text-text-secondary">Your role cannot see {what}, so this part of the pack is left out.</p>
  ) : (
    <p role="alert" className="rounded-lg border border-border p-4 text-[13px] text-danger">
      {describeError(error)}{' '}
      {onRetry && <button type="button" onClick={onRetry} className="cursor-pointer text-accent hover:underline">Try again</button>}
    </p>
  );

const selectionFor = (when: ReportSelection['when']): ReportSelection => ({ when, basis: 'month', comparison: 'none', hideZero: false, dims: {} });

export const ClosePackLive: React.FC = () => {
  const company = useRouteCompany();
  const [params, setParams] = useSearchParams();
  const years = useFiscalYears();
  const periods = useMemo(() => allPeriods(years.data), [years.data]);
  const period = pickPeriod(periods, params.get('period'));
  const [exporting, setExporting] = useState(false);

  // The pack can run past one page; see `html.print-flow` in index.css.
  useEffect(() => {
    document.documentElement.classList.add('print-flow');
    return () => document.documentElement.classList.remove('print-flow');
  }, []);

  const settings = useSettings(company.id);
  const checks = useCloseChecks(period?.id, Boolean(period));
  const tbSel = selectionFor({ kind: 'period', periodId: period?.id ?? '' });
  const asOfSel = selectionFor({ kind: 'asof', date: period?.ends_on ?? '' });
  const tb = useReport('trial-balance', tbSel, Boolean(period));
  const ar = useReport('ar-aging', asOfSel, Boolean(period));
  const ap = useReport('ap-aging', asOfSel, Boolean(period));
  const banks = useBankAccounts();

  if (years.isLoading) return <LoadingLine what="periods" />;
  if (years.error) return <ErrorLine error={years.error} onRetry={years.refetch} />;
  if (!period) {
    return (
      <div className="flex flex-col gap-6">
        <PageHeader breadcrumb={[{ label: 'Periods and close', to: `/${company.slug}/periods` }, { label: 'Close pack' }]} title="Month-end close pack" subtitle="There is no period to report on yet." />
        <p className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">A financial year with its months is created during company setup. Once one exists, its months can be checked here.</p>
      </div>
    );
  }

  const posting = settings.data?.posting_accounts as Record<string, { account_id: string } | null> | undefined;
  const arTie: Tie | null = ar.data && tb.data ? controlTie(ar.data, tb.data, posting?.ar_control?.account_id, true) : null;
  const apTie: Tie | null = ap.data && tb.data ? controlTie(ap.data, tb.data, posting?.ap_control?.account_id, false) : null;
  const bankList = bankRows(banks.data, tb.data, period.ends_on);
  const allPass = checks.data.length > 0 && checks.data.every((c) => c.status === 'pass');
  const cur = tb.data?.currency ?? company.base_currency;
  const legalName = settings.data?.legal_name || settings.data?.name || company.legal_name || company.name;
  const taxId = settings.data?.tax_id || company.tax_id;
  const money = (n: number, c = cur) => formatMoney(n, c);

  const downloadChecklist = () => {
    const blob = new Blob([checklistCsv(period, checks.data)], { type: 'text/csv;charset=utf-8' });
    saveFile({ blob, filename: checklistFilename(period.name) });
  };
  const exportTrialBalance = async () => {
    setExporting(true);
    try {
      saveFile(await exportReport(company.id, 'trial-balance', 'xlsx', reportQuery('trial-balance', tbSel), { onQueued: () => toast.message('The export is being prepared.') }));
    } catch (e) {
      toast.error(describeError(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 print:gap-4">
      <div className="print:hidden">
        <PageHeader
          breadcrumb={[{ label: 'Periods and close', to: `/${company.slug}/periods` }, { label: 'Close pack' }]}
          title="Month-end close pack"
          subtitle={`${period.name}: proof that the books are complete and balanced`}
          actions={
            <>
              <Link to={`/${company.slug}/periods`} className={btn}><ArrowLeft className="size-4" /> Back</Link>
              <select
                aria-label="Period"
                value={period.id}
                onChange={(e) => setParams({ period: e.target.value }, { replace: true })}
                className="h-8 rounded-md border border-border bg-surface px-2 text-[13px] text-text-primary focus:border-accent focus:outline-none"
              >
                {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="button" onClick={downloadChecklist} disabled={checks.data.length === 0} className={btn}><Download className="size-4" /> Checklist (CSV)</button>
              <button type="button" onClick={() => void exportTrialBalance()} disabled={exporting || !tb.data} className={btn}><Download className="size-4" /> {exporting ? 'Preparing…' : 'Trial balance (Excel)'}</button>
              <button type="button" onClick={() => window.print()} className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover"><Printer className="size-4" /> Print or save PDF</button>
            </>
          }
        />
      </div>

      <article className="mx-auto flex w-full max-w-4xl flex-col gap-8 rounded-lg border border-border bg-surface px-6 py-8 sm:px-12 sm:py-10 print:max-w-none print:border-0 print:p-0 print:shadow-none" data-testid="close-pack">
        {/* A div, not a <header>: the print stylesheet hides every <header>, which would drop the company and period from the printout. */}
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div>
            <h2 className="text-xl font-semibold text-text-primary">Month-end close pack</h2>
            <p className="mt-0.5 text-[13px] text-text-muted">
              {legalName}{taxId ? ` · Tax ID ${taxId}` : ''} · {cur}
            </p>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-text-primary">{period.name}</div>
            <div className="text-xs text-text-muted">{formatDate(period.starts_on)} to {formatDate(period.ends_on)}</div>
            <div className="mt-1 text-xs text-text-muted">
              {period.status === 'closed' || period.status === 'locked' ? `${period.status === 'locked' ? 'Locked' : 'Closed'}${period.closed_at ? ` on ${formatDate(period.closed_at)}` : ''}` : period.status === 'soft_closed' ? 'Soft closed' : 'Still open'}
            </div>
            {checks.data.length > 0 && (
              <div className={cn('mt-2 inline-flex items-center gap-1.5 rounded-[3px] px-2 py-0.5 text-xs font-medium', allPass ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning')}>
                {allPass ? 'All checks passed' : 'Some checks still open'}
              </div>
            )}
          </div>
        </div>

        <Section n={1} title="Checks before closing">
          {checks.isLoading ? (
            <LoadingLine what="the checks" />
          ) : checks.error ? (
            checks.error instanceof ApiError && checks.error.status === 403 ? (
              <p className="rounded-lg border border-border bg-surface-neutral/50 p-4 text-[13px] text-text-secondary">The checklist is for people who can close periods.</p>
            ) : (
              <ErrorLine error={checks.error} onRetry={checks.refetch} />
            )
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border" data-testid="pack-checks">
              {checks.data.map((chk) => {
                const ok = chk.status === 'pass';
                return (
                  <li key={chk.id} className="flex items-center justify-between gap-4 px-4 py-3 text-[13px]">
                    <span className="flex items-center gap-2.5 font-medium text-text-primary">
                      {ok ? <CheckCircle2 className="size-4 shrink-0 text-success" /> : <XCircle className="size-4 shrink-0 text-danger" />}
                      {chk.title}
                    </span>
                    <span className="text-right text-xs text-text-muted">{chk.detail}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section n={2} title="Bank accounts agree with the bank">
          {banks.isLoading || tb.isLoading ? (
            <LoadingLine what="bank accounts" />
          ) : banks.error ? (
            <Unavailable error={banks.error} what="bank accounts" onRetry={banks.refetch} />
          ) : bankList.length === 0 ? (
            <p className="text-[13px] text-text-muted">There are no bank or cash accounts.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-left text-[13px] tabular-nums" data-testid="pack-banks">
                <thead>
                  <tr className="border-b border-border bg-surface-neutral/60 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                    <th className="px-4 py-2.5">Account</th>
                    <th className="px-4 py-2.5 text-right">Bank statement</th>
                    <th className="px-4 py-2.5 text-right">Your books</th>
                    <th className="px-4 py-2.5 text-right">Difference</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {bankList.map((b) => (
                    <tr key={b.id}>
                      <td className="px-4 py-2.5 align-top">
                        <div className="font-medium text-text-primary">{b.name}</div>
                        {b.note && <div className="mt-0.5 max-w-xs text-[11px] font-normal text-text-muted">{b.note}</div>}
                        {b.unreconciled !== null && b.unreconciled > 0 && <div className="mt-0.5 text-[11px] text-warning">{b.unreconciled} statement {b.unreconciled === 1 ? 'line' : 'lines'} not yet matched</div>}
                      </td>
                      <td className="px-4 py-2.5 text-right align-top">{b.statementBalance === null ? '—' : <>{money(b.statementBalance, b.currency)}<div className="text-[11px] text-text-muted">to {b.statementDate ? formatDate(b.statementDate) : '?'}</div></>}</td>
                      <td className="px-4 py-2.5 text-right align-top">{b.booksAtPeriodEnd === null ? '—' : money(b.booksAtPeriodEnd, b.currency)}</td>
                      <td className={cn('px-4 py-2.5 text-right align-top font-medium', b.difference === null ? 'text-text-muted' : b.difference === 0 ? 'text-success' : 'text-warning')}>{b.difference === null ? '—' : money(b.difference, b.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section n={3} title="Customers and suppliers agree with the ledger">
          {ar.isLoading || ap.isLoading || tb.isLoading || settings.isLoading ? (
            <LoadingLine what="receivables and payables" />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2" data-testid="pack-ties">
              <TieCard title="Money customers owe" agingError={ar.error} tbError={tb.error} controlSet={Boolean(posting?.ar_control)} tie={arTie} what="the aged receivables" money={money} subLabel="Customer balances (aging)" onRetry={() => void ar.refetch()} />
              <TieCard title="Money you owe suppliers" agingError={ap.error} tbError={tb.error} controlSet={Boolean(posting?.ap_control)} tie={apTie} what="the aged payables" money={money} subLabel="Supplier balances (aging)" onRetry={() => void ap.refetch()} />
            </div>
          )}
        </Section>

        <Section n={4} title="Debits equal credits">
          {tb.isLoading ? (
            <LoadingLine what="the trial balance" />
          ) : tb.error || !tb.data ? (
            <Unavailable error={tb.error} what="the trial balance" onRetry={() => void tb.refetch()} />
          ) : (
            <div className="grid gap-4 rounded-lg border border-border bg-surface-neutral/40 p-4 sm:grid-cols-3" data-testid="pack-balance">
              <div>
                <div className="text-xs text-text-muted">Total debits</div>
                <div className="mt-1 text-base font-medium tabular-nums text-text-primary">{money(tb.data.totalDebit)}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Total credits</div>
                <div className="mt-1 text-base font-medium tabular-nums text-text-primary">{money(tb.data.totalCredit)}</div>
              </div>
              <div>
                <div className="text-xs text-text-muted">Difference</div>
                <div className={cn('mt-1 text-base font-medium tabular-nums', tb.data.balanced ? 'text-success' : 'text-danger')}>{money(tb.data.totalDebit - tb.data.totalCredit)}</div>
              </div>
              <p className="text-[11px] text-text-muted sm:col-span-3">Trial balance as of {formatDate(tb.data.asOf)}, every posted journal up to that day.</p>
            </div>
          )}
        </Section>

        <Section n={5} title="Sign-off">
          <div className="grid gap-4 sm:grid-cols-2">
            {['Prepared by', 'Reviewed by'].map((role) => (
              <div key={role} className="rounded-lg border border-border p-4">
                <div className="text-xs text-text-muted">{role}</div>
                <div className="mt-8 border-t border-border-strong pt-1 text-[11px] text-text-muted">Name, signature and date</div>
              </div>
            ))}
          </div>
        </Section>
      </article>
    </div>
  );
};

const TieCard: React.FC<{
  title: string;
  subLabel: string;
  what: string;
  agingError: unknown;
  tbError: unknown;
  controlSet: boolean;
  tie: Tie | null;
  money: (n: number) => string;
  onRetry: () => void;
}> = ({ title, subLabel, what, agingError, tbError, controlSet, tie, money, onRetry }) => {
  const error = agingError ?? tbError;
  return (
    <div className="rounded-lg border border-border p-4">
      <div className="text-xs text-text-muted">{title}</div>
      {error ? (
        <div className="mt-2"><Unavailable error={error} what={what} onRetry={onRetry} /></div>
      ) : !controlSet ? (
        <p className="mt-2 text-[13px] text-text-secondary">No control account is chosen for this under Settings, Posting accounts, so the ledger cannot be compared.</p>
      ) : !tie ? (
        <p className="mt-2 text-[13px] text-text-muted">These figures are not in the same currency, so they are not compared.</p>
      ) : (
        <>
          <div className="mt-1 text-[22px] font-medium leading-7 tabular-nums text-text-primary">{money(tie.ledger)}</div>
          <div className="text-[11px] text-text-muted">In the ledger (control account)</div>
          <div className="mt-2 text-[13px] tabular-nums text-text-secondary">{subLabel}: {money(tie.subledger)}</div>
          {tie.agrees ? (
            <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-success"><CheckCircle2 className="size-3.5" /> The two agree</div>
          ) : (
            <div className="mt-2 flex items-start gap-1.5 text-xs font-medium text-danger"><XCircle className="mt-0.5 size-3.5 shrink-0" /> They differ by {money(tie.difference)}. A revaluation or a manual entry on the control account can cause this.</div>
          )}
        </>
      )}
    </div>
  );
};
