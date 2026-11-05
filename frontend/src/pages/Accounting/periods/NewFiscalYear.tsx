/**
 * Add a fiscal year (plan 3c.26a): calendar months, or 52 weeks cut 4-4-5, 4-5-4 or 5-4-4 with an optional 53rd week in a period you pick.
 * The server builds the periods and refuses what does not fit (overlap, a month start that is not the 1st); this form only asks.
 */
import React, { useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { http } from '@/api/http';
import { createIntent } from '@/api/idempotency';
import { describeProblem } from '@/api/live/writeProblems';
import { useQueryClient } from '@tanstack/react-query';
import { fiscalYearsKey } from '@/data/fiscal';
import { useActiveCompany } from '@/data/session';

const CALENDARS = [
  { value: 'monthly', label: 'Calendar months' },
  { value: '4-4-5', label: '4-4-5 weeks' },
  { value: '4-5-4', label: '4-5-4 weeks' },
  { value: '5-4-4', label: '5-4-4 weeks' },
] as const;

const input = 'h-9 rounded-md border border-border bg-surface px-2 text-[13px] text-text-primary';

export const NewFiscalYear: React.FC<{ open: boolean; onClose: () => void; suggestedStart?: string }> = ({ open, onClose, suggestedStart }) => {
  const { company } = useActiveCompany();
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [start, setStart] = useState(suggestedStart ?? '');
  const [calendar, setCalendar] = useState<(typeof CALENDARS)[number]['value']>('monthly');
  const [extra, setExtra] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const intent = React.useRef(createIntent());
  const weeks = calendar !== 'monthly';

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    try {
      await http.post('/v1/companies/{company}/fiscal-years', {
        path: { company: company.id },
        body: { name, starts_on: start, calendar, ...(weeks && extra ? { extra_week_period: Number(extra) } : {}) } as never,
        intent: intent.current,
      });
      await qc.invalidateQueries({ queryKey: fiscalYearsKey(company.id) });
      toast.success(`${name} added`);
      intent.current = createIntent();
      onClose();
    } catch (e) {
      setProblem(describeProblem(e));
      intent.current = createIntent();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a fiscal year</DialogTitle>
          <DialogDescription>
            {weeks ? 'A week-based year is 52 whole weeks from the start date (364 days). Start it the day after the previous year ends.' : 'Twelve calendar months, starting on the 1st.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3 py-2">
          <label className="flex flex-col gap-1 text-[13px] font-medium text-text-primary">Name
            <input className={input} value={name} maxLength={32} placeholder="FY2027" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium text-text-primary">Starts on
            <input className={input} type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1 text-[13px] font-medium text-text-primary">Periods
            <select className={input} value={calendar} onChange={(e) => { setCalendar(e.target.value as typeof calendar); setExtra(''); }}>
              {CALENDARS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          {weeks && (
            <label className="flex flex-col gap-1 text-[13px] font-medium text-text-primary">53rd week
              <select className={input} value={extra} onChange={(e) => setExtra(e.target.value)}>
                <option value="">None, a 52-week year</option>
                {Array.from({ length: 12 }, (_, i) => <option key={i + 1} value={i + 1}>Add a week to period {i + 1}</option>)}
              </select>
            </label>
          )}
          {problem && <p role="alert" className="text-[13px] text-danger">{problem}</p>}
        </div>
        <DialogFooter>
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-border px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-neutral cursor-pointer">Cancel</button>
          <button type="button" disabled={busy || name.trim() === '' || start === ''} onClick={() => void submit()} className="h-9 rounded-md bg-accent px-4 text-[13px] font-medium text-white hover:bg-accent-hover cursor-pointer disabled:opacity-60">Add year</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
