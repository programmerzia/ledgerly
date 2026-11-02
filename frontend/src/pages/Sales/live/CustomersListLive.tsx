import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRouteCompany } from '@/data/session';
import { useLedgerStore } from '@/mock/store';
import { useContactList } from '@/data/contacts';
import { BTN_ACCENT, ErrorLine, LoadMore, LoadingLine, TableCard, inputClass, useDebounced } from './parts';
import { ContactDialog } from './ContactDialog';

/** Customers against the API. The server searches and filters; the figure beside each name is the receivable the server holds. */
export const CustomersListLive: React.FC = () => {
  const navigate = useNavigate();
  const company = useRouteCompany();
  const openTab = useLedgerStore((s) => s.openTab);
  const coSlug = company.slug;
  const [searchText, setSearchText] = useState('');
  const [active, setActive] = useState<'true' | 'false' | ''>('true');
  const [creating, setCreating] = useState(false);
  const search = useDebounced(searchText.trim(), 300);
  const list = useContactList({ kind: 'customer', active, search });
  const filtered = Boolean(search) || active !== 'true';

  const open = (id: string, name: string) => {
    openTab({ id: `customer-${id}`, title: name, url: `/${coSlug}/customers/${id}`, type: 'customer' });
    navigate(`/${coSlug}/customers/${id}`);
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Customers"
        subtitle="The people and companies you invoice, and what each one owes."
        actions={
          <button type="button" onClick={() => setCreating(true)} className={BTN_ACCENT}>
            <Plus className="size-4" /> New customer
          </button>
        }
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 border-b border-border" role="tablist">
          {([['true', 'Active'], ['false', 'Inactive'], ['', 'All']] as const).map(([v, label]) => (
            <button
              key={label}
              type="button"
              role="tab"
              aria-selected={active === v}
              onClick={() => setActive(v)}
              className={cn('-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors', active === v ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary')}
            >
              {label}
            </button>
          ))}
        </div>
        <input type="search" aria-label="Search customers" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Search by name, code or email" className={cn(inputClass, 'w-64')} />
      </div>

      <TableCard>
        {list.isLoading ? (
          <LoadingLine what="customers" />
        ) : list.error ? (
          <ErrorLine error={list.error} onRetry={list.refetch} />
        ) : list.rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <h3 className="text-sm font-semibold text-text-primary">{filtered ? 'No customers match' : 'No customers yet'}</h3>
            <p className="mt-1 max-w-sm text-[13px] text-text-muted">{filtered ? 'Change or clear the search to see more.' : 'Add the first customer, then raise an invoice for them.'}</p>
            {!filtered && (
              <button type="button" onClick={() => setCreating(true)} className="mt-4 h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover">
                New customer
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-left text-[13px]" data-testid="customers-table">
            <thead>
              <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                <th className="px-3 py-2">Customer</th>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Email</th>
                <th className="px-3 py-2">Terms</th>
                <th className="px-3 py-2">Currency</th>
                <th className="px-3 py-2 text-right">Owes you</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.rows.map((c) => (
                <tr key={c.id} onClick={() => open(c.id, c.name)} className="cursor-pointer hover:bg-surface-neutral/60">
                  <td className="px-3 py-2 font-semibold text-accent">
                    {c.name}
                    {!c.is_active && <span className="ml-2 rounded-[3px] bg-surface-neutral px-1.5 py-0.5 text-[11px] font-normal text-text-muted">Inactive</span>}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{c.code}</td>
                  <td className="px-3 py-2 text-text-secondary">{c.email || '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-text-secondary">{c.payment_terms_days} days</td>
                  <td className="px-3 py-2 text-text-secondary">{c.default_currency}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-text-primary">{formatMoney(c.receivable, c.baseCurrency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <LoadMore hasMore={list.hasMore} loading={list.isLoadingMore} onClick={list.loadMore} />
      </TableCard>

      {creating && <ContactDialog open onClose={() => setCreating(false)} baseCurrency={company.base_currency} onSaved={(c) => open(c.id, c.name)} />}
    </div>
  );
};
