/**
 * Live dashboard (step 3.1, first version). Only figures that come straight from an endpoint:
 * receivables and payables from the aging reports, year-to-date net profit from the profit and loss,
 * book balances per bank account, and counts of approvals and overdue documents. Panels with no
 * source yet are left out, not faked (docs/15, "What's left"). A panel the role may not see (403) is
 * left out too.
 */
import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, X } from 'lucide-react';
import { formatMoney, formatDate } from '@/lib/format';
import { countLabel } from '@/api/adapters/dashboard';
import { isSetupComplete, loadSkipped } from '@/api/adapters/onboarding';
import { describeError } from '@/api/messages';
import { panelState, useLiveDashboard, type PanelState } from '@/data/dashboard';
import { useSetupState } from '@/data/setup';
import { useMe } from '@/data/session';
import { useCurrentCompany } from '@/data/team';
import { KeyFigures, type Figure } from './widgets/KeyFigures';
import { AttentionList, type AttentionRow } from './widgets/AttentionList';
import { ReceivablesAging } from './widgets/ReceivablesAging';
import { Card, CardHeader } from './widgets/Card';
import { AGING_BUCKETS } from './useDashboardData';

const plural = (n: string, one: string, many: string) => (n === '1' ? one : many);

const Retry: React.FC<{ error: unknown; onRetry: () => void }> = ({ error, onRetry }) => (
  <p role="alert" className="px-5 pb-4 text-[13px] text-danger">
    {describeError(error)} <button type="button" onClick={onRetry} className="text-accent hover:underline cursor-pointer">Try again</button>
  </p>
);

