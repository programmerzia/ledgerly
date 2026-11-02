import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { formatDate, formatMoney } from '@/lib/format';
import { useLedgerStore } from '@/mock/store';
import { useJournalList } from '@/data/journals';
import { useRecurringActions } from '@/data/recurring';
import { IntentSlot } from '@/api/intentSlot';
import { toApiDate } from '@/api/adapters/dates';
import { ErrorLine, LoadingLine, inputClass, verdictText } from './parts';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Fixed template (from a journal's own page). Without it the dialog lets the user pick a posted manual journal. */
  templateId?: string;
  defaultName?: string;
  onCreated?: () => void;
}

/** New repeating entry: a posted manual journal is the template; the server makes the drafts on schedule. */
export const RepeatDialog: React.FC<Props> = ({ open, onClose, templateId, defaultName = '', onCreated }) => {
  const currency = useLedgerStore((s) => s.currentCompany.base_currency);
  const actions = useRecurringActions();
  const [name, setName] = useState(defaultName);
  const [frequency, setFrequency] = useState<'monthly' | 'quarterly' | 'annual'>('monthly');
  const [nextDate, setNextDate] = useState(() => toApiDate(new Date()));
  const [endDate, setEndDate] = useState('');
  const [picked, setPicked] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const slot = useRef(new IntentSlot()).current;
  const templates = useJournalList({ status: 'posted', type: 'manual', search: templateId ? undefined : search.trim() || undefined });
  const template = templateId ?? picked;

  const submit = async () => {
    if (!template || !name.trim()) return;
    setBusy(true);
    setError('');
    const input = { name: name.trim(), template_id: template, frequency, next_date: nextDate, end_date: endDate || undefined };
    try {
      await actions.create(input, slot.for(JSON.stringify(input)));
      slot.clear();
      toast.success('Repeating entry saved. Drafts are made on the dates you set; nothing posts by itself.');
      onCreated?.();
      onClose();
    } catch (e) {
      setError(verdictText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-w-lg rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-text-primary">New repeating entry</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3 text-xs text-text-secondary">
          <label className="flex flex-col gap-1 font-medium">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="e.g. Monthly office rent accrual" />
          </label>
          {!templateId && (
            <div className="flex flex-col gap-1.5">
              <span className="font-medium">Copy the lines of this posted journal</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by note or reference" className={inputClass} aria-label="Search posted journals" />
              <div className="max-h-44 overflow-y-auto rounded-md border border-border">
                {templates.isLoading ? (
                  <LoadingLine what="journals" />
                ) : templates.error ? (
                  <ErrorLine error={templates.error} onRetry={templates.refetch} />
                ) : templates.rows.length === 0 ? (
                  <p className="p-3 text-text-muted">No posted manual journals match. Post one first, then repeat it.</p>
                ) : (
                  templates.rows.map((j) => (
                    <label key={j.id} className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 last:border-b-0 hover:bg-surface-neutral">
                      <input type="radio" name="template" checked={picked === j.id} onChange={() => setPicked(j.id)} />
                      <span className="font-medium text-text-primary">{j.number}</span>
                      <span className="truncate text-text-muted">{j.memo || j.reference || formatDate(j.journal_date)}</span>
                      <span className="ml-auto tabular-nums text-text-primary">{formatMoney(j.total_debit, currency)}</span>
                    </label>
                  ))
                )}
              </div>
              {templates.hasMore && (
                <button type="button" onClick={templates.loadMore} className="self-start text-accent hover:underline">
                  Show more
                </button>
              )}
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <label className="flex flex-col gap-1 font-medium">
              How often
              <select value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)} className={inputClass}>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="annual">Every year</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 font-medium">
              First draft on
              <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} className={inputClass} />
            </label>
            <label className="flex flex-col gap-1 font-medium">
              Last date (optional)
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className={inputClass} />
            </label>
          </div>
          {error && (
            <p role="alert" className="text-danger">
              {error}
            </p>
          )}
        </div>
        <DialogFooter className="mt-2 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || !template || !name.trim()}
            className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Save repeating entry'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
