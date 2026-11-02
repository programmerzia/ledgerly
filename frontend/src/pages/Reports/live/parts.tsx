import React from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import type { DrillKey, Figure } from '@/api/adapters/report';
import { useDrill } from '@/data/reports';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useRouteCompany } from '@/data/session';
import { tone } from '../ReportParts';

export const fmt = (currency: string) => (n: number) => formatMoney(n, currency, { parenthesesNegative: true });
export const dash = <span className="text-text-muted">—</span>;

/** The message a report screen shows when the request fails. A 403 is "not for your role", not a fault. */
export function reportErrorText(e: unknown, what = 'this report'): string {
  if (e instanceof ApiError && e.status === 403) return `Your role in this company does not include ${what}. Ask an owner or administrator if you need it.`;
  if (e instanceof ApiError && e.status === 422) {
    const first = e.errors ? Object.values(e.errors)[0]?.[0] : undefined;
    return first ?? e.detail ?? describeError(e);
  }
  return describeError(e);
}

export const ReportError: React.FC<{ error: unknown; onRetry?: () => void; what?: string }> = ({ error, onRetry, what }) => {
  const forbidden = error instanceof ApiError && error.status === 403;
  return (
    <div className="bg-surface border border-border rounded-lg p-6 text-[13px]" role="alert">
      <p className={forbidden ? 'text-text-primary' : 'text-danger'}>{reportErrorText(error, what)}</p>
      {onRetry && !forbidden && (
        <button type="button" onClick={onRetry} className="mt-2 cursor-pointer text-accent hover:underline">
          Try again
        </button>
      )}
    </div>
  );
};

export const ReportLoading: React.FC<{ what: string }> = ({ what }) => (
  <p className="p-4 text-[13px] text-text-muted" role="status">
    Loading {what}…
  </p>
);

