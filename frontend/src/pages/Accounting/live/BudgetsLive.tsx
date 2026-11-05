/**
 * Budgets, live mode (plan 3c.16): versions per fiscal year, the grid editor, copy from another version or last year's actuals,
 * approval by a second person, and the way to the budget vs actual report. Budgets never touch the ledger. An approved version is
 * read-only; a revision is a new draft copied from it.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/domain/PageHeader';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { LoadError, Loading, field, primary, secondary } from '@/components/live/form';
import { ApiError } from '@/api/errors';
import { IntentSlot } from '@/api/intentSlot';
import { describeError } from '@/api/messages';
import { budgetExportUrl, type ApiBudget } from '@/api/live/budgets';
import { changedCells, gridFromLines, rowKeyOf, type GridRow, type GridState } from '@/api/adapters/budgets';
import { useBudget, useBudgetActions, useBudgetYears, useBudgets } from '@/data/budgets';
import { useChartAccounts } from '@/data/banking';
import { useDimensions } from '@/data/dimensions';
import { useRouteCompany } from '@/data/session';
import { cn } from '@/lib/utils';
import { BudgetGrid } from './BudgetGrid';

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-surface-neutral text-text-secondary' },
  approved: { label: 'Approved', cls: 'bg-success-soft text-success' },
  archived: { label: 'Archived', cls: 'bg-surface-neutral text-text-muted' },
};
const Chip: React.FC<{ status: string }> = ({ status }) => (
  <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-medium', STATUS[status]?.cls)}>{STATUS[status]?.label ?? status}</span>
);

export const BudgetsLive: React.FC = () => {
  const company = useRouteCompany();
  const budgets = useBudgets();
  const [sp, setSp] = useSearchParams();
  const selected = sp.get('v');
  const [creating, setCreating] = useState(false);
  const list = budgets.data ?? [];
  const approved = list.find((b) => b.status === 'approved');

  // Open the approved version, else the newest, when none is chosen.
  useEffect(() => {
    if (selected === null && list.length > 0) setSp({ v: (approved ?? list[0]).id }, { replace: true });
  }, [selected, list, approved, setSp]);

  if (budgets.isPending) return <Loading what="Loading budgets" />;
  if (budgets.isError) return <LoadError error={budgets.error} onRetry={() => void budgets.refetch()} />;

  const byYear = new Map<string, { name: string; items: ApiBudget[] }>();
  for (const b of list) {
    const key = b.fiscal_year_id;
    if (!byYear.has(key)) byYear.set(key, { name: b.fiscal_year?.name ?? 'Fiscal year', items: [] });
    byYear.get(key)?.items.push(b);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Budgets"
        subtitle="Plan income and expense by account and month. Budgets are for comparison only: they never post to the books."
        actions={
          <div className="flex gap-2">
            <Link to={`/${company.slug}/reports/budget-vs-actual`} className={cn(secondary, 'inline-flex items-center')}>Budget vs actual</Link>
            <button type="button" className={primary} onClick={() => setCreating(true)}>New budget</button>
          </div>
        }
      />
      {creating && <NewBudget budgets={list} onDone={(b) => { setCreating(false); if (b) setSp({ v: b.id }); }} />}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[16rem_1fr]">
        <nav aria-label="Budget versions" className="flex flex-col gap-4">
          {list.length === 0 && <p className="text-[13px] text-text-muted" data-testid="budgets-none">No budgets yet. Make the first one with New budget.</p>}
          {[...byYear.entries()].map(([id, y]) => (
            <div key={id}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-text-muted">{y.name}</div>
              <ul className="flex flex-col gap-1">
                {y.items.map((b) => (
                  <li key={b.id}>
                    <button
                      type="button"
                      onClick={() => setSp({ v: b.id })}
                      aria-current={selected === b.id ? 'true' : undefined}
                      className={cn('flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-[13px]', selected === b.id ? 'border-accent bg-surface-neutral' : 'border-border bg-surface hover:border-border-strong')}
                    >
                      <span><span className="font-medium text-text-primary">{b.name}</span><span className="block text-xs text-text-muted">Version {b.revision} · {b.line_count ?? 0} amounts</span></span>
                      <Chip status={b.status} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
        <div className="min-w-0">{selected ? <Editor key={selected} budgetId={selected} versions={list} /> : null}</div>
      </div>
    </div>
  );
};

const NewBudget: React.FC<{ budgets: ApiBudget[]; onDone: (b: ApiBudget | null) => void }> = ({ budgets, onDone }) => {
  const years = useBudgetYears();
  const actions = useBudgetActions();
  const slot = useRef(new IntentSlot()).current;
  const [name, setName] = useState('');
  const [year, setYear] = useState('');
  const [copy, setCopy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const yearId = year || years.data?.[0]?.id || '';

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const body = { name: name.trim(), fiscal_year_id: yearId, ...(copy ? { copy_from_budget_id: copy } : {}) };
      const b = await actions.create(body, slot.for(JSON.stringify(body)));
      slot.clear();
      toast.success('Budget created as a draft.');
      onDone(b);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="New budget" className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-surface p-4">
      <label className="flex flex-col gap-1 text-xs text-text-muted">Name
        <input aria-label="Budget name" className={cn(field, 'w-56')} value={name} maxLength={120} placeholder="e.g. Operating plan" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">Fiscal year
        <select aria-label="Fiscal year" className={cn(field, 'w-40')} value={yearId} onChange={(e) => setYear(e.target.value)}>
          {(years.data ?? []).map((y) => <option key={y.id} value={y.id}>{y.name}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1 text-xs text-text-muted">Start from
        <select aria-label="Start from" className={cn(field, 'w-64')} value={copy} onChange={(e) => setCopy(e.target.value)}>
          <option value="">An empty budget</option>
          {budgets.map((b) => <option key={b.id} value={b.id}>{b.fiscal_year?.name} · {b.name} (version {b.revision})</option>)}
        </select>
      </label>
      <button type="button" className={primary} disabled={busy || name.trim() === '' || yearId === ''} onClick={() => void create()}>{busy ? 'Creating…' : 'Create draft'}</button>
      <button type="button" className={secondary} disabled={busy} onClick={() => onDone(null)}>Cancel</button>
      {error ? <p role="alert" className="w-full text-[13px] text-danger">{describeError(error)}</p> : null}
    </section>
  );
};

const Editor: React.FC<{ budgetId: string; versions: ApiBudget[] }> = ({ budgetId, versions }) => {
  const company = useRouteCompany();
  const q = useBudget(budgetId);
  const accounts = useChartAccounts();
  const dimensions = useDimensions();
  const years = useBudgetYears();
  const actions = useBudgetActions();
  const slot = useRef(new IntentSlot()).current;
  const [state, setState] = useState<GridState | null>(null);
  const [loadedFor, setLoadedFor] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const [add, setAdd] = useState({ account: '', dims: {} as Record<string, string> });
  const [source, setSource] = useState('');

  const codeOf = (id: string) => accounts.data.find((a) => a.id === id)?.code ?? '';
  const nameOf = (id: string) => { const a = accounts.data.find((x) => x.id === id); return a ? `${a.code} ${a.name}` : 'Account'; };
  const dimLabel = (dims: Record<string, string>) =>
    Object.entries(dims).map(([d, v]) => { const dim = dimensions.data.find((x) => x.id === d); return `${dim?.code ?? 'Dimension'}: ${dim?.values.find((x) => x.id === v)?.name ?? '?'}`; }).join(' · ');

  const budget = q.data?.data;
  const stamp = budget ? `${budget.id}:${budget.version}` : '';
  // (Re)load the grid from the server whenever the saved version changes.
  useEffect(() => {
    if (q.data && !accounts.isLoading && loadedFor !== stamp) {
      setState(gridFromLines(q.data.grid.lines, codeOf));
      setLoadedFor(stamp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data, accounts.isLoading, stamp]);

  const pnl = useMemo(() => accounts.data.filter((a) => (a.account_type === 'income' || a.account_type === 'expense') && a.is_postable && a.is_active && !a.is_hidden), [accounts.data]);

  if (q.isPending || accounts.isLoading || state === null) return q.isError ? <LoadError error={q.error} onRetry={() => void q.refetch()} /> : <Loading what="Loading the budget" />;
  if (q.isError || !budget) return <LoadError error={q.error} onRetry={() => void q.refetch()} />;

  const periods = q.data.grid.periods;
  const readOnly = budget.status !== 'draft' || !budget.can.update;
  const changes = changedCells(q.data.grid.lines, state);
  const dirty = changes.length > 0;

  const run = async <T,>(work: () => Promise<T>, done?: (r: T) => void) => {
    setBusy(true);
    setError(null);
    try {
      const r = await work();
      slot.clear();
      done?.(r);
    } catch (err) {
      if (err instanceof ApiError && err.isVersionConflict) {
        setConflict({
          noun: 'budget', serverVersion: err.serverVersion, localVersion: budget.version,
          onReload: () => { setConflict(null); setLoadedFor(''); void q.refetch(); },
          onClose: () => setConflict(null),
        });
      } else setError(err);
    } finally {
      setBusy(false);
    }
  };

  const save = () => run(() => actions.saveLines(budget, changes, slot.for(`${budget.version}:${JSON.stringify(changes)}`)), () => toast.success('Budget saved.'));
  const approve = () => run(() => actions.approve(budget, slot.for(`approve:${budget.version}`)), () => toast.success('Budget approved. It is now read-only.'));
  const archive = () => run(() => actions.archive(budget, slot.for(`archive:${budget.version}`)), () => toast.success('Budget archived.'));
  const discard = () => {
    if (!window.confirm('Discard this draft and all its amounts?')) return;
    void run(() => actions.discard(budget, slot.for(`discard:${budget.version}`)), () => toast.success('Draft discarded.'));
  };
  const revise = () => run(() => actions.create({ name: `${budget.name} (revised)`, fiscal_year_id: budget.fiscal_year_id, copy_from_budget_id: budget.id }, slot.for(`revise:${budget.id}:${versions.length}`)), () => toast.success('A new draft was made from this version.'));

  const addRow = () => {
    if (!add.account) return;
    const key = rowKeyOf(add.account, add.dims);
    if (state.rows.some((r) => r.key === key)) {
      toast.message('That row is already in the grid.');
      return;
    }
    const row: GridRow = { key, accountId: add.account, dims: Object.fromEntries(Object.entries(add.dims).filter(([, v]) => v)) };
    setState({ ...state, rows: [...state.rows, row].sort((a, b) => codeOf(a.accountId).localeCompare(codeOf(b.accountId)) || a.key.localeCompare(b.key)) });
    setAdd({ account: '', dims: {} });
  };

  const copyIn = async () => {
    if (source === '') return;
    if (dirty && !window.confirm('Replace the amounts you have typed but not saved?')) return;
    const [kind, id] = source.split(':');
    await run(
      () => actions.suggestions(budget.id, kind === 'budget' ? { kind: 'budget', budgetId: id } : { kind: 'actuals', fiscalYearId: id }),
      (lines) => {
        setState(gridFromLines(lines, codeOf));
        setSource('');
        toast.success(lines.length === 0 ? 'Nothing to copy from there.' : `Copied ${lines.length} amounts into the grid. Review them, then Save.`);
      },
    );
  };

  return (
    <div className="flex flex-col gap-4" data-testid="budget-editor">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary">{budget.name} <Chip status={budget.status} /></h2>
          <p className="text-xs text-text-muted">{budget.fiscal_year?.name} · version {budget.revision} · amounts in {company.base_currency}, income and expense both positive</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a className={cn(secondary, 'inline-flex items-center gap-1.5')} href={budgetExportUrl(company.id, budget.id, 'csv')} download><Download className="size-3.5" /> CSV</a>
          <Link className={cn(secondary, 'inline-flex items-center gap-1.5')} to={`/${company.slug}/settings/import`}><Upload className="size-3.5" /> Import</Link>
          {budget.can.update && <button type="button" className={primary} disabled={!dirty || busy} onClick={() => void save()}>{busy ? 'Saving…' : dirty ? `Save ${changes.length} ${changes.length === 1 ? 'change' : 'changes'}` : 'Saved'}</button>}
          {budget.can.approve && <button type="button" className={primary} disabled={busy || dirty} title={dirty ? 'Save your changes first' : undefined} onClick={() => void approve()}>Approve</button>}
          {budget.can.archive && <button type="button" className={secondary} disabled={busy} onClick={() => void archive()}>Archive</button>}
          {budget.status !== 'draft' && <button type="button" className={secondary} disabled={busy} onClick={() => void revise()}>New draft from this version</button>}
          {budget.can.discard && <button type="button" className={secondary} disabled={busy} onClick={discard}>Discard draft</button>}
        </div>
      </div>

      {budget.status === 'approved' && <p role="status" className="rounded-lg border border-border bg-surface px-4 py-3 text-[13px] text-text-secondary">This version is approved and read-only. To change the plan, make a new draft from it; approving that draft archives this one.</p>}
      {budget.status === 'draft' && !budget.can.approve && budget.can.update && <p className="text-xs text-text-muted">A draft is approved by someone other than the person who made it.</p>}
      {error ? <p role="alert" className="text-[13px] text-danger">{describeError(error)}</p> : null}

      <BudgetGrid
        periods={periods} state={state} onChange={setState} readOnly={readOnly || busy} currency={company.base_currency}
        labels={{ account: nameOf, dims: dimLabel }} spread={(total) => actions.spread(budget.id, total)}
      />

      {!readOnly && (
        <section aria-label="Add and copy" className="flex flex-wrap items-end gap-6 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-text-muted">Add an account
              <select aria-label="Account to add" className={cn(field, 'w-64')} value={add.account} onChange={(e) => setAdd({ ...add, account: e.target.value })}>
                <option value="">Choose an income or expense account…</option>
                {pnl.map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
              </select>
            </label>
            {dimensions.data.filter((d) => d.is_active && d.values.some((v) => v.is_active)).map((d) => (
              <label key={d.id} className="flex flex-col gap-1 text-xs text-text-muted">{d.name}
                <select aria-label={d.name} className={cn(field, 'w-32')} value={add.dims[d.id] ?? ''} onChange={(e) => setAdd({ ...add, dims: { ...add.dims, [d.id]: e.target.value } })}>
                  <option value="">Any</option>
                  {d.values.filter((v) => v.is_active).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
            ))}
            <button type="button" className={secondary} disabled={!add.account} onClick={addRow}>Add row</button>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-xs text-text-muted">Copy amounts from
              <select aria-label="Copy amounts from" className={cn(field, 'w-72')} value={source} onChange={(e) => setSource(e.target.value)}>
                <option value="">Choose a source…</option>
                <optgroup label="Another version">
                  {versions.filter((b) => b.id !== budget.id).map((b) => <option key={b.id} value={`budget:${b.id}`}>{b.fiscal_year?.name} · {b.name} (version {b.revision})</option>)}
                </optgroup>
                <optgroup label="Actual results">
                  {(years.data ?? []).filter((y) => y.id !== budget.fiscal_year_id).map((y) => <option key={y.id} value={`actuals:${y.id}`}>Actuals of {y.name}</option>)}
                </optgroup>
              </select>
            </label>
            <button type="button" className={secondary} disabled={source === '' || busy} onClick={() => void copyIn()}>Copy into grid</button>
          </div>
          <p className="w-full text-xs text-text-muted">Tab and the arrow keys move between cells; Alt+Right fills a value across the year; paste a block from a spreadsheet into any cell. Nothing is kept until you save.</p>
        </section>
      )}
      <ConflictDialog conflict={conflict} />
    </div>
  );
};
