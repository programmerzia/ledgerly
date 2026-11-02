import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Pause, Play } from 'lucide-react';
import { useLedgerStore } from '@/mock/store';
import { PageHeader } from '@/components/domain/PageHeader';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useRecurringActions, useRecurringJournals } from '@/data/recurring';
import { IntentSlot } from '@/api/intentSlot';
import { ApiError } from '@/api/errors';
import type { RecurringJournal } from '@/api/adapters/journal';
import { ErrorLine, LoadingLine, verdictText } from './parts';
import { RepeatDialog } from './RepeatDialog';

const FREQUENCY = { monthly: 'Monthly', quarterly: 'Every quarter', annual: 'Every year' } as const;

/**
 * Repeating journal entries from /recurring-journals. The mock's second tab (spread costs / prepayments) has no
 * endpoint, so it is not shown in live mode.
 */
export const RecurringJournalsLive: React.FC = () => {
  const navigate = useNavigate();
  const coSlug = useLedgerStore((s) => s.currentCompany.slug);
  const list = useRecurringJournals();
  const actions = useRecurringActions();
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const slots = useRef(new Map<string, IntentSlot>());
  const slot = (k: string) => {
    let s = slots.current.get(k);
    if (!s) slots.current.set(k, (s = new IntentSlot()));
    return s;
  };

  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.isVersionConflict) {
      setConflict({ noun: 'schedule', serverVersion: e.serverVersion, onClose: () => setConflict(null), onReload: () => { setConflict(null); list.refetch(); } });
      return;
    }
    toast.error(verdictText(e));
  };

  const toggle = async (s: RecurringJournal) => {
    setBusy(s.id);
    const sl = slot(`toggle-${s.id}`);
    try {
      await actions.toggle(s, sl.for(`${s.id}:${s.version}:${s.is_active}`));
      sl.clear();
      toast.success(s.is_active ? 'Paused. No drafts are made until you resume it.' : 'Resumed');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  const runNow = async () => {
    setBusy('run');
    const sl = slot('run');
    try {
      const created = await actions.runNow(sl.for('run'));
      sl.clear();
      const failed = created.filter((c) => c.status !== 'submitted' && c.status !== 'created');
      toast.success(created.length === 0 ? 'Nothing is due yet.' : `Created ${created.length} draft journal${created.length === 1 ? '' : 's'}.${failed.length ? ` ${failed.length} could not be submitted and stay as drafts.` : ''}`, {
        action: created.length ? { label: 'View journals', onClick: () => navigate(`/${coSlug}/journals`) } : undefined,
      });
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Repeating entries"
        subtitle="Set up entries you make every month. Each date makes a draft; nothing posts by itself."
        actions={
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => void runNow()} disabled={busy === 'run'} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition hover:bg-surface-neutral disabled:opacity-50">
              {busy === 'run' ? 'Creating…' : 'Create due drafts'}
            </button>
            <button type="button" onClick={() => setCreating(true)} className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover">
              New repeating entry
            </button>
          </div>
        }
      />

      {list.isLoading ? (
        <LoadingLine what="repeating entries" />
      ) : list.error ? (
        <ErrorLine error={list.error} onRetry={list.refetch} />
      ) : list.data.length === 0 ? (
        <div className="flex flex-col items-center rounded-lg border border-border bg-surface px-6 py-14 text-center">
          <h3 className="text-sm font-semibold text-text-primary">No repeating entries yet</h3>
          <p className="mt-1 max-w-sm text-[13px] text-text-muted">Pick a posted journal to copy on a schedule, or use Repeat on a posted journal.</p>
          <button type="button" onClick={() => setCreating(true)} className="mt-4 h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover">
            New repeating entry
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" data-testid="recurring-list">
          {list.data.map((s) => (
            <div key={s.id} className="flex flex-col justify-between gap-4 rounded-lg border border-border bg-surface p-5">
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="rounded-[3px] bg-surface-neutral px-1.5 py-px text-xs font-medium text-text-secondary">{FREQUENCY[s.frequency]}</span>
                  <span className={cn('rounded-[3px] px-1.5 py-px text-xs font-medium', s.is_active ? 'bg-success-soft text-success' : 'bg-surface-neutral text-text-muted')}>{s.is_active ? 'Active' : 'Paused'}</span>
                </div>
                <h3 className="text-sm font-semibold text-text-primary">{s.name}</h3>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <dt className="text-text-muted">Next draft</dt>
                  <dd className="text-right tabular-nums text-text-primary">{s.next_date ? formatDate(s.next_date) : '—'}</dd>
                  <dt className="text-text-muted">Last run</dt>
                  <dd className="text-right tabular-nums text-text-primary">{s.last_run_on ? formatDate(s.last_run_on) : 'Never'}</dd>
                  <dt className="text-text-muted">Drafts made</dt>
                  <dd className="text-right tabular-nums text-text-primary">{s.generated_count}</dd>
                  {s.end_date && (
                    <>
                      <dt className="text-text-muted">Ends</dt>
                      <dd className="text-right tabular-nums text-text-primary">{formatDate(s.end_date)}</dd>
                    </>
                  )}
                </dl>
                {s.last_error && <p className="text-xs text-warning">Last problem: {s.last_error}</p>}
              </div>
              <div className="flex items-center justify-between border-t border-border pt-3">
                {s.template_id ? (
                  <button type="button" onClick={() => navigate(`/${coSlug}/journals/${s.template_id}`)} className="text-xs text-accent hover:underline">
                    View the journal it copies
                  </button>
                ) : (
                  <span />
                )}
                {(s.is_active ? s.can.pause : s.can.resume) && (
                  <button
                    type="button"
                    onClick={() => void toggle(s)}
                    disabled={busy === s.id}
                    className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-primary transition hover:bg-surface-neutral disabled:opacity-50"
                  >
                    {s.is_active ? <Pause className="size-3.5 text-text-muted" /> : <Play className="size-3.5 text-text-muted" />}
                    {s.is_active ? 'Pause' : 'Resume'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <RepeatDialog open={creating} onClose={() => setCreating(false)} />
      <ConflictDialog conflict={conflict} />
    </div>
  );
};
