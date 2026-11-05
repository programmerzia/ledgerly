/** Bank reconciliation report (3c.20): the proof of one finished reconciliation, to print, export or hand to an auditor. */
import React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import { fetchBankReconciliationReport, type BankReconciliationReportData, type Money } from '@/api/live/listings';
import { PageHeader } from '@/components/domain/PageHeader';
import { useRouteCompany } from '@/data/session';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { ReportCard } from '../ReportParts';
import { ExportMenu } from './ExportMenu';
import { ReportError, ReportLoading, fmt } from './parts';

const Row: React.FC<{ label: React.ReactNode; amount?: Money | null; money: (n: number) => string; bold?: boolean; note?: string; testId?: string }> = ({ label, amount, money, bold, note, testId }) => (
  <div className={cn('grid grid-cols-[1fr_9rem] items-baseline gap-3 px-2 py-1.5 text-xs', bold && 'border-t border-border text-[13px] font-semibold')} data-testid={testId}>
    <span className="text-text-primary">{label}{note && <span className="ml-2 text-text-muted">{note}</span>}</span>
    <span className="text-right tabular-nums">{amount ? money(amount.amount) : ''}</span>
  </div>
);

const Check: React.FC<{ ok: boolean | null; children: React.ReactNode }> = ({ ok, children }) => (
  <li className="flex items-center gap-2 text-xs text-text-primary">
    {ok === null ? <span className="size-4 text-center text-text-muted">–</span> : ok ? <CheckCircle2 className="size-4 text-success" aria-label="yes" /> : <XCircle className="size-4 text-danger" aria-label="no" />}
    <span>{children}{ok === null && <span className="ml-2 text-text-muted">(nothing to compare with)</span>}</span>
  </li>
);

const Heading: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="px-2 pb-1 pt-5 text-[13px] font-semibold text-text-primary">{children}</div>;

export const LiveBankReconciliationReport: React.FC = () => {
  const company = useRouteCompany();
  const [sp] = useSearchParams();
  const id = sp.get('rec') ?? '';
  const q = useQuery({
    queryKey: ['reports', company.id, 'bank-reconciliation', id],
    queryFn: ({ signal }) => fetchBankReconciliationReport(company.id, id, signal),
    enabled: id !== '',
    retry: false,
    refetchOnWindowFocus: false,
  });
  const r: BankReconciliationReportData | undefined = q.data;
  const money = fmt(r?.currency ?? company.base_currency);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Bank reconciliation"
        subtitle={r ? `${company.name} · ${r.bank_account.name} · statement ${formatDate(r.statement.period_from)} to ${formatDate(r.statement.period_to)}` : company.name}
        actions={r && <Link to={`/${company.slug}/banking/${r.statement.id}/reconcile`} className="flex items-center gap-1 text-[13px] text-accent hover:underline print:hidden"><ArrowLeft className="size-3.5" />Back to the reconciliation</Link>}
      />
      {id === '' ? <p className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">Open this report from a finished reconciliation.</p>
        : q.isPending ? <ReportLoading what="the reconciliation report" />
        : q.isError || !r ? <ReportError error={q.error} onRetry={() => void q.refetch()} what="bank reconciliations" />
        : (
          <>
            <div className="flex print:hidden"><ExportMenu report="bank-reconciliation" query={{ reconciliation_id: id }} /></div>
            <ReportCard>
              <div className="min-w-[520px]" data-testid="bank-rec-report">
                <p className="px-2 text-xs text-text-secondary">
                  Finished {formatDate(r.reconciliation.finished_at.slice(0, 10))} by {r.reconciliation.finished_by?.name ?? 'unknown'}. The figures are the ones frozen when it was finished.
                  {r.reconciliation.reopen_count > 0 && ` Reopened ${r.reconciliation.reopen_count} time${r.reconciliation.reopen_count === 1 ? '' : 's'} before.`}
                </p>

                <Heading>Statement</Heading>
                <Row label="Opening balance" amount={r.statement.opening_balance} money={money} note={r.statement.opening_balance ? undefined : 'not stated'} />
                <Row label="Receipts" amount={r.statement.receipts} money={money} />
                <Row label="Payments" amount={r.statement.payments} money={money} />
                <Row label="Closing balance" amount={r.statement.closing_balance} money={money} bold />

                <Heading>Statement against books</Heading>
                {r.steps.map((s) => (
                  <Row key={s.key} label={s.label} amount={s.amount} money={money} bold={s.key === 'adjusted_book_balance' || s.key === 'difference'} testId={`step-${s.key}`}
                    note={s.of_which_excluded && s.of_which_excluded.amount !== 0 ? `includes ${money(s.of_which_excluded.amount)} of excluded lines` : undefined} />
                ))}

                <Heading>Proof</Heading>
                <ul className="flex flex-col gap-1.5 px-2" data-testid="bank-rec-checks">
                  <Check ok={r.checks.statement_foots}>Opening balance plus receipts and payments equals the closing balance</Check>
                  <Check ok={r.checks.steps_add_up}>The steps above add up to the adjusted book balance</Check>
                  <Check ok={r.checks.difference_is_zero}>The difference is zero</Check>
                  <Check ok={r.checks.opening_continuity.agrees}>
                    The opening balance equals the closing balance of the previous statement
                    {r.checks.opening_continuity.previous_closing_balance && ` (${money(r.checks.opening_continuity.previous_closing_balance.amount)} on ${formatDate(r.checks.opening_continuity.previous_as_of)})`}
                  </Check>
                </ul>
                <p className="mt-2 px-2 text-xs text-text-muted">{r.matched.count} match{r.matched.count === 1 ? '' : 'es'} cover {money(r.matched.total.amount)} on each side. The books held {money(r.book.balance.amount)} at the statement date.</p>

                {([['Book items not on the statement', r.unmatched_book_items], ['Statement items not in the books', r.unmatched_statement_items]] as const).map(([title, block]) => (
                  <div key={title}>
                    <Heading>{title} ({block.count})</Heading>
                    {block.items.length === 0 && <p className="px-2 text-xs text-text-muted">None.</p>}
                    {block.items.map((i) => (
                      <Row key={'journal_line_id' in i ? i.journal_line_id : i.statement_line_id} money={money} amount={i.amount}
                        label={<>{formatDate(i.date)}{'number' in i && i.number ? ` · ${i.number}` : ''} · {i.description || 'no description'}</>} />
                    ))}
                    {block.truncated && <p className="px-2 text-xs text-text-muted">The first {block.items.length} are listed; the total covers all {block.count}.</p>}
                    <Row label="Total" amount={block.total} money={money} bold />
                  </div>
                ))}

                <Heading>Excluded statement lines ({r.excluded_lines.count})</Heading>
                {r.excluded_lines.items.length === 0 && <p className="px-2 text-xs text-text-muted">None.</p>}
                {r.excluded_lines.items.map((i) => (
                  <Row key={i.id} money={money} amount={i.amount} label={<>{formatDate(i.date)} · {i.description}<span className="ml-2 text-text-muted">{i.reason ?? 'no reason given'}{i.excluded_by ? ` · ${i.excluded_by}` : ''}</span></>} />
                ))}
                {!r.excluded_lines.list_agrees && <p className="px-2 text-xs text-danger">The list of excluded lines no longer agrees with the count frozen at finish.</p>}
                <Row label="Total excluded" amount={r.excluded_lines.total} money={money} bold />
              </div>
            </ReportCard>
          </>
        )}
    </div>
  );
};
