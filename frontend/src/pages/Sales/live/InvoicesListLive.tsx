import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { Kbd } from '@/components/ui/kbd';
import { cn } from '@/lib/utils';
import { formatDate, formatMoney } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useLedgerStore } from '@/mock/store';
import { useDocActions, useDocList, type DocFilters } from '@/data/invoices';
import { useBulkRun, useRowSelection } from '@/data/bulk';
import { BulkBar, BulkDiscardDialog, BulkResultsSheet } from '@/components/live/BulkBar';
import { SignDialog } from '@/components/domain/SignDialog';
import { Checkbox } from '@/components/ui/checkbox';
import { downloadCsv, minorToDecimal } from '@/lib/csv';
import { useContactDirectory } from '@/data/contacts';
import { SIDES, type Side } from './side';
import { BTN_ACCENT, DocStatusPill, numberOf, ErrorLine, LoadMore, LoadingLine, TableCard, inputClass, tradeVerdictText, useDebounced } from './parts';

/** Each tab is a server filter. There are no counts: a count from a partial page would be wrong. */
const tabsFor = (S: (typeof SIDES)[Side]): Array<{ value: string; label: string; filters: DocFilters }> => [
  { value: 'all', label: 'All', filters: {} },
  { value: 'draft', label: 'Drafts', filters: { status: 'draft' } },
  { value: 'pending', label: 'Awaiting approval', filters: { status: 'pending_approval' } },
  { value: 'posted', label: 'Posted', filters: { status: 'posted' } },
  { value: 'overdue', label: 'Overdue', filters: { payment_status: 'overdue' } },
  { value: 'paid', label: 'Paid', filters: { payment_status: 'paid' } },
  { value: 'credit', label: S.Credits, filters: { kind: S.creditKind } },
];

