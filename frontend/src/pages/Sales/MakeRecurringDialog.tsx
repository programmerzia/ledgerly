import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { Repeat } from 'lucide-react';
import { useLedgerStore } from '@/mock/store';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatMoney } from '@/lib/format';
import { BUSINESS_TODAY } from '@/lib/docStatus';
import type { RecurringFrequency } from '@/types';

export const addMonthsISO = (date: string, months: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};

const FIELD =
  'w-full h-9 px-2.5 rounded-lg border border-border bg-surface text-[13px] text-text-primary focus:border-accent outline-hidden';
const LABEL = 'text-[11px] font-semibold uppercase tracking-wide text-text-muted';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Pre-selected template invoice. Leave empty to let the user choose. */
  invoiceId?: string;
}

export const MakeRecurringDialog: React.FC<Props> = ({ open, onOpenChange, invoiceId }) => {
  const { invoices, contacts, currentUser, currentCompany, addRecurringSchedule } = useLedgerStore();
  const coSlug = currentCompany.slug;
  const candidates = useMemo(
    () => invoices.filter((i) => i.status === 'posted' && i.kind === 'sales_invoice').sort((a, b) => b.issue_date.localeCompare(a.issue_date)),
    [invoices]
  );
  const [templateId, setTemplateId] = useState('');
  const [frequency, setFrequency] = useState<RecurringFrequency>('monthly');
  const [nextDate, setNextDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [error, setError] = useState('');

  const template = invoices.find((i) => i.id === templateId);
  const customer = contacts.find((c) => c.id === template?.contact_id);

  useEffect(() => {
    if (!open) return;
    const id = invoiceId || candidates[0]?.id || '';
    setTemplateId(id);
    const inv = invoices.find((i) => i.id === id);
    setFrequency('monthly');
    setNextDate(addMonthsISO(inv?.issue_date || BUSINESS_TODAY, 1));
    setEndDate('');
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceId]);

  const changeTemplate = (id: string) => {
    setTemplateId(id);
    const inv = invoices.find((i) => i.id === id);
    setNextDate(addMonthsISO(inv?.issue_date || BUSINESS_TODAY, frequency === 'quarterly' ? 3 : 1));
  };
  const changeFrequency = (f: RecurringFrequency) => {
    setFrequency(f);
    if (template) setNextDate(addMonthsISO(template.issue_date, f === 'quarterly' ? 3 : 1));
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!template || !customer) return setError('Pick the invoice to repeat.');
    if (!nextDate) return setError('Choose the date of the first new invoice.');
    if (endDate && endDate < nextDate) return setError('The end date must be after the first date.');
    addRecurringSchedule({
      name: `${customer.name} · ${frequency} ${template.number || 'invoice'}`,
      template_invoice_id: template.id,
      contact_id: customer.id,
      frequency,
      next_date: nextDate,
      end_date: endDate || undefined,
      owner_id: currentUser.id,
      is_active: true,
    });
    onOpenChange(false);
    toast.success(`Repeating ${frequency} for ${customer.name}`, {
      description: (
        <>
          New invoices wait for approval before posting.{' '}
          <Link to={`/${coSlug}/invoices/recurring`} className="text-accent font-medium underline">
            View recurring invoices
          </Link>
        </>
      ),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-surface border border-border p-6 shadow-xl rounded-xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base font-semibold text-text-primary">
              <span className="grid size-8 place-items-center rounded-lg bg-accent-soft text-accent">
                <Repeat className="size-4" />
              </span>
              Make this invoice recurring
            </DialogTitle>
            <DialogDescription>
              We'll create a copy on each date and send it for approval. Nothing is posted until someone approves it.
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-1">
            <label className={LABEL} htmlFor="rec-template">Invoice to repeat</label>
            <select id="rec-template" autoFocus value={templateId} onChange={(e) => changeTemplate(e.target.value)} className={FIELD}>
              {candidates.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.number} · {contacts.find((c) => c.id === i.contact_id)?.name} · {formatMoney(i.total, i.currency)}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1">
              <label className={LABEL} htmlFor="rec-freq">How often</label>
              <select id="rec-freq" value={frequency} onChange={(e) => changeFrequency(e.target.value as RecurringFrequency)} className={FIELD}>
                <option value="monthly">Every month</option>
                <option value="quarterly">Every 3 months</option>
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className={LABEL} htmlFor="rec-next">First new invoice</label>
              <input id="rec-next" type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className={FIELD} />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <label className={LABEL} htmlFor="rec-end">Stop after (optional)</label>
            <input id="rec-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={FIELD} />
          </div>

          {error && <p className="text-[13px] text-danger" role="alert">{error}</p>}

          <DialogFooter className="gap-2">
            <button type="button" onClick={() => onOpenChange(false)} className="h-9 px-3 rounded-lg border border-border bg-surface hover:bg-surface-neutral text-[13px] font-medium text-text-primary">
              Cancel
            </button>
            <button type="submit" disabled={!template} className="h-9 px-4 rounded-lg bg-accent hover:bg-accent-hover text-white text-[13px] font-semibold disabled:opacity-50">
              Start repeating
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};
