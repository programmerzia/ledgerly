/**
 * Settings → Numbering (plan 3c.17). Per document kind: the prefix and padding for the next fiscal year. Numbers already issued
 * never change and nothing is renumbered; a change reaches only a year whose numbers have not started. The screen says plainly when
 * a change will wait, and from which year.
 */
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApiError } from '@/api/errors';
import { IntentSlot } from '@/api/intentSlot';
import { describeError } from '@/api/messages';
import type { NumberingKindRow, NumberingOverview } from '@/api/live/numbering';
import { useNumbering, useNumberingActions } from '@/data/numbering';
import { useSettings } from '@/data/admin';
import { useCurrentCompany } from '@/data/team';
import { LoadError, Loading, field, primary, secondary } from '@/components/live/form';
import { formatDate } from '@/lib/format';
import { SettingsCard } from '../settings-ui';

const PADDINGS = [3, 4, 5, 6, 7, 8, 9, 10];

/** "the fiscal year FY2027" when that year exists, else "the year that starts on 1 Jan 2028". */
const startsWith = (fiscalYear: string | null, from: string): string => (fiscalYear ? `fiscal year ${fiscalYear} (from ${formatDate(from)})` : `the fiscal year that starts on ${formatDate(from)}`);

const Row: React.FC<{ row: NumberingKindRow; year: NumberingOverview['current_fiscal_year']; canEdit: boolean }> = ({ row, year, canEdit }) => {
  const actions = useNumberingActions();
  const slot = useRef(new IntentSlot()).current;
  const [prefix, setPrefix] = useState<string | null>(null);
  const [padding, setPadding] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const shownPrefix = prefix ?? row.pending?.prefix ?? row.prefix;
  const shownPadding = padding ?? row.pending?.padding ?? row.padding;
  const dirty = shownPrefix !== (row.pending?.prefix ?? row.prefix) || shownPadding !== (row.pending?.padding ?? row.padding);
  const preview = `${shownPrefix || '…'}-YEAR-${'1'.padStart(shownPadding, '0')}`;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { prefix: shownPrefix, padding: shownPadding, version: row.pending?.version ?? null };
      const meta = await actions.set(row.kind, body, slot.for(JSON.stringify([row.kind, body])));
      slot.clear();
      setPrefix(null);
      setPadding(null);
      toast.success(meta.unchanged ? 'That is what the year already uses, so the waiting change was dropped.' : `Saved. It starts with ${startsWith(meta.fiscal_year, meta.effective_from)}.`);
    } catch (err) {
      setError(err);
      if (err instanceof ApiError && err.isVersionConflict) toast.error('Someone else changed this. The list has the latest; try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li data-numbering={row.kind} className="grid grid-cols-1 gap-3 py-4 first:pt-0 last:pb-0 md:grid-cols-[14rem_1fr] md:gap-6">
      <div>
        <div className="text-[13px] font-medium text-text-primary">{row.label}</div>
        <p className="mt-0.5 text-xs text-text-muted">
          {year ? `${year.name} uses ` : 'Uses '}
          <span className="font-mono">{row.current_year_sequence ? `${row.current_year_sequence.prefix}-${'1'.padStart(row.current_year_sequence.padding, '0')}` : row.example}</span>
          {row.current_year_sequence ? ` (${row.current_year_sequence.issued} issued)` : ' (none issued yet)'}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Prefix
            <input
              aria-label={`${row.label} prefix`} className={`${field} w-28 font-mono uppercase`} maxLength={8} value={shownPrefix} disabled={!canEdit || busy}
              onChange={(e) => setPrefix(e.target.value.toUpperCase())}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-text-muted">
            Digits
            <select aria-label={`${row.label} digits`} className={`${field} w-20`} value={shownPadding} disabled={!canEdit || busy} onChange={(e) => setPadding(Number(e.target.value))}>
              {PADDINGS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <span className="pb-2 font-mono text-xs text-text-secondary" data-testid={`numbering-preview-${row.kind}`}>{preview}</span>
          {canEdit && (
            <div className="flex gap-2 pb-0.5">
              <button type="button" className={primary} disabled={!dirty || busy || shownPrefix === ''} onClick={() => void save()}>{busy ? 'Saving…' : 'Save'}</button>
              <button type="button" className={secondary} disabled={!dirty || busy} onClick={() => { setPrefix(null); setPadding(null); setError(null); }}>Discard</button>
            </div>
          )}
        </div>
        {row.pending ? (
          <p role="status" data-testid={`numbering-pending-${row.kind}`} className="text-xs text-text-secondary">
            Waiting: from {startsWith(row.pending.fiscal_year, row.pending.effective_from)} numbers read <span className="font-mono">{row.pending.example}</span>. Until then the current numbering continues.
          </p>
        ) : (
          <p className="text-xs text-text-muted" data-testid={`numbering-next-${row.kind}`}>A change starts with {startsWith(null, row.next_change_from)} or the first year after it without numbers; numbers already issued stay as they are.</p>
        )}
        {error ? <p role="alert" className="text-xs text-danger">{describeError(error)}</p> : null}
      </div>
    </li>
  );
};

export const LiveNumbering: React.FC = () => {
  const company = useCurrentCompany();
  const q = useNumbering();
  const settings = useSettings(company.id);
  if (q.isPending) return <Loading what="Loading numbering" />;
  if (q.isError) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;
  const canEdit = Boolean(settings.data?.can.update);

  return (
    <div className="flex flex-col gap-5">
      <div role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-[13px] text-text-secondary">
        A number reads prefix, fiscal year, counter. A new prefix or number of digits applies <strong>from the next fiscal year only</strong>. Numbers already issued are never
        changed and nothing is renumbered, so the counters stay in sequence without gaps. If next year&apos;s numbers have already started, the change waits for the year after.
      </div>
      <SettingsCard title="Document numbers" description="Two kinds can never share a prefix, so no two documents get the same number. Use capital letters and digits, starting with a letter.">
        <ul className="divide-y divide-border">
          {q.data.kinds.map((row) => <Row key={row.kind} row={row} year={q.data.current_fiscal_year} canEdit={canEdit} />)}
        </ul>
      </SettingsCard>
    </div>
  );
};
