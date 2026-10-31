import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerStore } from '@/mock/store';
import { formatMoney, formatDate } from '@/lib/format';
import { Printer, CheckCircle2, XCircle, ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { cn } from '@/lib/utils';
import { amountDue } from '@/lib/docStatus';

const Section: React.FC<{ n: number; title: string; children: React.ReactNode }> = ({ n, title, children }) => (
  <section className="flex flex-col gap-3 break-inside-avoid">
    <h3 className="flex items-center gap-2 border-b border-border pb-2 text-sm font-semibold text-text-primary">
      <span className="text-text-muted tabular-nums">{n}.</span>
      {title}
    </h3>
    {children}
  </section>
);

export const ClosePack: React.FC = () => {
  const navigate = useNavigate();
  const { currentCompany, fiscalYear, accounts, bankAccounts, journals, closeChecks, balanceOf, invoices, bills } = useLedgerStore();
  const openTotal = (docs: (Parameters<typeof amountDue>[0] & { status: string })[]) =>
    docs.filter((d) => d.status === 'posted').reduce((t, d) => t + amountDue(d), 0);
  const coSlug = currentCompany.slug;
  const cur = currentCompany.base_currency;
  const period = fiscalYear.periods[9]; // Oct 2026

  const byCode = (code: string) => accounts.find((a) => a.code === code);
  const ar = byCode('1200');
  const ap = byCode('2000');
  const arBal = ar ? balanceOf(ar.id) : 0;
  const apBal = ap ? Math.abs(balanceOf(ap.id)) : 0;

  const posted = journals.filter((j) => j.status === 'posted' || j.status === 'reversed');
  const totalDr = posted.reduce((s, j) => s + j.total_debit, 0);
  const totalCr = posted.reduce((s, j) => s + j.total_credit, 0);
  const allPass = closeChecks.every((c) => c.status === 'pass');

  const money = (n: number) => formatMoney(n, cur);

  return (
    <div className="flex flex-col gap-6 print:gap-4">
      <div className="print:hidden">
        <PageHeader
          breadcrumb={[{ label: 'Periods and close', to: `/${coSlug}/periods` }, { label: 'Close pack' }]}
          title="Month-end close pack"
          subtitle={`${period.name}: proof that the books are complete and balanced`}
          actions={
            <>
              <button
                type="button"
                onClick={() => navigate(`/${coSlug}/periods`)}
                className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-secondary transition hover:bg-surface-neutral"
              >
                <ArrowLeft className="size-4" /> Back
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover"
              >
                <Printer className="size-4" /> Print or save PDF
              </button>
            </>
          }
        />
      </div>

      <article className="mx-auto flex w-full max-w-4xl flex-col gap-8 rounded-lg border border-border bg-surface px-6 py-8 sm:px-12 sm:py-10 print:max-w-none print:border-0 print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-6">
          <div className="flex items-center gap-3">
            <div>
              <h2 className="text-xl font-semibold text-text-primary">Month-end close pack</h2>
              <p className="mt-0.5 text-[13px] text-text-muted">
                {currentCompany.legal_name} · Tax ID {currentCompany.tax_id} · {cur}
              </p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold text-text-primary">{period.name}</div>
            <div className="text-xs text-text-muted">
              {formatDate(period.starts_on)} to {formatDate(period.ends_on)}
            </div>
            <div
              className={cn(
                'mt-2 inline-flex items-center gap-1.5 rounded-[3px] px-2 py-0.5 text-xs font-medium',
                allPass ? 'bg-success-soft text-success' : 'bg-warning-soft text-warning'
              )}
            >
              {allPass ? 'All checks passed' : 'Some checks still open'}
            </div>
          </div>
        </header>

        <Section n={1} title="Checks before closing">
          <ul className="divide-y divide-border rounded-lg border border-border">
            {closeChecks.map((chk) => {
              const ok = chk.status === 'pass';
              return (
                <li key={chk.id} className="flex items-center justify-between gap-4 px-4 py-3 text-[13px]">
                  <span className="flex items-center gap-2.5 font-medium text-text-primary">
                    {ok ? <CheckCircle2 className="size-4 text-success" /> : <XCircle className="size-4 text-danger" />}
                    {chk.title}
                  </span>
                  <span className="text-xs text-text-muted">{chk.detail}</span>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section n={2} title="Bank accounts agree with the bank">
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-left text-[13px] tabular-nums">
              <thead>
                <tr className="border-b border-border bg-surface-neutral/60 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-2.5">Account</th>
                  <th className="px-4 py-2.5 text-right">Bank statement</th>
                  <th className="px-4 py-2.5 text-right">Your books</th>
                  <th className="px-4 py-2.5 text-right">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {bankAccounts.map((b) => {
                  const book = balanceOf(b.account_id);
                  const diff = b.last_statement_balance - book;
                  return (
                    <tr key={b.id}>
                      <td className="px-4 py-2.5 font-medium text-text-primary">{b.name}</td>
                      <td className="px-4 py-2.5 text-right">{formatMoney(b.last_statement_balance, b.currency)}</td>
                      <td className="px-4 py-2.5 text-right">{formatMoney(book, b.currency)}</td>
                      <td className={cn('px-4 py-2.5 text-right font-medium', diff === 0 ? 'text-success' : 'text-warning')}>
                        {formatMoney(diff, b.currency)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <Section n={3} title="Customers and suppliers agree with the ledger">
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { label: 'Money customers owe (1200)', value: arBal, docs: openTotal(invoices), docsLabel: 'open invoices' },
              { label: 'Money you owe suppliers (2000)', value: apBal, docs: openTotal(bills), docsLabel: 'open bills' },
            ].map((c) => (
              <div key={c.label} className="rounded-lg border border-border p-4">
                <div className="text-xs text-text-muted">{c.label}</div>
                <div className="mt-1 text-[22px] leading-7 font-medium tabular-nums text-text-primary">{money(c.value)}</div>
                {c.docs === c.value ? (
                  <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-success">
                    <CheckCircle2 className="size-3.5" /> Matches the {c.docsLabel} ({money(c.docs)})
                  </div>
                ) : (
                  <div className="mt-2 flex items-center gap-1.5 text-xs font-medium text-danger">
                    <XCircle className="size-3.5" /> {c.docsLabel} total {money(c.docs)} · difference {money(c.value - c.docs)}
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>

        <Section n={4} title="Debits equal credits">
          <div className="grid gap-4 rounded-lg border border-border bg-surface-neutral/40 p-4 sm:grid-cols-3">
            <div>
              <div className="text-xs text-text-muted">Total debits</div>
              <div className="mt-1 text-base font-medium tabular-nums text-text-primary">{money(totalDr)}</div>
            </div>
            <div>
              <div className="text-xs text-text-muted">Total credits</div>
              <div className="mt-1 text-base font-medium tabular-nums text-text-primary">{money(totalCr)}</div>
            </div>
            <div>
              <div className="text-xs text-text-muted">Difference</div>
              <div className={cn('mt-1 text-base font-medium tabular-nums', totalDr === totalCr ? 'text-success' : 'text-danger')}>
                {money(totalDr - totalCr)}
              </div>
            </div>
          </div>
        </Section>

        <Section n={5} title="Sign-off">
          <div className="grid gap-4 sm:grid-cols-2">
            {[
              { role: 'First approver', name: 'Fatima Hassan', title: 'Head of Finance' },
              { role: 'Second approver', name: 'Kenneth Mwangi', title: 'Chief Financial Officer' },
            ].map((p) => (
              <div key={p.role} className="rounded-lg border border-border p-4">
                <div className="text-xs text-text-muted">{p.role}</div>
                <div className="mt-1 text-sm font-semibold text-text-primary">{p.name}</div>
                <div className="text-xs text-text-muted">{p.title}</div>
                <div className="mt-6 border-t border-border-strong pt-1 text-[11px] text-text-muted">Signature and date</div>
              </div>
            ))}
          </div>
        </Section>
      </article>
    </div>
  );
};
