/** Journal list report (3c.20): every journal of the company by period or dates, status, source and person, lines on request. */
import React, { useMemo, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { cursorPaging } from '@/api/cursor';
import { fetchJournalList, type JournalListRow } from '@/api/live/listings';
import { PageHeader } from '@/components/domain/PageHeader';
import { useRouteCompany } from '@/data/session';
import { formatDate } from '@/lib/format';
import { ReportCard, CheckToggle, SelectBox } from '../ReportParts';
import { ExportMenu } from './ExportMenu';
import { ReportError, ReportLoading, fmt } from './parts';
import { Link } from 'react-router-dom';
import { useReportPeriods } from '@/data/reports';

const STATUSES = ['draft', 'pending_approval', 'posted', 'reversed', 'void'];
const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  posted: 'Posted',
  reversed: 'Reversed',
  void: 'Void',
};
const SOURCE_LABEL: Record<string, string> = {
  sales_invoice: 'Invoice',
  credit_note: 'Credit note',
  purchase_bill: 'Bill',
  debit_note: 'Debit note',
  settlement: 'Settlement',
  asset_revaluation: 'Asset revaluation',
  opening_balance: 'Opening balance',
  manual: 'Typed by hand',
  none: 'Typed by hand',
};
const input = 'h-8 px-2 rounded-md border border-border bg-surface text-xs text-text-primary hover:border-border-strong focus:outline-none focus:border-accent';
const words = (s: string) => s.replace(/_/g, ' ');
const statusLabel = (s: string) => STATUS_LABEL[s] ?? words(s);
const sourceLabel = (s: string) => SOURCE_LABEL[s] ?? words(s);

