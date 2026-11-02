import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/domain/PageHeader';
import { cn } from '@/lib/utils';
import { formatDate, formatMoney } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useContactDirectory } from '@/data/contacts';
import { useDoc } from '@/data/invoices';
import { useTradeRefs } from '@/data/tradeRefs';
import { useWhtCertificateList } from '@/data/wht';
import { ErrorLine, LoadMore, LoadingLine, TableCard, inputClass } from '@/pages/Sales/live/parts';

const BillLink: React.FC<{ id: string; coSlug: string }> = ({ id, coSlug }) => {
  const d = useDoc(id, 'bills');
  return <Link to={`/${coSlug}/bills/${id}`} className="text-accent hover:underline">{d.data?.number ?? 'Bill'}</Link>;
};

/** Certificates the server issued when a payment settled a bill that carries withholding. Read only. */
export const WhtCertificatesLive: React.FC = () => {
  const company = useRouteCompany();
  const coSlug = company.slug;
  const suppliers = useContactDirectory('supplier', true);
  const refs = useTradeRefs();
  const [supplier, setSupplier] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const list = useWhtCertificateList({ contact_id: supplier, status, from, to });
  const filtered = Boolean(supplier || status || from || to);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Tax withheld certificates" subtitle="Issued when a payment settles a bill that has tax withheld. Hand one to the supplier as proof of what you held back." />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          Supplier
          <select aria-label="Filter by supplier" value={supplier} onChange={(e) => setSupplier(e.target.value)} className={inputClass}>
            <option value="">All suppliers</option>
            {suppliers.contacts.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          State
          <select aria-label="Filter by state" value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}>
            <option value="">All</option>
            <option value="issued">Issued</option>
            <option value="void">Void</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          Issued from
          <input type="date" aria-label="Issued from" value={from} onChange={(e) => setFrom(e.target.value)} className={inputClass} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-text-muted">
          to
          <input type="date" aria-label="Issued to" value={to} onChange={(e) => setTo(e.target.value)} className={inputClass} />
        </label>
      </div>
      <TableCard>
        {list.isLoading ? (
          <LoadingLine what="certificates" />
        ) : list.error ? (
          <ErrorLine error={list.error} onRetry={list.refetch} />
        ) : list.rows.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-14 text-center">
            <h3 className="text-sm font-semibold text-text-primary">{filtered ? 'No certificates match' : 'No certificates yet'}</h3>
            <p className="mt-1 max-w-sm text-[13px] text-text-muted">{filtered ? 'Change or clear the filters to see more.' : 'A certificate appears here once a payment settles a bill with tax withheld.'}</p>
          </div>
        ) : (
          <table className="w-full text-left text-[13px]" data-testid="wht-table">
            <thead>
              <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                <th className="px-3 py-2">Certificate</th>
                <th className="px-3 py-2">Supplier</th>
                <th className="px-3 py-2">Bill</th>
                <th className="px-3 py-2">Payment</th>
                <th className="px-3 py-2">Code</th>
                <th className="px-3 py-2">Issued</th>
                <th className="px-3 py-2 text-right">Worked out on</th>
                <th className="px-3 py-2 text-right">Withheld</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.rows.map((c) => (
                <tr key={c.id} className={cn(c.status === 'void' && 'text-text-muted')} data-cert={c.number}>
                  <td className="px-3 py-2 font-semibold text-text-primary">
                    {c.number}
                    {c.status === 'void' && <span className="ml-2 rounded-[3px] bg-surface-neutral px-1.5 py-0.5 text-[11px] font-normal text-text-muted">Void</span>}
                  </td>
                  <td className="px-3 py-2 text-text-secondary">{suppliers.byId.get(c.contact_id)?.name ?? '—'}</td>
                  <td className="px-3 py-2"><BillLink id={c.invoice_id} coSlug={coSlug} /></td>
                  <td className="px-3 py-2"><Link to={`/${coSlug}/payments/${c.payment_id}`} className="text-accent hover:underline">Open</Link></td>
                  <td className="px-3 py-2 text-text-secondary">{refs.taxCodes.find((t) => t.id === c.tax_code_id)?.code ?? '—'}</td>
                  <td className="px-3 py-2 tabular-nums text-text-muted">{c.issued_on ? formatDate(c.issued_on) : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(c.base_amount, c.currency)}</td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-text-primary">{formatMoney(c.wht_amount, c.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <LoadMore hasMore={list.hasMore} loading={list.isLoadingMore} onClick={list.loadMore} />
      </TableCard>
    </div>
  );
};
