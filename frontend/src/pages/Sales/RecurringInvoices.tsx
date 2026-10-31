import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { CalendarClock, Eye, MoreHorizontal, Pause, Play, PlayCircle, Plus, Repeat } from 'lucide-react';
import { useLedgerStore } from '@/mock/store';
import { PageHeader } from '@/components/domain/PageHeader';
import { EmptyState } from '@/components/domain/EmptyState';
import { Avatar } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { formatMoney, formatDate } from '@/lib/format';
import { BUSINESS_TODAY } from '@/lib/docStatus';
import { cn } from '@/lib/utils';
import type { RecurringSchedule } from '@/types';
import { MakeRecurringDialog } from './MakeRecurringDialog';

const FREQ: Record<string, string> = { monthly: 'Every month', quarterly: 'Every 3 months' };

export const RecurringInvoices: React.FC = () => {
  const navigate = useNavigate();
  const { recurringSchedules, invoices, contacts, currentCompany, setRecurringActive, runRecurringSchedules } = useLedgerStore();
  const [dialogOpen, setDialogOpen] = useState(false);
  const coSlug = currentCompany.slug;

  const isDue = (r: RecurringSchedule) =>
    r.is_active && r.next_date <= BUSINESS_TODAY && (!r.end_date || r.next_date <= r.end_date);
  const dueCount = recurringSchedules.filter(isDue).length;

  const runNow = (only?: RecurringSchedule) => {
    let created: ReturnType<typeof runRecurringSchedules> = [];
    try {
      created = runRecurringSchedules(BUSINESS_TODAY, only?.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create the invoices. Try again.');
      return;
    }
    if (created.length === 0) {
      toast.info('Nothing is due yet. The next invoice will be created on its date.');
      return;
    }
    toast.success(`Created ${created.length} ${created.length === 1 ? 'invoice' : 'invoices'} — they're waiting for approval`, {
      description: (
        <Link to={`/${coSlug}/approvals`} className="text-accent font-medium underline">
          Go to Approvals
        </Link>
      ),
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        breadcrumb={[{ label: 'Invoices', to: `/${coSlug}/invoices` }, { label: 'Recurring' }]}
        title="Recurring invoices"
        subtitle="Prepare an invoice every month or quarter from one template"
        actions={
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="inline-flex items-center gap-1.5 h-8 px-3 bg-accent hover:bg-accent-hover text-white rounded-md text-[13px] font-medium transition-colors"
          >
            <Plus className="size-4" /> New schedule
          </button>
        }
      />

      {dueCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-[13px]">
          <span className="flex items-center gap-2 font-medium text-text-primary">
            <CalendarClock className="size-4 text-warning" />
            {dueCount} {dueCount === 1 ? 'invoice is' : 'invoices are'} due
          </span>
          <button
            type="button"
            onClick={() => runNow()}
            className="h-8 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[13px] font-medium"
          >
            Create {dueCount === 1 ? 'it' : 'them'}
          </button>
        </div>
      )}

      {recurringSchedules.length === 0 ? (
        <EmptyState
          icon={Repeat}
          title="No recurring invoices yet"
          description="For customers you bill the same way every month or quarter. Pick a past invoice and we'll prepare a copy on each date and send it for approval. Nothing is posted until someone approves it."
          actionLabel="New schedule"
          onAction={() => setDialogOpen(true)}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {recurringSchedules.map((r) => {
            const customer = contacts.find((c) => c.id === r.contact_id);
            const template = invoices.find((i) => i.id === r.template_invoice_id);
            const due = isDue(r);
            const ended = !!r.end_date && r.next_date > r.end_date;
            return (
              <section
                key={r.id}
                className={cn('rounded-lg border border-border bg-surface p-4 flex flex-col gap-3', !r.is_active && 'opacity-70')}
                aria-label={r.name}
              >
                <div className="flex items-start gap-3">
                  <Avatar name={customer?.name || r.name} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-text-primary">{customer?.name || r.name}</div>
                    <div className="text-xs text-text-muted">{FREQ[r.frequency]}{r.end_date ? ` until ${formatDate(r.end_date)}` : ''}</div>
                  </div>
                  <Switch
                    checked={r.is_active}
                    onCheckedChange={(v) => {
                      setRecurringActive(r.id, v);
                      toast.success(v ? 'Schedule resumed' : 'Schedule paused');
                    }}
                    aria-label={r.is_active ? 'Pause schedule' : 'Resume schedule'}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button type="button" aria-label="Schedule actions" className="grid size-8 place-items-center rounded-lg text-text-muted hover:bg-surface-neutral">
                        <MoreHorizontal className="size-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-48 rounded-lg p-1">
                      <DropdownMenuItem disabled={!r.is_active} onSelect={() => runNow(r)} className="h-8 gap-2 rounded-md">
                        <PlayCircle className="size-4 text-text-muted" /> Run now
                      </DropdownMenuItem>
                      <DropdownMenuItem disabled={!template} onSelect={() => template && navigate(`/${coSlug}/invoices/${template.id}`)} className="h-8 gap-2 rounded-md">
                        <Eye className="size-4 text-text-muted" /> Open template
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setRecurringActive(r.id, !r.is_active)} className="h-8 gap-2 rounded-md">
                        {r.is_active ? <Pause className="size-4 text-text-muted" /> : <Play className="size-4 text-text-muted" />}
                        {r.is_active ? 'Pause' : 'Resume'}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <div className="text-[22px] leading-7 font-medium tabular-nums text-text-primary">
                  {template ? formatMoney(template.total, template.currency) : '—'}
                </div>

                <dl className="grid grid-cols-2 gap-2 rounded-lg bg-surface-neutral px-3 py-2 text-[13px]">
                  <div>
                    <dt className="text-xs text-text-muted">Next invoice</dt>
                    <dd className={cn('font-medium', due ? 'text-warning' : 'text-text-primary')}>
                      {ended ? 'Finished' : !r.is_active ? 'Paused' : due ? `Due ${formatDate(r.next_date)}` : formatDate(r.next_date)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-text-muted">Created so far</dt>
                    <dd className="font-medium text-text-primary tabular-nums">{r.generated_invoice_ids.length}</dd>
                  </div>
                </dl>

                {due && (
                  <button
                    type="button"
                    onClick={() => runNow(r)}
                    className="h-8 rounded-lg border border-border hover:border-border-strong bg-surface hover:bg-surface-neutral text-[13px] font-medium text-text-primary"
                  >
                    Run now
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}

      <MakeRecurringDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
};