export const LiveJournalList: React.FC = () => {
  const company = useRouteCompany();
  const { periods } = useReportPeriods();
  const [f, setF] = useState({ period: '', from: '', to: '', status: '', source: '', user: '', role: 'created', lines: false });
  const money = fmt(company.base_currency);

  const query = useMemo(() => {
    const q: Record<string, string> = {};
    if (f.period) q.period_id = f.period;
    else {
      if (f.from) q.from = f.from;
      if (f.to) q.to = f.to;
    }
    if (f.status) q.status = f.status;
    if (f.source) q.source = f.source;
    if (f.user) {
      q.user_id = f.user;
      q.user_role = f.role;
    }
    if (f.lines) q.include_lines = 'true';
    return q;
  }, [f]);

  const list = useInfiniteQuery({
    queryKey: ['reports', company.id, 'journal-list', query],
    queryFn: ({ pageParam, signal }) => fetchJournalList(company.id, query, pageParam, signal),
    ...cursorPaging,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const rows: JournalListRow[] = list.data?.pages.flatMap((p) => p.data) ?? [];
  const choices = list.data?.pages[0]?.choices;
  const set = (patch: Partial<typeof f>) => setF({ ...f, ...patch });
  const ordered = [...periods].filter((p) => p.kind !== 'adjustment').sort((a, b) => b.starts_on.localeCompare(a.starts_on));
  const totalDebit = rows.reduce((s, r) => s + r.debit.amount, 0);
  const totalCredit = rows.reduce((s, r) => s + r.credit.amount, 0);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Journal list" subtitle={`${company.name} · every journal, with its source document and who made it`} />
      <div className="flex flex-wrap items-center gap-3 print:hidden" data-testid="report-params">
        <SelectBox aria-label="Period" value={f.period} onChange={(e) => set({ period: e.target.value })}>
          <option value="">Date range</option>
          {ordered.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectBox>
        {!f.period && (
          <span className="flex items-center gap-1.5 text-xs text-text-muted">
            <input type="date" aria-label="From" className={input} value={f.from} max={f.to || undefined} onChange={(e) => set({ from: e.target.value })} />
            to
            <input type="date" aria-label="To" className={input} value={f.to} min={f.from || undefined} onChange={(e) => set({ to: e.target.value })} />
          </span>
        )}
        <SelectBox aria-label="Status" value={f.status} onChange={(e) => set({ status: e.target.value })}>
          <option value="">Any status</option>
          {STATUSES.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </SelectBox>
        <SelectBox aria-label="Source" value={f.source} onChange={(e) => set({ source: e.target.value })}>
          <option value="">Any source</option>
          <option value="none">Typed by hand</option>
          {(choices?.sources ?? []).map((s) => <option key={s} value={s}>{sourceLabel(s)}</option>)}
        </SelectBox>
        <SelectBox aria-label="Person" value={f.user} onChange={(e) => set({ user: e.target.value })}>
          <option value="">Anyone</option>
          {(choices?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </SelectBox>
        {f.user && (
          <SelectBox aria-label="Person's part" value={f.role} onChange={(e) => set({ role: e.target.value })}>
            <option value="created">who made it</option>
            <option value="submitted">who submitted it</option>
            <option value="approved">who approved it</option>
            <option value="posted">who posted it</option>
          </SelectBox>
        )}
        <CheckToggle checked={f.lines} onChange={(v) => set({ lines: v })}>Show lines</CheckToggle>
        <ExportMenu report="journal-list" query={query} />
      </div>

      {list.isPending ? <ReportLoading what="the journals" /> : list.isError ? <ReportError error={list.error} onRetry={() => void list.refetch()} what="the journal list" /> : (
        <ReportCard>
          <div className="min-w-[760px]" data-testid="journal-list">
            <div className="grid grid-cols-[7rem_6rem_1fr_7rem_8rem_8rem] gap-3 border-b border-border px-2 pb-2 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
              <span>Number</span><span>Date</span><span>Reference and memo</span><span>Status</span><span className="text-right">Debit</span><span className="text-right">Credit</span>
            </div>
            {rows.length === 0 && <p className="p-8 text-center text-xs text-text-muted">No journals match these filters.</p>}
            <div className="divide-y divide-border/60">
              {rows.map((j) => (
                <div key={j.id}>
                  <div className="grid grid-cols-[7rem_6rem_1fr_7rem_8rem_8rem] items-baseline gap-3 px-2 py-1.5 text-xs">
                    <Link to={`/${company.slug}/journals/${j.id}`} className="font-code text-accent hover:underline">{j.number ?? 'Draft'}</Link>
                    <span className="text-text-secondary">{formatDate(j.date)}</span>
                    <span className="text-text-primary">
                      {[j.reference, j.memo].filter(Boolean).join(' · ') || <span className="text-text-muted">no reference</span>}
                      <span className="ml-2 text-text-muted">{j.source ? sourceLabel(j.source.type) : 'typed by hand'}{j.created_by?.name ? ` · ${j.created_by.name}` : ''}{j.posted_by?.name ? ` · posted by ${j.posted_by.name}` : ''}</span>
                    </span>
                    <span className="text-text-secondary">{statusLabel(j.status)}</span>
                    <span className="text-right tabular-nums">{money(j.debit.amount)}</span>
                    <span className="text-right tabular-nums">{money(j.credit.amount)}</span>
                  </div>
                  {j.lines && j.lines.length > 0 && (
                    <div className="bg-surface-neutral/40 px-2 py-1">
                      {j.lines.map((l) => (
                        <div key={l.id} className="grid grid-cols-[7rem_6rem_1fr_7rem_8rem_8rem] items-baseline gap-3 py-1 text-xs text-text-secondary">
                          <span /><span />
                          <span><span className="font-code text-text-muted mr-2">{l.account.code}</span>{l.account.name}{l.description ? ` · ${l.description}` : ''}{l.contact ? ` · ${l.contact.name}` : ''}</span>
                          <span />
                          <span className="text-right tabular-nums">{l.debit.amount ? money(l.debit.amount) : ''}</span>
                          <span className="text-right tabular-nums">{l.credit.amount ? money(l.credit.amount) : ''}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="mt-2 grid grid-cols-[7rem_6rem_1fr_7rem_8rem_8rem] items-baseline gap-3 border-t border-text-primary px-2 py-3 text-sm font-semibold" data-testid="journal-list-totals">
              <span className="col-span-4 text-text-primary">{rows.length} journal{rows.length === 1 ? '' : 's'}{list.hasNextPage ? ' so far' : ''}</span>
              <span className="text-right tabular-nums">{money(totalDebit)}</span>
              <span className="text-right tabular-nums">{money(totalCredit)}</span>
            </div>
          </div>
          {list.hasNextPage && (
            <div className="px-2 pt-3 print:hidden">
              <button type="button" className="h-8 cursor-pointer rounded-md border border-border bg-surface px-3 text-[13px] hover:bg-surface-neutral" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
                {list.isFetchingNextPage ? 'Loading…' : 'Show more'}
              </button>
            </div>
          )}
        </ReportCard>
      )}
    </div>
  );
};