export const InvoicesListLive: React.FC<{ initialTab?: string; side?: Side }> = ({ initialTab = 'all', side = 'sales' }) => {
  const S = SIDES[side];
  const TABS = tabsFor(S);
  const navigate = useNavigate();
  const company = useRouteCompany();
  const openTab = useLedgerStore((s) => s.openTab);
  const coSlug = company.slug;
  const [tab, setTab] = useState(initialTab);
  const [searchText, setSearchText] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const search = useDebounced(searchText.trim(), 300);
  const customers = useContactDirectory(S.contactKind, true);

  const filters: DocFilters = { ...(TABS.find((t) => t.value === tab)?.filters ?? {}), search, issued_from: from, issued_to: to };
  const list = useDocList(filters, S.resource);
  const filtered = Boolean(search || from || to || tab !== 'all');
  const creditTab = tab === 'credit';

  const actions = useDocActions(S.resource);
  const sel = useRowSelection(list.rows);
  const bulk = useBulkRun();
  const [discarding, setDiscarding] = useState(false);
  const labelOf = (d: (typeof list.rows)[number]) => `${numberOf(d)} · ${customers.byId.get(d.contact_id)?.name ?? S.Contact}`;
  const items = sel.selected.map((d) => ({ ...d, label: labelOf(d) }));
  const submittable = items.filter((d) => d.status === 'draft' && d.can.submit);
  const discardable = items.filter((d) => d.status === 'draft' && d.can.void);
  const waiting = items.filter((d) => d.status === 'pending_approval').length;
  const describe = (e: unknown) => tradeVerdictText(e, side === 'purchases');
  const submitAll = async () => {
    await bulk.execute('submitted', items, (d) => d.status === 'draft' && d.can.submit, 'Not a draft you can submit, so it was left alone.', async (d, intent) => {
      const r = await actions.submit(d.id, d.version, intent);
      return r.status === 'posted' ? `Posted as ${r.number}` : 'Sent for approval';
    }, describe);
    sel.clear();
  };
  const discardAll = async (reason: string) => {
    setDiscarding(false);
    await bulk.execute('discarded', items, (d) => d.status === 'draft' && d.can.void, 'Not a draft you can discard, so it was left alone.', async (d, intent) => {
      await actions.voidDraft(d.id, reason, d.version, intent);
      return 'Discarded';
    }, describe);
    sel.clear();
  };
  const exportCsv = () => {
    downloadCsv(`${S.mains.replace(/\s+/g, '-')}-selected.csv`, [
      ['Number', S.Contact, 'Kind', 'Date', 'Due', 'Status', 'Currency', 'Total', 'Still open'],
      ...items.map((d) => [d.number ?? '', customers.byId.get(d.contact_id)?.name ?? '', d.kind, d.issue_date, d.due_date ?? '', d.status, d.currency, minorToDecimal(d.total_fc, d.currency), d.status === 'posted' ? minorToDecimal(d.amount_due, d.baseCurrency) : '']),
    ]);
  };

  const open = (id: string, number: string | null) => {
    openTab({ id: `tab-${S.main}-${id}`, title: number || 'Draft', url: `/${coSlug}/${S.docsPath}/${id}`, type: side === 'sales' ? 'invoice' : 'bill' });
    navigate(`/${coSlug}/${S.docsPath}/${id}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={creditTab ? S.Credits : S.Mains}
        subtitle={side === 'sales' ? 'What you have billed customers, and what is still to be paid.' : 'What suppliers have billed you, and what is still to pay.'}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate(`/${coSlug}/${S.creditsPath}/new`)} className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary hover:bg-surface-neutral">
              New {S.credit}
            </button>
            <button type="button" onClick={() => navigate(`/${coSlug}/${S.docsPath}/new`)} className={BTN_ACCENT}>
              <Plus className="size-4" />
              New {S.main}
              <Kbd className="ml-1 border-white/30 bg-white/20 text-white">N</Kbd>
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1 border-b border-border" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              onClick={() => setTab(t.value)}
              className={cn('-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors', tab === t.value ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary')}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input type="search" aria-label="Search documents" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search by number or reference" className={cn(inputClass, 'w-56')} />
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            Issued from
            <input type="date" aria-label="Issued from" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
          </label>
          <label className="flex items-center gap-1.5 text-xs text-text-muted">
            to
            <input type="date" aria-label="Issued to" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
          </label>
        </div>
      </div>

      <TableCard>
        {list.isLoading ? (
          <LoadingLine what={S.mains} />
        ) : list.error ? (
          <ErrorLine error={list.error} onRetry={list.refetch} />
        ) : list.rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <h3 className="text-sm font-semibold text-text-primary">{filtered ? 'Nothing matches these filters' : `No ${S.mains} yet`}</h3>
            <p className="mt-1 max-w-sm text-[13px] text-text-muted">{filtered ? 'Change or clear the filters to see more.' : side === 'sales' ? 'Raise the first invoice to start collecting.' : 'Enter the first bill you receive from a supplier.'}</p>
            {!filtered && (
              <button type="button" onClick={() => navigate(`/${coSlug}/${S.docsPath}/new`)} className="mt-4 h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover">
                New {S.main}
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-left text-[13px]" data-testid="invoices-table">
            <thead>
              <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                <th className="w-9 px-3 py-2">
                  <Checkbox checked={sel.allSelected} onCheckedChange={sel.toggleAll} aria-label={`Select all ${S.mains} shown`} />
                </th>
                <th className="px-3 py-2">Number</th>
                <th className="px-3 py-2">{S.Contact}</th>
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Total</th>
                <th className="px-3 py-2 text-right">Still open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.rows.map((d) => (
                <tr key={d.id} onClick={() => open(d.id, d.number)} className="cursor-pointer hover:bg-surface-neutral/60" data-selected={sel.isSelected(d.id) || undefined}>
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <Checkbox checked={sel.isSelected(d.id)} onCheckedChange={() => sel.toggle(d.id)} aria-label={`Select ${numberOf(d)}`} />
                  </td>
                  <td className="px-3 py-2 font-semibold text-accent">
                    {numberOf(d)}
                    {d.kind === S.creditKind && <span className="ml-2 rounded-[3px] bg-surface-neutral px-1.5 py-0.5 text-[11px] font-normal text-text-secondary">{S.Credit}</span>}
                  </td>
                  <td className="px-3 py-2 text-text-primary">{customers.byId.get(d.contact_id)?.name ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-text-muted">{formatDate(d.issue_date)}</td>
                  <td className="px-3 py-2 tabular-nums text-text-muted">{d.due_date ? formatDate(d.due_date) : '—'}</td>
                  <td className="px-3 py-2">
                    <DocStatusPill doc={d} />
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-text-primary">{formatMoney(d.total_fc, d.currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-text-secondary">{d.status === 'posted' ? formatMoney(d.amount_due, d.baseCurrency) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <LoadMore hasMore={list.hasMore} loading={list.isLoadingMore} onClick={list.loadMore} />
      </TableCard>

      <BulkBar
        selected={sel.selected.length}
        busy={bulk.busy}
        onClear={sel.clear}
        hint={waiting > 0 ? 'Documents waiting for approval are approved in the Approvals inbox.' : undefined}
        actions={[
          { key: 'submit', label: 'Submit', count: submittable.length, onClick: () => void submitAll(), title: submittable.length === 0 ? 'None of the selected are drafts you can submit.' : undefined },
          { key: 'discard', label: 'Discard drafts', count: discardable.length, danger: true, onClick: () => setDiscarding(true), title: discardable.length === 0 ? 'None of the selected are drafts you can discard.' : undefined },
          { key: 'csv', label: 'Export CSV', count: items.length, onClick: exportCsv },
        ]}
      />
      <BulkDiscardDialog open={discarding} count={discardable.length} noun={creditTab ? S.credit : S.main} onCancel={() => setDiscarding(false)} onConfirm={(r) => void discardAll(r)} />
      <BulkResultsSheet result={bulk.result} title="Bulk results" onClose={bulk.clearResult} />
      <SignDialog {...bulk.signProps} documentTitle={`${submittable.length} ${S.mains} to submit`} actionTitle={`Submit ${submittable.length}`} consequenceText="Your PIN is checked once. Each document is then submitted on its own: it is posted, or sent for approval, and any that cannot be submitted are listed afterwards with the reason." />
    </div>
  );
};
