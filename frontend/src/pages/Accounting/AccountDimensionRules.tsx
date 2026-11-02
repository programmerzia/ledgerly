import React, { useEffect, useRef, useState } from 'react';
import { Tag } from 'lucide-react';
import { toast } from 'sonner';
import type { Account } from '@/types';
import { useDimensions } from '@/data/dimensions';
import { useAccountActions } from '@/data/accounts';
import { createIntent } from '@/api/idempotency';
import { describeError } from '@/api/messages';
import { describeProblem } from '@/api/live/writeProblems';
import type { DimensionRuleValue } from '@/api/adapters/account';

type RuleChoice = DimensionRuleValue | 'none';
const CHOICES: { value: RuleChoice; label: string }[] = [
  { value: 'none', label: 'No rule' },
  { value: 'optional', label: 'Optional' },
  { value: 'required', label: 'Required' },
  { value: 'forbidden', label: 'Not allowed' },
];

/**
 * Live mode: which dimensions an account must, may or must not carry on a journal line. The server enforces it at
 * posting preview; this panel only edits the rule set (PUT /accounts/{id}/dimension-rules).
 */
export const AccountDimensionRules: React.FC<{ account: Account }> = ({ account }) => {
  const { data: dimensions, isLoading, error, refetch } = useDimensions();
  const actions = useAccountActions();
  const server = account.dimension_rules ?? {};
  const [draft, setDraft] = useState<Record<string, RuleChoice>>({});
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const intent = useRef(createIntent());

  useEffect(() => {
    setDraft(Object.fromEntries(Object.entries(server).map(([k, v]) => [k, v])));
    setProblem(null);
    // Re-seed when the server copy changes (switching account, or after a save refetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id, JSON.stringify(server)]);

  const active = dimensions.filter((d) => d.is_active || server[d.id]);
  const dirty = active.some((d) => (draft[d.id] ?? 'none') !== (server[d.id] ?? 'none'));
  const canEdit = account.can?.update === true;

  const save = async () => {
    setSaving(true);
    setProblem(null);
    try {
      await actions.setDimensionRules(account, Object.fromEntries(active.map((d) => [d.id, draft[d.id] ?? 'none'])), intent.current);
      toast.success(`Dimension rules for ${account.code} saved`);
    } catch (e) {
      setProblem(describeProblem(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-3 bg-surface border border-border rounded-md flex flex-col gap-2">
      <span className="text-[10px] font-semibold text-text-muted flex items-center gap-1">
        <Tag className="w-3 h-3 text-accent" />
        Dimension rules
      </span>
      {isLoading ? (
        <p className="text-[11px] text-text-muted" role="status">Loading dimensions…</p>
      ) : error ? (
        <p className="text-[11px] text-danger" role="alert">
          {describeError(error)}{' '}
          <button type="button" onClick={refetch} className="text-accent hover:underline cursor-pointer">Try again</button>
        </p>
      ) : active.length === 0 ? (
        <p className="text-[11px] text-text-muted">No dimensions yet. Add one under Dimensions, then set rules here.</p>
      ) : (
        <>
          <ul className="flex flex-col gap-1.5">
            {active.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-text-primary">{d.name} <span className="font-mono text-text-muted">{d.code}</span></span>
                <select
                  aria-label={`Rule for ${d.name}`}
                  value={draft[d.id] ?? 'none'}
                  disabled={!canEdit || saving}
                  onChange={(e) => setDraft({ ...draft, [d.id]: e.target.value as RuleChoice })}
                  className="h-7 rounded-md border border-border bg-surface px-1.5 text-[11px] text-text-primary focus:outline-none focus:border-accent"
                >
                  {CHOICES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </li>
            ))}
          </ul>
          {problem && <p className="text-[11px] text-danger" role="alert">{problem}</p>}
          {canEdit && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void save()}
                disabled={!dirty || saving}
                className="h-7 px-3 rounded-md bg-accent hover:bg-accent-hover text-white text-[11px] font-medium cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Saving…' : 'Save rules'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
};
