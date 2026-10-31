import React from 'react';
import type { Journal, Account, Company } from '@/types';
import { formatMoney, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

interface Props {
  journal: Journal;
  accounts: Account[];
  company: Company;
}

/** The journal rendered as a printable paper sheet with Dr/Cr lines and totals. */
export const JournalPaper: React.FC<Props> = ({ journal, accounts, company }) => {
  const reversed = journal.status === 'reversed';
  const balanced = journal.total_debit === journal.total_credit;
  const cur = company.base_currency;

  return (
    <article
      aria-label={`Journal ${journal.number ?? 'draft'}`}
      className="relative overflow-hidden rounded-xl border border-border bg-surface px-6 py-8 shadow-card sm:px-12 sm:py-12"
    >
      {reversed && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-12 top-80 -rotate-[14deg] select-none rounded-lg border-[3px] border-violet px-5 py-1 text-4xl font-bold tracking-[0.2em] text-violet opacity-[0.14]"
        >
          REVERSED
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-brand text-lg font-bold text-white shadow-xs">
            {company.name.charAt(0).toUpperCase()}
          </span>
          <div className="leading-tight">
            <div className="text-[15px] font-semibold text-text-primary">{company.name}</div>
            <div className="text-xs text-text-muted">{company.legal_name}</div>
          </div>
        </div>
        <div className="text-right">
          <h2 className="text-3xl font-semibold tracking-tight text-text-primary">Journal entry</h2>
          <div className="mt-1 text-sm font-medium tabular-nums text-text-secondary">{journal.number ?? 'Draft'}</div>
        </div>
      </div>

      <dl className="mt-10 grid gap-x-8 gap-y-4 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Date</dt>
          <dd className="mt-1 text-[13px] text-text-primary">{formatDate(journal.journal_date)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Reference</dt>
          <dd className="mt-1 text-[13px] text-text-primary">{journal.reference || 'None'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">Period</dt>
          <dd className="mt-1 text-[13px] text-text-primary">Oct 2026</dd>
        </div>
      </dl>

      <div className="mt-6">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">What this is for</div>
        <p className="mt-1 text-sm font-medium text-text-primary">{journal.memo}</p>
      </div>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[560px] border-collapse text-left text-[13px]">
          <thead>
            <tr className="border-b border-border-strong text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              <th className="w-8 pb-2 font-semibold">#</th>
              <th className="pb-2 font-semibold">Account</th>
              <th className="pb-2 font-semibold">Note</th>
              <th className="w-32 pb-2 text-right font-semibold">Debit (Dr)</th>
              <th className="w-32 pb-2 text-right font-semibold">Credit (Cr)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {journal.lines.map((l, idx) => {
              const acc = accounts.find((a) => a.id === l.account_id);
              return (
                <tr key={l.id}>
                  <td className="py-3 text-text-muted tabular-nums">{idx + 1}</td>
                  <td className="py-3">
                    <div className="font-medium text-text-primary">{acc?.name || 'Account'}</div>
                    <div className="flex items-center gap-1.5 text-xs text-text-muted">
                      {acc?.code}
                      {l.dimensions?.branch && (
                        <span className="rounded bg-accent-soft px-1.5 text-[11px] font-medium text-accent">{l.dimensions.branch}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-3 pr-3 text-text-secondary">{l.description}</td>
                  <td className="py-3 text-right font-medium tabular-nums text-text-primary">{l.debit > 0 ? formatMoney(l.debit, cur) : ''}</td>
                  <td className="py-3 text-right font-medium tabular-nums text-text-primary">{l.credit > 0 ? formatMoney(l.credit, cur) : ''}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border-strong text-sm font-semibold text-text-primary">
              <td colSpan={3} className="pt-3 text-right pr-4">
                <span className={cn('inline-flex items-center gap-1 text-xs font-medium', balanced ? 'text-success' : 'text-danger')}>
                  {balanced && <Check className="size-3.5" />}
                  {balanced ? 'Debits equal credits' : 'Out of balance'}
                </span>
              </td>
              <td className="pt-3 text-right tabular-nums">{formatMoney(journal.total_debit, cur)}</td>
              <td className="pt-3 text-right tabular-nums">{formatMoney(journal.total_credit, cur)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </article>
  );
};
