import React, { useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Pencil, Plus, Receipt, UserX } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { StatusPill } from '@/components/domain/StatusPill';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDate, formatMoney } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRouteCompany } from '@/data/session';
import { useContact, useContactActions } from '@/data/contacts';
import { useDocList } from '@/data/invoices';
import { useSettlementList } from '@/data/settlements';
import { ApiError } from '@/api/errors';
import { IntentSlot } from '@/api/intentSlot';
import { tradeVerdictText, DocStatusPill, numberOf, BTN_ACCENT, BTN_GHOST, ErrorLine, LoadMore, LoadingLine, TableCard } from './parts';
import { ContactDialog } from './ContactDialog';

type Tab = 'overview' | 'invoices' | 'receipts';

/** One customer: what they owe (the server's figure), their documents and receipts, edit, deactivate. */
export const CustomerCardLive: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const company = useRouteCompany();
  const coSlug = company.slug;
  const contactQ = useContact(id);
  const actions = useContactActions();
  const [tab, setTab] = useState<Tab>('overview');
  const [editing, setEditing] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const slot = useRef(new IntentSlot()).current;

  const docs = useDocList({ contact_id: id });
  const receipts = useSettlementList({ contact_id: id, kind: 'receipt' });

  const c = contactQ.data;
  if (contactQ.isLoading) return <LoadingLine what="customer" />;
  if (contactQ.error || !c) {
    const notFound = contactQ.error instanceof ApiError && contactQ.error.status === 404;
    return notFound ? (
      <div className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
        This customer does not exist in this company.{' '}
        <button type="button" onClick={() => navigate(`/${coSlug}/customers`)} className="text-accent hover:underline">
          Back to customers
        </button>
      </div>
    ) : (
      <ErrorLine error={contactQ.error} onRetry={contactQ.refetch} />
    );
  }

  const deactivate = async () => {
    setBusy(true);
    try {
      await actions.deactivate(c.id, c.version, slot.for(`${c.id}:${c.version}`));
      slot.clear();
      setConfirmOff(false);
      toast.success('Customer deactivated. Their history is kept.');
    } catch (e) {
      if (e instanceof ApiError && e.isVersionConflict) {
        setConfirmOff(false);
        setConflict({ noun: 'customer', serverVersion: e.serverVersion, localVersion: c.version, onClose: () => setConflict(null), onReload: () => { setConflict(null); contactQ.refetch(); } });
      } else toast.error(tradeVerdictText(e));
    } finally {
      setBusy(false);
    }
  };

  const limit = c.credit_limit != null ? formatMoney(c.credit_limit, c.creditLimitCurrency ?? c.default_currency) : 'No limit set';

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumb={[{ label: 'Customers', to: `/${coSlug}/customers` }, { label: c.name }]}
        title={c.name}
        subtitle={`${c.code}${c.email ? ` · ${c.email}` : ''}`}
        meta={c.is_active ? undefined : <span className="rounded-[3px] bg-surface-neutral px-2 py-0.5 text-xs text-text-muted">Inactive</span>}
        actions={
          <div className="flex items-center gap-2">
            {c.is_active && (
              <>
                <button type="button" onClick={() => navigate(`/${coSlug}/receipts/new?contactId=${c.id}`)} className={BTN_GHOST}>
                  <Receipt className="size-4 text-text-muted" /> Receive money
                </button>
                <button type="button" onClick={() => navigate(`/${coSlug}/invoices/new?contactId=${c.id}`)} className={BTN_ACCENT}>
                  <Plus className="size-4" /> New invoice
                </button>
              </>
            )}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-text-muted">Owes you</div>
          <div className="mt-1 text-[22px] font-medium tabular-nums text-text-primary" data-testid="contact-receivable">{formatMoney(c.receivable, c.baseCurrency)}</div>
          <div className="mt-1 text-xs text-text-muted">As held by the books, in {c.baseCurrency}</div>
        </div>
        <div className="rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-text-muted">Credit limit</div>
          <div className="mt-1 text-[22px] font-medium tabular-nums text-text-primary">{limit}</div>
          <div className="mt-1 text-xs text-text-muted">Terms {c.payment_terms_days} days · {c.default_currency}</div>
        </div>
        <div className="flex flex-col justify-between rounded-lg border border-border bg-surface p-4">
          <div className="text-xs text-text-muted">Details</div>
          <div className="mt-1 flex flex-wrap gap-2">
            {c.can.update && (
              <button type="button" onClick={() => setEditing(true)} className={BTN_GHOST}>
                <Pencil className="size-4 text-text-muted" /> Edit
              </button>
            )}
            {c.can.deactivate && c.is_active && (
              <button type="button" onClick={() => setConfirmOff(true)} className={cn(BTN_GHOST, 'hover:border-danger/50 hover:text-danger')}>
                <UserX className="size-4" /> Deactivate
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-border" role="tablist">
        {([['overview', 'Overview'], ['invoices', 'Invoices and credit notes'], ['receipts', 'Receipts']] as const).map(([v, label]) => (
          <button key={v} type="button" role="tab" aria-selected={tab === v} onClick={() => setTab(v)} className={cn('-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors', tab === v ? 'border-accent text-accent' : 'border-transparent text-text-muted hover:text-text-primary')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <dl className="grid gap-x-8 gap-y-3 rounded-lg border border-border bg-surface p-5 text-[13px] sm:grid-cols-2">
          {([
            ['Phone', c.phone],
            ['Tax ID', c.tax_id],
            ['Billing address', c.billing_address.join(', ')],
            ['Notes', c.notes],
          ] as const).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] font-semibold text-text-muted">{k}</dt>
              <dd className="text-text-primary">{v || '—'}</dd>
            </div>
          ))}
        </dl>
      )}

      {tab === 'invoices' && (
        <TableCard>
          {docs.isLoading ? (
            <LoadingLine what="documents" />
          ) : docs.error ? (
            <ErrorLine error={docs.error} onRetry={docs.refetch} />
          ) : docs.rows.length === 0 ? (
            <p className="p-6 text-center text-[13px] text-text-muted">No invoices for this customer yet.</p>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  <th className="px-3 py-2">Number</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Due</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {docs.rows.map((d) => (
                  <tr key={d.id} onClick={() => navigate(`/${coSlug}/invoices/${d.id}`)} className="cursor-pointer hover:bg-surface-neutral/60">
                    <td className="px-3 py-2 font-semibold text-accent">{numberOf(d)}</td>
                    <td className="px-3 py-2 text-text-secondary">{d.kind === 'credit_note' ? 'Credit note' : 'Invoice'}</td>
                    <td className="px-3 py-2 tabular-nums text-text-muted">{formatDate(d.issue_date)}</td>
                    <td className="px-3 py-2 tabular-nums text-text-muted">{d.due_date ? formatDate(d.due_date) : '—'}</td>
                    <td className="px-3 py-2">
                      <DocStatusPill doc={d} />
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(d.total_fc, d.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <LoadMore hasMore={docs.hasMore} loading={docs.isLoadingMore} onClick={docs.loadMore} />
        </TableCard>
      )}

      {tab === 'receipts' && (
        <TableCard>
          {receipts.isLoading ? (
            <LoadingLine what="receipts" />
          ) : receipts.error ? (
            <ErrorLine error={receipts.error} onRetry={receipts.refetch} />
          ) : receipts.rows.length === 0 ? (
            <p className="p-6 text-center text-[13px] text-text-muted">No receipts from this customer yet.</p>
          ) : (
            <table className="w-full text-left text-[13px]">
              <thead>
                <tr className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">
                  <th className="px-3 py-2">Number</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Reference</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {receipts.rows.map((r) => (
                  <tr key={r.id} onClick={() => navigate(`/${coSlug}/receipts/${r.id}`)} className="cursor-pointer hover:bg-surface-neutral/60">
                    <td className="px-3 py-2 font-semibold text-accent">{r.number || 'Draft'}</td>
                    <td className="px-3 py-2 tabular-nums text-text-muted">{formatDate(r.settlement_date)}</td>
                    <td className="px-3 py-2 text-text-secondary">{r.reference || '—'}</td>
                    <td className="px-3 py-2">
                      <StatusPill status={r.status} />
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{formatMoney(r.amount_fc, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <LoadMore hasMore={receipts.hasMore} loading={receipts.isLoadingMore} onClick={receipts.loadMore} />
        </TableCard>
      )}

      {editing && <ContactDialog open onClose={() => setEditing(false)} contact={c} baseCurrency={company.base_currency} />}

      <Dialog open={confirmOff} onOpenChange={setConfirmOff}>
        <DialogContent className="max-w-md rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary">Deactivate {c.name}?</DialogTitle>
            <DialogDescription className="text-xs text-text-muted">They will no longer appear when you pick a customer. Their invoices and receipts stay exactly as they are.</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-2 flex justify-end gap-2">
            <button type="button" onClick={() => setConfirmOff(false)} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral">
              Keep active
            </button>
            <button type="button" disabled={busy} onClick={() => void deactivate()} className="h-8 rounded-md bg-danger px-3 text-[13px] font-medium text-white disabled:opacity-50">
              Deactivate
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ConflictDialog conflict={conflict} />
    </div>
  );
};