export const LiveDashboard: React.FC = () => {
  const company = useCurrentCompany();
  const navigate = useNavigate();
  const me = useMe();
  const d = useLiveDashboard(company);
  const setup = useSetupState(company.id, me.data?.id ?? '');
  const [showChecklist, setShowChecklist] = useState(true);
  const co = `/${company.slug}`;

  const ar = panelState(d.ar);
  const ap = panelState(d.ap);
  const profit = panelState(d.profit);
  const banks = panelState(d.banks);
  const approvals = panelState(d.approvals);
  const overdueInv = panelState(d.overdueInvoices);
  const overdueBill = panelState(d.overdueBills);

  // ---- Key figures: a figure is shown while loading ("…"), on error ("Unavailable"), and left out when not for this role.
  const figure = (state: PanelState, f: Omit<Figure, 'value' | 'note'> & { value: () => string; note: () => React.ReactNode }): Figure | null => {
    if (state === 'hidden') return null;
    if (state === 'loading') return { ...f, value: '…', note: 'Loading', valueClass: 'text-text-muted' };
    if (state === 'error') return { ...f, value: 'Unavailable', note: 'Could not load', valueClass: 'text-text-muted' };
    return { ...f, value: f.value(), note: f.note() };
  };
  const figures = [
    figure(ar, {
      label: 'Owed to you', to: `${co}/invoices`,
      value: () => (d.ar.data ? formatMoney(d.ar.data.net.minor, d.ar.data.net.currency) : 'No data'),
      note: () => `As of ${formatDate(d.today)}`,
    }),
    figure(ap, {
      label: 'You owe', to: `${co}/bills`,
      value: () => (d.ap.data ? formatMoney(d.ap.data.net.minor, d.ap.data.net.currency) : 'No data'),
      note: () => `As of ${formatDate(d.today)}`,
    }),
    figure(profit, {
      label: 'Net profit, year to date', to: `${co}/reports/profit-and-loss`,
      valueClass: (d.profit.data?.minor ?? 0) < 0 ? 'text-danger' : undefined,
      value: () => (d.profit.data ? formatMoney(d.profit.data.minor, d.profit.data.currency, { parenthesesNegative: true }) : 'No data'),
      note: () => `To ${formatDate(d.today)}`,
    }),
  ].filter((f): f is Figure => f !== null);

  // ---- To do
  const todo: AttentionRow[] = [];
  if (d.approvals.data && d.approvals.data.count > 0) {
    const n = String(d.approvals.data.count);
    todo.push({ id: 'approvals', text: `Approve ${n} ${plural(n, 'document', 'documents')}`, cta: 'Review', to: `${co}/approvals` });
  }
  if (d.overdueInvoices.data && d.overdueInvoices.data.count > 0) {
    const n = countLabel(d.overdueInvoices.data.count, d.overdueInvoices.data.hasMore);
    todo.push({ id: 'overdue-inv', text: `Chase ${n} overdue ${plural(n, 'invoice', 'invoices')}`, urgent: true, cta: 'Invoices', to: `${co}/invoices` });
  }
  if (d.overdueBills.data && d.overdueBills.data.count > 0) {
    const n = countLabel(d.overdueBills.data.count, d.overdueBills.data.hasMore);
    todo.push({ id: 'overdue-bill', text: `Pay ${n} overdue ${plural(n, 'bill', 'bills')}`, urgent: true, cta: 'Bills', to: `${co}/bills` });
  }
  const todoLoading = [approvals, overdueInv, overdueBill].includes('loading');
  const todoError = [approvals, overdueInv, overdueBill].includes('error');
  const todoHidden = [approvals, overdueInv, overdueBill].every((s) => s === 'hidden');

  // ---- Getting started: only steps with a real source, and only while some are open.
  const checklist = [
    { id: 'coa', title: 'Set up your chart of accounts', done: d.chart.data, link: `/${company.slug}/onboarding` },
    { id: 'bank', title: 'Add a bank account', done: d.banks.data ? d.banks.data.length > 0 : undefined, link: `${co}/banking` },
    { id: 'invoice', title: 'Send your first invoice', done: d.postedInvoice.data, link: `${co}/invoices` },
    { id: 'bill', title: 'Record a supplier bill', done: d.postedBill.data, link: `${co}/bills` },
  ].filter((c) => c.done !== undefined);
  const doneCount = checklist.filter((c) => c.done).length;
  const nextStep = checklist.find((c) => !c.done);
  // Only people who can manage the organisation are sent back to the wizard; it needs rights a plain member lacks.
  const canSetUp = Boolean(me.data?.tenants.find((t) => t.current)?.can.manage_members);
  const setupOpen = canSetUp && setup.data ? !isSetupComplete(setup.data, loadSkipped(company.id)) : false;

  return (
    <div className="flex flex-col gap-4">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-text-primary">{company.name}</h1>
        <p className="mt-0.5 text-[13px] text-text-muted">{formatDate(d.today)} · {company.base_currency}</p>
      </div>

      {setupOpen && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2.5 text-[13px] text-text-secondary">
          <span className="flex-1">Your company setup is not finished.</span>
          <Link to={`${co}/onboarding`} className="font-medium text-accent hover:underline">Continue setup</Link>
        </div>
      )}

      {showChecklist && nextStep && (
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4">
          <div className="flex-1 text-[13px] text-text-secondary">Getting started: {doneCount} of {checklist.length} steps done</div>
          <div className="flex items-center gap-3 text-xs">
            <button type="button" onClick={() => navigate(nextStep.link)} className="flex cursor-pointer items-center gap-1 font-medium text-accent hover:underline">
              Next: {nextStep.title}<ChevronRight className="size-3.5" />
            </button>
            <button type="button" aria-label="Dismiss getting started" onClick={() => setShowChecklist(false)} className="cursor-pointer text-text-muted hover:text-text-primary"><X className="size-3.5" /></button>
          </div>
        </div>
      )}

      {figures.length > 0 && <KeyFigures figures={figures} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {!todoHidden && (
          todoLoading && todo.length === 0 ? (
            <Card className="lg:col-span-6"><CardHeader title="To do" /><p role="status" className="px-5 pb-5 text-[13px] text-text-muted">Loading…</p></Card>
          ) : todoError && todo.length === 0 ? (
            <Card className="lg:col-span-6"><CardHeader title="To do" /><Retry error={d.approvals.error ?? d.overdueInvoices.error ?? d.overdueBills.error} onRetry={() => { void d.approvals.refetch(); void d.overdueInvoices.refetch(); void d.overdueBills.refetch(); }} /></Card>
          ) : (
            <AttentionList rows={todo} className="lg:col-span-6" />
          )
        )}
        {ar === 'loading' && <Card className="lg:col-span-6"><CardHeader title="Receivables aging" /><p role="status" className="px-5 pb-5 text-[13px] text-text-muted">Loading…</p></Card>}
        {ar === 'error' && <Card className="lg:col-span-6"><CardHeader title="Receivables aging" /><Retry error={d.ar.error} onRetry={() => void d.ar.refetch()} /></Card>}
        {ar === 'ready' && d.ar.data && ((ar_) => (
          <ReceivablesAging
            className="lg:col-span-6"
            index={0}
            total={d.ar.data.open.minor}
            d={{
              base: d.ar.data.open.currency,
              aging: AGING_BUCKETS.map((b) => ({
                ...b,
                count: 0,
                amount: { current: ar_.current, d30: ar_.days1to30, d60: ar_.days31to60, d90: ar_.days61to90, d90p: ar_.over90 }[b.key].minor,
              })),
            }}
          />
        ))(d.ar.data)}
      </div>

      {banks !== 'hidden' && (
        <Card>
          <CardHeader title="Bank accounts" right={<Link to={`${co}/banking`} className="text-xs text-accent hover:underline">Manage</Link>} />
          {banks === 'loading' ? <p role="status" className="px-5 pb-5 text-[13px] text-text-muted">Loading…</p> : banks === 'error' ? (
            <Retry error={d.banks.error} onRetry={() => void d.banks.refetch()} />
          ) : (
            <ul className="divide-y divide-border border-t border-border">
              {d.banks.data?.map((b) => (
                <li key={b.id} className="flex items-center gap-3 px-5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium text-text-primary">{b.name}</div>
                    <div className="text-xs tabular-nums text-text-muted">{b.maskedNumber}</div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="whitespace-nowrap text-[13px] font-medium tabular-nums text-text-primary">{b.balance ? formatMoney(b.balance.minor, b.balance.currency) : 'No balance'}</div>
                    {b.unreconciled ? <span className="text-xs text-text-muted">{b.unreconciled} to reconcile</span> : <span className="text-xs text-text-muted">Reconciled</span>}
                  </div>
                </li>
              ))}
              {d.banks.data?.length === 0 && <li className="px-5 py-4 text-[13px] text-text-muted">No bank accounts yet.</li>}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
};
