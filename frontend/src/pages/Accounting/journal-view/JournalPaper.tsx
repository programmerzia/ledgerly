import React from 'react';
import type { Journal, Account, Company } from '@/types';
import { formatMoney, formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

interface Props {
  journal: Journal;
  accounts: Account[];
  company: Company;
  /** Live mode passes the real period (or `null` before one is set); the demo omits it and shows its fixed month. */
  periodName?: string | null;
}

/** The journal rendered as a printable paper sheet with Dr/Cr lines and totals. */
export const JournalPaper: React.FC<Props> = ({ journal, accounts, company, periodName }) => {
  const reversed = journal.status === 'reversed';
  const balanced = journal.total_debit === journal.total_credit;
  const cur = company.base_currency;

  return (
    <article
      aria-label={`Journal ${journal.number ?? 'draft'}`}
      className="relative overflow-hidden rounded-lg border border-border bg-surface px-6 py-8 sm:px-12 sm:py-12"
    >
      {reversed && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute left-12 top-80 -rotate-[14deg] select-none rounded-[3px] border-[3px] border-violet px-5 py-1 text-4xl font-semibold tracking-[0.2em] text-violet opacity-[0.14]"
        >
          REVERSED
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-center gap-3">
          <div className="leading-tight">
            <div className="text-sm font-semibold text-text-primary">{company.name}</div>
            <div className="text-xs text-text-muted">{company.legal_name}</div>
          </div>
        </div>
        <div className="text-right">
          <h2 className="text-xl font-semibold text-text-primary">Journal entry</h2>
          <div className="mt-1 text-sm font-medium tabular-nums text-text-secondary">{journal.number ?? 'Draft'}</div>
        </div>
      </div>

      <dl className="mt-10 grid gap-x-8 gap-y-4 sm:grid-cols-3">
        <div>
          <dt className="text-[11px] font-semibold text-text-muted">Date</dt>
          <dd className="mt-1 text-[13px] text-text-primary">{formatDate(journal.journal_date)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold text-text-muted">Reference</dt>
          <dd className="mt-1 text-[13px] text-text-primary">{journal.reference || 'None'}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold text-text-muted">Period</dt>
          <dd className="mt-1 text-[13px] text-text-primary">{periodName === undefined ? 'Oct 2026' : (periodName ?? 'Set when posted')}</dd>
        </div>
      </dl>

      <div className="mt-6">
        <div className="text-[11px] font-semibold text-text-muted">What this is for</div>
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
                        <span className="rounded-[3px] bg-surface-neutral px-1.5 text-[11px] font-medium text-text-secondary">{l.dimensions.branch}</span>
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
            <tr className="border-t border-text-primary text-sm font-semibold text-text-primary">
              <td colSpan={3} className="pt-3 text-right pr-4">
                <span className={cn('inline-flex items-center gap-1 text-xs font-medium', balanced ? 'text-success' : 'text-danger')}>
                  {balanced ? 'Debits equal credits' : 'Out of balance'}
                </span>
              </td>
              <td className="pt-3 pb-1 text-right tabular-nums border-b-[3px] border-double border-text-primary">{formatMoney(journal.total_debit, cur)}</td>
              <td className="pt-3 pb-1 text-right tabular-nums border-b-[3px] border-double border-text-primary">{formatMoney(journal.total_credit, cur)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </article>
  );
};