/** "As of 3 Nov 2026, 09:12" for the server's generated_at (ISO, UTC). Cached results show when they were made. */
export function generatedLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `Calculated ${d.toLocaleString('en-US', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
}

/** A figure that opens the lines behind it. Without a drill key it is plain text. */
export const Drillable: React.FC<{ drill?: DrillKey; onDrill: (k: DrillKey) => void; children: React.ReactNode; className?: string; label?: string }> = ({
  drill, onDrill, children, className, label,
}) =>
  drill ? (
    <button
      type="button"
      onClick={() => onDrill(drill)}
      title={label ?? 'Show the transactions behind this figure'}
      className={cn('cursor-pointer tabular-nums hover:text-accent hover:underline focus-visible:outline-2 outline-accent rounded-[2px]', className)}
    >
      {children}
    </button>
  ) : (
    <span className={cn('tabular-nums', className)}>{children}</span>
  );

/** The comparison, variance and percentage the server sent for a figure. */
export const VarianceCells: React.FC<{ fig: Figure; money: (n: number) => string; muted?: boolean }> = ({ fig, money, muted }) => (
  <>
    <span className={cn('text-right tabular-nums', muted ? 'text-text-muted' : 'text-text-secondary')}>{fig.comparison === undefined ? '' : money(fig.comparison)}</span>
    <span className={cn('text-right tabular-nums', fig.variance === undefined ? '' : tone(fig.variance))}>{fig.variance === undefined ? '' : money(fig.variance)}</span>
    <span className="text-right tabular-nums text-text-muted">{fig.variancePct == null ? (fig.variance === undefined ? '' : '—') : `${fig.variancePct}%`}</span>
  </>
);

/** An amount and, when the run compared, the server's comparison, change and percentage. */
export const FigureCells: React.FC<{ fig: Figure; money: (n: number) => string; compare: boolean; bold?: boolean; node?: React.ReactNode }> = ({ fig, money, compare, bold, node }) => (
  <>
    <span className={cn('text-right tabular-nums', bold && 'font-semibold', tone(fig.amount))}>{node ?? money(fig.amount)}</span>
    {compare && <VarianceCells fig={fig} money={money} />}
  </>
);

export const NoComparisonNote: React.FC<{ available: boolean | undefined }> = ({ available }) =>
  available === false ? (
    <p className="text-xs text-text-muted" role="status">
      There is no earlier period to compare with, so only this period is shown.
    </p>
  ) : null;

// ---------------------------------------------------------------------------------------------------------------
// Drill-down: the journal lines behind one figure
// ---------------------------------------------------------------------------------------------------------------

export interface DrillTarget {
  key: DrillKey;
  /** What was clicked, for the title ("Accounts receivable"). */
  title: string;
}

export const DrillDialog: React.FC<{ target: DrillTarget | null; onClose: () => void }> = ({ target, onClose }) => {
  const company = useRouteCompany();
  const q = useDrill(target?.key ?? null);
  const first = q.data?.pages[0];
  const money = fmt(company.base_currency);
  const lines = q.data?.pages.flatMap((p) => p.data) ?? [];
  const key = target?.key;
  const ledgerLink =
    key && !key.exclude_closing && !key.contact_side && !key.contact_id
      ? `/${company.slug}/reports/general-ledger?${new URLSearchParams({
          account: key.account_id,
          ...(key.from ? { from: key.from } : {}),
          to: key.to,
          ...Object.fromEntries(Object.entries(key.dimensions ?? {}).filter(([, v]) => v[0]).map(([id, v]) => [`d.${id}`, v[0]])),
        }).toString()}`
      : null;

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{target?.title ?? 'Transactions'}</DialogTitle>
          <DialogDescription>
            {first ? `${first.summary.account.code} ${first.summary.account.name}` : ''}
            {key ? ` · ${key.from ? `${key.from} to ` : 'up to '}${key.to}` : ''}
            {key?.exclude_closing ? ' · year-end closing entries left out' : ''}
            {key?.contact_side ? ` · ${key.contact_side === 'credit' ? 'contacts in credit' : 'contacts in debit'}` : ''}
          </DialogDescription>
        </DialogHeader>
        {q.isPending && <ReportLoading what="transactions" />}
        {q.isError && <ReportError error={q.error} onRetry={() => void q.refetch()} what="these transactions" />}
        {first && (
          <>
            <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs" data-testid="drill-summary">
              <div><dt className="inline text-text-muted">Debits </dt><dd className="inline tabular-nums text-text-primary">{money(first.summary.debit)}</dd></div>
              <div><dt className="inline text-text-muted">Credits </dt><dd className="inline tabular-nums text-text-primary">{money(first.summary.credit)}</dd></div>
              <div><dt className="inline text-text-muted">Net </dt><dd className="inline tabular-nums text-text-primary">{money(first.summary.net)}</dd></div>
              <div><dt className="inline text-text-muted">Lines </dt><dd className="inline tabular-nums text-text-primary">{first.summary.lineCount}</dd></div>
            </dl>
            <div className="max-h-[50vh] overflow-auto border border-border rounded-md">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-surface text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  <tr className="border-b border-border">
                    <th className="px-3 py-2 text-left">Date</th>
                    <th className="px-3 py-2 text-left">Journal</th>
                    <th className="px-3 py-2 text-left">Description</th>
                    <th className="px-3 py-2 text-right">Debit</th>
                    <th className="px-3 py-2 text-right">Credit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {lines.map((l) => (
                    <tr key={l.id}>
                      <td className="px-3 py-1.5 tabular-nums whitespace-nowrap text-text-muted">{l.date}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <Link to={`/${company.slug}/journals/${l.journalId}`} className="text-accent hover:underline">
                          {l.journalNumber ?? 'Draft'}
                        </Link>
                      </td>
                      <td className="px-3 py-1.5 text-text-primary">{l.description ?? l.memo ?? dash}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.debit ? money(l.debit) : dash}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{l.credit ? money(l.credit) : dash}</td>
                    </tr>
                  ))}
                  {lines.length === 0 && (
                    <tr><td colSpan={5} className="px-3 py-6 text-center text-text-muted">No transactions.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between text-xs">
              {q.hasNextPage ? (
                <button type="button" onClick={() => void q.fetchNextPage()} disabled={q.isFetchingNextPage} className="cursor-pointer text-accent hover:underline disabled:opacity-60">
                  {q.isFetchingNextPage ? 'Loading…' : 'Load more'}
                </button>
              ) : <span className="text-text-muted">{lines.length} of {first.summary.lineCount} lines</span>}
              {ledgerLink && (
                <Link to={ledgerLink} onClick={onClose} className="text-accent hover:underline">
                  Open in the general ledger
                </Link>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};
