import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { ColumnDef } from '@tanstack/react-table';
import { Eye, Printer, Download, CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import type { Contact, Invoice, Settlement } from '@/types';
import { PageHeader } from '@/components/domain/PageHeader';
import { DataTable } from '@/components/domain/DataTable';
import { StatusPill } from '@/components/domain/StatusPill';
import { Avatar } from '@/components/ui/avatar';
import { formatMoney, formatDate } from '@/lib/format';
import { paymentStatus, amountDue } from '@/lib/docStatus';
import { cn } from '@/lib/utils';
import { ContactKpiStrip } from './ContactKpiStrip';

type Tab = 'transactions' | 'statement' | 'details';

interface Row {
  id: string;
  date: string;
  type: string;
  number: string;
  status: string;
  amount: number;
  open: number;
  currency: string;
  /** Route to open, if any. */
  to?: string;
  isPayment: boolean;
}

interface Props {
  kind: 'customer' | 'supplier';
  contact: Contact;
  /** Invoices (customer) or bills (supplier). */
  docs: Invoice[];
  settlements: Settlement[];
  balance: number;
  overdue: number;
  companyName: string;
  coSlug: string;
  /** Header action buttons. */
  actions: React.ReactNode;
}

const CARD = 'rounded-lg border border-border bg-surface';

export const ContactAccountCard: React.FC<Props> = ({ kind, contact, docs, settlements, balance, overdue, companyName, coSlug, actions }) => {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('transactions');
  const isCustomer = kind === 'customer';
  const cur = contact.default_currency;
  const docPath = isCustomer ? 'invoices' : 'bills';
  const docWord = isCustomer ? 'Invoice' : 'Bill';
  const payWord = isCustomer ? 'Receipt' : 'Payment';

  const paidYtd = Math.max(
    settlements.filter((s) => s.status !== 'void').reduce((sum, s) => sum + s.amount, 0),
    docs.reduce((sum, d) => sum + (d.settled ?? 0), 0)
  );
  const paymentCount = Math.max(settlements.length, docs.filter((d) => (d.settled ?? 0) > 0).length);

  const rows: Row[] = useMemo(() => {
    const d: Row[] = docs.map((x) => ({
      id: x.id,
      date: x.issue_date,
      type: docWord,
      number: x.number || 'Draft',
      status: paymentStatus(x),
      amount: x.total,
      open: x.status === 'posted' ? amountDue(x) : 0,
      currency: x.currency,
      to: `/${coSlug}/${docPath}/${x.id}`,
      isPayment: false,
    }));
    const p: Row[] = settlements.map((s) => ({
      id: s.id,
      date: s.settlement_date,
      type: payWord,
      number: s.number || payWord,
      status: s.status,
      amount: s.amount,
      open: 0,
      currency: s.currency,
      isPayment: true,
    }));
    return [...d, ...p].sort((a, b) => b.date.localeCompare(a.date));
  }, [docs, settlements, coSlug, docPath, docWord, payWord]);

  const columns: ColumnDef<Row>[] = [
    { accessorKey: 'date', header: 'Date', cell: ({ row }) => <span className="text-text-secondary">{formatDate(row.original.date)}</span> },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-2 text-text-primary">
          {row.original.type}
        </span>
      ),
    },
    { accessorKey: 'number', header: 'Number', cell: ({ row }) => <span className="font-mono font-medium text-text-primary">{row.original.number}</span> },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <StatusPill status={row.original.status} /> },
    {
      accessorKey: 'amount',
      header: () => <div className="text-right">Amount</div>,
      cell: ({ row }) => (
        <div className={cn('text-right font-mono text-num', row.original.isPayment ? 'text-success' : 'text-text-primary')}>
          {row.original.isPayment ? '+' : ''}
          {formatMoney(row.original.amount, row.original.currency)}
        </div>
      ),
    },
    {
      accessorKey: 'open',
      header: () => <div className="text-right">Still open</div>,
      cell: ({ row }) => (
        <div className="text-right font-mono text-num text-text-muted">
          {row.original.open > 0 ? <span className="text-text-primary font-medium">{formatMoney(row.original.open, row.original.currency)}</span> : '—'}
        </div>
      ),
    },
  ];

  const rowActions = (r: Row) => [
    {
      label: r.to ? `Open ${docWord.toLowerCase()}` : 'View details',
      icon: Eye,
      shortcut: 'Enter',
      onClick: () => (r.to ? navigate(r.to) : toast.info(`${r.number} is recorded on this account`)),
    },
    ...(!r.isPayment && r.open > 0
      ? [
          {
            label: isCustomer ? 'Record payment' : 'Pay',
            icon: CreditCard,
            onClick: () =>
              isCustomer ? navigate(`/${coSlug}/receipts/new?invoiceId=${r.id}`) : navigate(`/${coSlug}/bills/${r.id}`),
          },
        ]
      : []),
    { label: 'Download PDF', icon: Download, onClick: () => toast.success(`Preparing PDF for ${r.number}`) },
  ];

  const tabs: { key: Tab; label: string; count?: number }[] = [
    { key: 'transactions', label: 'Transactions', count: rows.length },
    { key: 'statement', label: 'Statement' },
    { key: 'details', label: 'Details' },
  ];

  const statementDocs = docs.filter((x) => x.status === 'posted' || x.status === 'reversed');

  return (
    <div className="flex flex-col gap-5 pb-20">
      <PageHeader
        breadcrumb={[{ label: isCustomer ? 'Customers' : 'Suppliers', to: `/${coSlug}/${isCustomer ? 'customers' : 'suppliers'}` }, { label: contact.name }]}
        title={
          <span className="flex items-center gap-3">
            <Avatar name={contact.name} size="lg" square />
            <span className="truncate">{contact.name}</span>
          </span>
        }
        subtitle={`${contact.code} · ${contact.email || 'No email'} · Net ${contact.payment_terms_days} day terms`}
        actions={actions}
      />

      <ContactKpiStrip
        items={[
          {
            label: isCustomer ? 'Balance owed to you' : 'Balance you owe',
            value: formatMoney(balance, cur),
            sub: 'Open on posted documents',
            tone: 'accent',
          },
          {
            label: 'Overdue',
            value: formatMoney(overdue, cur),
            sub: overdue > 0 ? 'Past the payment terms' : 'Nothing is late',
            tone: overdue > 0 ? 'danger' : 'success',
          },
          {
            label: isCustomer ? 'Paid by them this year' : 'Paid to them this year',
            value: formatMoney(paidYtd, cur),
            sub: `${paymentCount} ${paymentCount === 1 ? 'payment' : 'payments'}`,
            tone: 'success',
          },
        ]}
      />

      <div role="tablist" className="flex items-center gap-1 border-b border-border">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'relative -mb-px flex items-center gap-2 px-3.5 py-2.5 text-[13px] font-medium transition-colors border-b-2',
              tab === t.key ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-primary'
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cn('rounded-[3px] px-1.5 text-[11px] tabular-nums', tab === t.key ? 'bg-accent-soft text-accent' : 'bg-surface-neutral text-text-muted')}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'transactions' && (
        <DataTable
          columns={columns}
          data={rows}
          searchPlaceholder="Filter transactions..."
          rowActions={rowActions}
          contextMenuTitle={(r) => `${r.type} ${r.number}`}
          onRowDoubleClick={(r) => r.to && navigate(r.to)}
        />
      )}

      {tab === 'statement' && (
        <div className={cn(CARD, 'p-6 flex flex-col gap-5')}>
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
            <div>
              <h2 className="text-base font-semibold text-text-primary">Statement of account</h2>
              <p className="text-xs text-text-muted mt-0.5">
                {companyName} and {contact.name}
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-lg border border-border bg-surface text-[13px] font-medium text-text-primary hover:bg-surface-neutral transition-colors"
            >
              <Printer className="size-4 text-text-muted" /> Print
            </button>
          </div>
          <table className="w-full text-[13px] tabular-nums">
            <thead>
              <tr className="text-[11px] font-semibold uppercase tracking-wide text-text-muted border-b border-border">
                <th className="py-2 text-left font-semibold">Date</th>
                <th className="py-2 text-left font-semibold">{docWord}</th>
                <th className="py-2 text-right font-semibold">Amount</th>
                <th className="py-2 text-right font-semibold">Paid</th>
                <th className="py-2 text-right font-semibold">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {statementDocs.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-text-muted">Nothing to show yet.</td>
                </tr>
              )}
              {statementDocs.map((x) => (
                <tr key={x.id}>
                  <td className="py-2 text-text-muted">{formatDate(x.issue_date)}</td>
                  <td className="py-2 font-mono text-text-primary">{x.number || 'Draft'}</td>
                  <td className="py-2 text-right text-text-primary">{formatMoney(x.total, x.currency)}</td>
                  <td className="py-2 text-right text-success">{x.settled > 0 ? formatMoney(x.settled, x.currency) : '—'}</td>
                  <td className="py-2 text-right font-medium text-text-primary">{formatMoney(amountDue(x), x.currency)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border-strong font-semibold text-text-primary">
                <td colSpan={4} className="pt-3 text-right">Total open</td>
                <td className="pt-3 text-right">{formatMoney(balance, cur)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {tab === 'details' && (
        <div className="grid gap-4 md:grid-cols-2">
          <DetailCard
            title={isCustomer ? 'Customer' : 'Supplier'}
            items={[
              ['Code', contact.code],
              ['Name', contact.name],
              ['Legal name', contact.legal_name || 'Same as name'],
              ['Tax ID', contact.tax_id || 'Not set'],
              ['Email', contact.email || 'Not set'],
              ['Phone', contact.phone || 'Not set'],
            ]}
          />
          <DetailCard
            title="Terms"
            items={[
              ['Currency', contact.default_currency],
              ['Payment terms', `Net ${contact.payment_terms_days} days`],
              ...(isCustomer
                ? ([['Credit limit', contact.credit_limit ? formatMoney(contact.credit_limit, cur) : 'No limit']] as [string, string][])
                : []),
              ['Status', contact.is_active === false ? 'Inactive' : 'Active'],
            ]}
          />
        </div>
      )}
    </div>
  );
};

const DetailCard: React.FC<{ title: string; items: [string, string][] }> = ({ title, items }) => (
  <section className={cn(CARD, 'p-5')}>
    <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
    <dl className="mt-3 divide-y divide-border/70 text-[13px]">
      {items.map(([k, v]) => (
        <div key={k} className="flex items-center justify-between gap-4 py-2">
          <dt className="text-text-muted">{k}</dt>
          <dd className="text-text-primary text-right truncate">{v}</dd>
        </div>
      ))}
    </dl>
  </section>
);
