/**
 * Import data, live (step 3c.1). Four steps on the server's own state: upload a CSV or XLSX, match its columns, check every
 * row (nothing is written to the books), then apply on the queue and watch it finish. Which step you are on follows the
 * import's status, so a reload or a click in "Recent imports" lands where you left off.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CheckCircle2, ChevronRight, FileText, Loader2, RefreshCw, ShieldCheck, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/domain/PageHeader';
import { SignDialog } from '@/components/domain/SignDialog';
import { WizardStepper } from '@/pages/Onboarding/WizardStepper';
import { Field, SimpleSelect, inputCls } from '@/pages/Banking/reconcile/shared';
import { ErrorLine, LoadingLine } from '@/pages/Accounting/live/parts';
import { IntentSlot } from '@/api/intentSlot';
import { ApiError } from '@/api/errors';
import { DATE_FORMATS } from '@/api/adapters/banking';
import {
  KIND_INFO, KIND_ORDER, NUMBER_LOCALES, ROW_STATUS_LABEL, STATUS_LABEL, applyBlocker, cleanOptions, importErrorText, initialColumns, isKnownKind, isWorking,
  missingUploadOptions, progressOf, rowProblems, stepFor, toMappingBody, unmappedRequired, type ApiImport, type ColumnPick, type ImportKindKey, type ImportOptions,
} from '@/api/adapters/imports';
import { useRouteCompany } from '@/data/session';
import { useBankAccounts } from '@/data/banking';
import { useImport, useImportActions, useImportKinds, useImportRows, useRecentImports } from '@/data/imports';
import { isSigningCancelled, useSignedRun } from '@/data/signing';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

const primary = 'flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-neutral disabled:cursor-not-allowed disabled:opacity-50';
const card = 'flex flex-col gap-6 rounded-lg border border-border bg-surface p-7';

const STEPS = [{ title: 'Choose file' }, { title: 'Match columns' }, { title: 'Check data' }, { title: 'Done' }];

export const ImportLive: React.FC = () => {
  const company = useRouteCompany();
  const [params, setParams] = useSearchParams();
  const importId = params.get('import') ?? undefined;
  const imp = useImport(importId);
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);

  // An import opened from the address or the list lands on the step its status belongs to.
  const openedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (imp.data && openedFor.current !== imp.data.id) {
      openedFor.current = imp.data.id;
      setStep(stepFor(imp.data.status));
    }
  }, [imp.data]);

  const open = (id: string | undefined) => {
    const next = new URLSearchParams(params);
    if (id) next.set('import', id);
    else next.delete('import');
    setParams(next, { replace: true });
  };
  const restart = () => {
    openedFor.current = undefined;
    setStep(1);
    open(undefined);
  };
  const created = (i: ApiImport) => {
    openedFor.current = i.id;
    setStep(stepFor(i.status));
    open(i.id);
  };

  const current = imp.data;
  const loadingOpened = Boolean(importId) && imp.isLoading;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <PageHeader
        breadcrumb={[{ label: 'Settings', to: `/${company.slug}/settings` }, { label: 'Import data' }]}
        title="Import data"
        subtitle="Bring in customers, accounts, balances, invoices or bank lines from a spreadsheet. Every row is checked first, and nothing is saved until you confirm."
      />
      <div className="rounded-lg border border-border bg-surface px-6 pb-4 pt-5">
        <WizardStepper steps={STEPS} current={step} onSelect={(n) => step < 4 && n < step && setStep(n as 1 | 2 | 3 | 4)} />
      </div>

      {loadingOpened ? (
        <LoadingLine what="the import" />
      ) : importId && imp.error ? (
        <div className={card}>
          <ErrorLine error={imp.error} onRetry={() => void imp.refetch()} />
          <div><button type="button" onClick={restart} className={secondary}>Start a new import</button></div>
        </div>
      ) : step === 1 || !current ? (
        <ChooseStep onCreated={created} />
      ) : step === 2 ? (
        <MapStep imp={current} onBack={restart} onChecked={() => setStep(3)} />
      ) : step === 3 ? (
        <CheckStep imp={current} onBack={() => setStep(2)} onApplied={() => setStep(4)} />
      ) : (
        <DoneStep imp={current} slug={company.slug} onAnother={restart} />
      )}

      {step !== 4 && <RecentImports activeId={importId} onOpen={open} />}
    </div>
  );
};

/* ------------------------------------------------------------------------------------------------ step 1 */

const ChooseStep: React.FC<{ onCreated: (i: ApiImport) => void }> = ({ onCreated }) => {
  const company = useRouteCompany();
  const kinds = useImportKinds();
  const banks = useBankAccounts();
  const actions = useImportActions();
  const slot = useRef(new IntentSlot()).current;
  const [kind, setKind] = useState<ImportKindKey>('contacts');
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [options, setOptions] = useState<ImportOptions>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const available = useMemo(() => {
    const keys = new Set((kinds.data ?? []).map((k) => k.kind));
    return KIND_ORDER.filter((k) => keys.has(k));
  }, [kinds.data]);
  const bankChoices = banks.data.filter((b) => b.is_active && b.can.import);
  const missing = missingUploadOptions(kind, options);

  const pickKind = (k: ImportKindKey) => {
    setKind(k);
    setOptions({});
    setError(null);
  };
  const setOption = (key: string, value: string) => setOptions((o) => ({ ...o, [key]: value }));
  const take = (f: File | null | undefined) => {
    if (!f) return;
    setFile(f);
    setError(null);
  };

  const submit = async () => {
    if (!file || missing.length) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('kind', kind);
    form.append('file', file);
    for (const [k, v] of Object.entries(cleanOptions(options))) form.append(`options[${k}]`, String(v));
    const intent = slot.for(JSON.stringify([kind, file.name, file.size, file.lastModified, cleanOptions(options)]));
    try {
      const created = await actions.upload(form, intent);
      slot.clear();
      onCreated(created);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  if (kinds.isLoading) return <LoadingLine what="what can be imported" />;
  if (kinds.error) {
    const forbidden = kinds.error instanceof ApiError && kinds.error.status === 403;
    return forbidden ? (
      <p role="alert" className={cn(card, 'text-[13px] text-text-secondary')}>Your role cannot import data. Ask an owner or an administrator to give you access, or to run the import.</p>
    ) : (
      <ErrorLine error={kinds.error} onRetry={() => void kinds.refetch()} />
    );
  }

  return (
    <div className={card}>
      <div>
        <h2 className="mb-1 text-sm font-semibold text-text-primary">What do you want to import?</h2>
        <p className="text-[13px] text-text-muted">Choose the kind of data to add to {company.name}.</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Kind of data">
        {available.map((k) => {
          const on = kind === k;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => pickKind(k)}
              className={cn('cursor-pointer rounded-lg border p-4 text-left transition', on ? 'border-accent bg-surface-neutral' : 'border-border bg-surface hover:border-border-strong')}
            >
              <div className="text-[13px] font-semibold text-text-primary">{KIND_INFO[k].title}</div>
              <div className="mt-0.5 text-xs text-text-muted">{KIND_INFO[k].desc}</div>
            </button>
          );
        })}
      </div>

      {kind === 'opening_balances' && (
        <Field label="Balances as of" hint="The date the opening journal is posted on. It must fall in an open period.">
          <input type="date" aria-label="As of date" className={cn(inputCls, 'max-w-48')} value={String(options.as_of ?? '')} onChange={(e) => setOption('as_of', e.target.value)} />
        </Field>
      )}
      {kind === 'bank_lines' && (
        <Field label="Import into" hint="The bank or cash account these lines belong to.">
          {bankChoices.length === 0 && !banks.isLoading ? (
            <p className="text-[13px] text-text-secondary">There is no bank account you can import into. <Link to={`/${company.slug}/banking`} className="text-accent hover:underline">Add one first</Link>.</p>
          ) : (
            <SimpleSelect aria-label="Bank account" allowNone={false} value={String(options.bank_account_id ?? '') || undefined} onChange={(v) => setOption('bank_account_id', v ?? '')} placeholder="Choose an account..." options={bankChoices.map((b) => ({ value: b.id, label: `${b.name} (${b.currency})` }))} />
          )}
        </Field>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files?.[0]); }}
        className={cn('flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-8 transition', dragging ? 'border-accent bg-surface-neutral' : 'border-border bg-surface hover:border-border-strong')}
      >
        <Upload className="size-5 text-text-muted" />
        <label className="cursor-pointer text-center">
          <span className="text-[13px] font-semibold text-text-primary">Drop a CSV or Excel file here, or <span className="text-accent underline">browse</span></span>
          <input type="file" aria-label="File to import" accept=".csv,.xlsx,.txt,text/csv" className="sr-only" onChange={(e) => take(e.target.files?.[0])} />
        </label>
        <p className="text-xs text-text-muted">The first row holds the column names. The file is read once; only its rows are kept, and you can clear them afterwards.</p>
        {file && (
          <span className="inline-flex items-center gap-1.5 rounded-[3px] bg-surface-neutral px-2.5 py-0.5 text-xs font-medium text-text-primary">
            <FileText className="size-3.5" />
            {file.name}
          </span>
        )}
      </div>

      {error != null && (
        <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft/40 p-3 text-[13px] text-danger">
          {importErrorText(error)} Nothing was imported.
        </p>
      )}

      <div className="flex justify-end border-t border-border pt-4">
        <button type="button" disabled={!file || missing.length > 0 || busy} onClick={() => void submit()} className={primary}>
          <span>{busy ? 'Reading the file…' : 'Continue'}</span>
          {!busy && <ChevronRight className="size-3.5" />}
        </button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------------------------------------ step 2 */

const MapStep: React.FC<{ imp: ApiImport; onBack: () => void; onChecked: () => void }> = ({ imp, onBack, onChecked }) => {
  const actions = useImportActions();
  const mapSlot = useRef(new IntentSlot()).current;
  const previewSlot = useRef(new IntentSlot()).current;
  const start = useMemo(() => initialColumns(imp), [imp.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [columns, setColumns] = useState<ColumnPick>(start.columns);
  const [options, setOptions] = useState<ImportOptions>(imp.options);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const first = useImportRows(imp.id, undefined, imp.rows_purged_at === null);
  const sample = first.data?.pages[0]?.data[0]?.cells;

  const missing = unmappedRequired(imp.fields, columns);
  const pick = (key: string, v: string | undefined) => setColumns((c) => ({ ...c, [key]: v ?? '' }));

  const submit = async () => {
    setBusy(true);
    setError(null);
    const body = toMappingBody(imp.version, columns, {}, options);
    try {
      const mapped = await actions.setMapping(imp.id, body, mapSlot.for(JSON.stringify(body)));
      mapSlot.clear();
      await actions.preview(mapped.id, previewSlot.for(`${mapped.id}:${mapped.version}`));
      previewSlot.clear();
      onChecked();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={card}>
      <div>
        <h2 className="mb-1 text-sm font-semibold text-text-primary">Match your columns</h2>
        <p className="text-[13px] text-text-muted">
          {imp.source_name} has {imp.rows_total.toLocaleString('en-US')} {imp.rows_total === 1 ? 'row' : 'rows'}.{' '}
          {start.from === 'saved' && 'These choices are the ones already set for this file.'}
          {start.from === 'guess' && (imp.suggestion_source === 'last_used' ? 'These are the columns you used last time. Check each one.' : 'We guessed these from the column names. Check each one.')}
          {start.from === 'none' && 'Choose which column in your file holds each piece of information.'}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-[13px]">
          <thead className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            <tr>
              <th className="px-4 py-2 text-left">Ledgerly field</th>
              <th className="px-4 py-2 text-left">Column in your file</th>
              <th className="px-4 py-2 text-left">Example (row 1)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {imp.fields.map((f) => {
              const col = columns[f.key];
              return (
                <tr key={f.key}>
                  <td className="px-4 py-2.5 align-top">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-text-primary">{f.label}</span>
                      {f.required && <span className="rounded-[3px] border border-danger/30 bg-danger-soft px-1.5 py-0.5 text-[10px] font-medium text-danger">Required</span>}
                    </div>
                    {f.note && <div className="mt-0.5 text-[11px] text-text-muted">{f.note}</div>}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <SimpleSelect aria-label={f.label} value={col || undefined} onChange={(v) => pick(f.key, v)} noneLabel={f.required ? 'Choose a column...' : 'Not in the file'} placeholder="Choose a column..." options={imp.columns.map((c) => ({ value: c, label: c }))} />
                  </td>
                  <td className="px-4 py-2.5 align-top font-mono text-[11px] text-text-muted">{col && sample ? (sample[col] ?? '') || '—' : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="-mt-3 text-[11px] text-text-muted">A field with no column is left empty, or filled in by the rule written under it.</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Dates in your file look like">
          <SimpleSelect aria-label="Date format" allowNone={false} value={String(options.date_format ?? 'Y-m-d')} onChange={(v) => setOptions((o) => ({ ...o, date_format: v ?? 'Y-m-d' }))} options={DATE_FORMATS} />
        </Field>
        <Field label="Numbers in your file look like">
          <SimpleSelect aria-label="Number format" allowNone={false} value={String(options.number_locale ?? 'plain')} onChange={(v) => setOptions((o) => ({ ...o, number_locale: v ?? 'plain' }))} options={NUMBER_LOCALES} />
        </Field>
      </div>

      {missing.length > 0 && <p className="text-xs text-warning">Still to match: {missing.map((f) => f.label).join(', ')}.</p>}
      {error != null && <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft/40 p-3 text-[13px] text-danger">{importErrorText(error)}</p>}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <button type="button" onClick={onBack} disabled={busy} className={secondary}><ArrowLeft className="size-3.5" />Choose another file</button>
        <button type="button" disabled={missing.length > 0 || busy} onClick={() => void submit()} className={primary}>
          <span>{busy ? 'Checking…' : 'Check my data'}</span>
          {!busy && <ChevronRight className="size-3.5" />}
        </button>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------------------------------------ step 3 */

const CheckStep: React.FC<{ imp: ApiImport; onBack: () => void; onApplied: () => void }> = ({ imp, onBack, onApplied }) => {
  const actions = useImportActions();
  const slot = useRef(new IntentSlot()).current;
  const { run, signProps } = useSignedRun();
  const [only, setOnly] = useState<'invalid' | undefined>(imp.rows_invalid > 0 ? 'invalid' : undefined);
  const rows = useImportRows(imp.id, only);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const blocker = applyBlocker(imp);
  const list = rows.data?.pages.flatMap((p) => p.data) ?? [];

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      await run(() => actions.apply(imp.id, slot.for(`${imp.id}:${imp.version}`)));
      slot.clear();
      onApplied();
    } catch (e) {
      if (!isSigningCancelled(e)) setError(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={card}>
      <div>
        <h2 className="mb-1 text-sm font-semibold text-text-primary">Check your data</h2>
        <p className="text-[13px] text-text-muted">This is a preview. Nothing has been saved yet.</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-[3px] bg-surface-neutral px-3 py-1 text-[13px] font-medium text-text-primary">{imp.rows_total} {imp.rows_total === 1 ? 'row' : 'rows'} checked</span>
        <span className="inline-flex items-center gap-1.5 rounded-[3px] bg-success-soft px-3 py-1 text-[13px] font-medium text-success"><CheckCircle2 className="size-3.5" />{imp.rows_valid} ready to import</span>
        <span className={cn('inline-flex items-center gap-1.5 rounded-[3px] px-3 py-1 text-[13px] font-medium', imp.rows_invalid ? 'bg-danger-soft text-danger' : 'bg-surface-neutral text-text-muted')}><AlertCircle className="size-3.5" />{imp.rows_invalid} need fixing</span>
      </div>

      {imp.errors.length > 0 && (
        <ul role="alert" className="list-disc rounded-md border border-danger/30 bg-danger-soft/40 p-3 pl-8 text-[13px] text-danger">
          {imp.errors.map((e) => <li key={e.code + e.message}>{e.message}</li>)}
        </ul>
      )}

      <div>
        <div className="mb-2 flex items-center gap-1 text-xs">
          {[{ v: undefined, l: 'All rows' }, { v: 'invalid' as const, l: 'Need fixing' }].map((t) => (
            <button key={t.l} type="button" onClick={() => setOnly(t.v)} aria-pressed={only === t.v} className={cn('h-7 cursor-pointer rounded-md px-2.5 font-medium', only === t.v ? 'bg-surface-neutral text-text-primary' : 'text-text-muted hover:text-text-primary')}>{t.l}</button>
          ))}
        </div>
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[13px]" data-testid="import-rows">
            <thead className="border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase tracking-wide text-text-muted">
              <tr><th className="px-3 py-2 text-left">Row</th><th className="px-3 py-2 text-left">Result</th><th className="px-3 py-2 text-left">What was read</th><th className="px-3 py-2 text-left">Notes</th></tr>
            </thead>
            <tbody className="divide-y divide-border">
              {list.map((r) => {
                const bad = r.status === 'invalid' || r.status === 'failed';
                const problems = rowProblems(r, imp.fields);
                const cells = Object.values(r.cells).filter(Boolean).slice(0, 4).join(' · ');
                return (
                  <tr key={r.id} className={bad ? 'bg-danger-soft/30' : undefined}>
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-text-muted">#{r.row_number}</td>
                    <td className="px-3 py-2">
                      <span className={cn('inline-flex items-center gap-1 text-[11px] font-semibold', bad ? 'text-danger' : 'text-success')}>
                        {bad ? <AlertCircle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}{ROW_STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </td>
                    <td className="max-w-[16rem] truncate px-3 py-2 font-mono text-[11px] text-text-secondary" title={cells}>{cells || '—'}</td>
                    <td className="px-3 py-2 text-[11px]">
                      {problems.length === 0 ? <span className="text-text-muted">All checks passed</span> : problems.map((p, i) => <div key={i} className="font-medium text-danger">{p.field ? `${p.field}: ` : ''}{p.text}</div>)}
                    </td>
                  </tr>
                );
              })}
              {rows.isLoading && <tr><td colSpan={4} className="px-3 py-4 text-xs text-text-muted">Loading rows…</td></tr>}
              {!rows.isLoading && list.length === 0 && <tr><td colSpan={4} className="px-3 py-4 text-xs text-text-muted">{only ? 'No row needs fixing.' : 'No rows.'}</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11px] text-text-muted">Row numbers are the ones in your spreadsheet, where the column names are row 1.</p>
        {rows.hasNextPage && <button type="button" onClick={() => void rows.fetchNextPage()} disabled={rows.isFetchingNextPage} className={cn(secondary, 'mt-2')}>{rows.isFetchingNextPage ? 'Loading…' : 'Show more rows'}</button>}
      </div>

      <div className="flex items-start gap-2 rounded border border-border bg-surface-neutral p-3 text-[11px] text-text-secondary">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-text-muted" />
        <span>
          {imp.all_or_nothing
            ? 'This kind goes in whole or not at all. If any row needs fixing, correct the file and upload it again.'
            : <>Rows that need fixing are skipped. You can import the <strong>{imp.rows_valid} ready</strong> rows now, correct the others in your file and import it again.</>}
          {imp.needs_signature && ' It posts to your ledger, so your signing PIN is asked for.'}
        </span>
      </div>

      {error != null && <p role="alert" className="rounded-md border border-danger/30 bg-danger-soft/40 p-3 text-[13px] text-danger">{importErrorText(error)}</p>}

      <div className="flex items-center justify-between border-t border-border pt-4">
        <button type="button" onClick={onBack} disabled={busy} className={secondary}><ArrowLeft className="size-3.5" />Back</button>
        <div className="flex items-center gap-3">
          {blocker && <span className="text-xs text-text-muted">{blocker}</span>}
          <button type="button" disabled={Boolean(blocker) || busy} onClick={() => void apply()} className={primary}>
            <span>{busy ? 'Starting…' : `Import ${imp.rows_valid} ${imp.rows_valid === 1 ? 'row' : 'rows'}`}</span>
            {!busy && <ChevronRight className="size-3.5" />}
          </button>
        </div>
      </div>

      <SignDialog
        {...signProps}
        documentTitle="Opening balances import"
        documentNumber={imp.source_name ?? undefined}
        actionTitle="Sign and import"
        consequenceText={`Posts one opening-balance journal from ${imp.rows_valid} rows to your ledger. A posted journal cannot be changed, only reversed.`}
      />
    </div>
  );
};

/* ------------------------------------------------------------------------------------------------ step 4 */

const DoneStep: React.FC<{ imp: ApiImport; slug: string; onAnother: () => void }> = ({ imp, slug, onAnother }) => {
  const actions = useImportActions();
  const slot = useRef(new IntentSlot()).current;
  const working = isWorking(imp.status);
  const failedRows = useImportRows(imp.id, 'failed', imp.status === 'completed' && imp.rows_failed > 0);
  const [busy, setBusy] = useState(false);
  const info = isKnownKind(imp.kind) ? KIND_INFO[imp.kind] : null;
  const done = imp.status === 'completed';
  const pct = progressOf(imp);

  const purge = async () => {
    setBusy(true);
    try {
      await actions.purge(imp.id, slot.for(imp.id));
      slot.clear();
      toast.success('The stored file contents were cleared.');
    } catch (e) {
      toast.error(importErrorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5 rounded-lg border border-border bg-surface p-10" data-testid="import-done">
      <div className="flex flex-col items-center gap-3 text-center">
        {working ? <Loader2 className="size-6 animate-spin text-text-muted" /> : done ? <CheckCircle2 className="size-6 text-success" /> : <AlertCircle className="size-6 text-danger" />}
        <h2 className="text-xl font-semibold text-text-primary">{working ? (imp.status === 'queued' ? 'Waiting to import' : 'Importing') : done ? 'Import finished' : 'Nothing was imported'}</h2>
        <p role="status" className="max-w-md text-[13px] text-text-muted">
          {working && `${imp.source_name} is being imported in the background${pct === null ? '' : `, ${pct}% done`}. You can leave this page; the import carries on.`}
          {done && `${imp.rows_applied} of ${imp.rows_valid} ready ${imp.rows_valid === 1 ? 'row was' : 'rows were'} imported${imp.rows_failed ? `; ${imp.rows_failed} could not be saved` : ''}. It is recorded in the activity log.`}
          {imp.status === 'failed' && 'This kind goes in whole or not at all, and the server refused it. The books are unchanged.'}
        </p>
        {imp.status === 'failed' && imp.errors.map((e) => <p key={e.code + e.message} role="alert" className="max-w-md text-[13px] text-danger">{e.message}</p>)}
      </div>

      {done && imp.rows_failed > 0 && (
        <div className="rounded-lg border border-border">
          <div className="border-b border-border bg-surface-neutral px-4 py-2 text-xs font-semibold text-text-primary">Rows that could not be saved</div>
          <ul className="divide-y divide-border text-[13px]">
            {(failedRows.data?.pages.flatMap((p) => p.data) ?? []).map((r) => (
              <li key={r.id} className="flex gap-3 px-4 py-2"><span className="font-mono text-xs font-semibold text-text-muted">#{r.row_number}</span><span className="text-danger">{rowProblems(r, imp.fields).map((p) => p.text).join(' ') || 'Refused'}</span></li>
            ))}
            {failedRows.isLoading && <li className="px-4 py-2 text-xs text-text-muted">Loading…</li>}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        {done && info && <Link to={`/${slug}/${info.after.to}`} className={primary}>{info.after.label}</Link>}
        {!working && <button type="button" onClick={onAnother} className={secondary}><RefreshCw className="size-3.5" />Import another file</button>}
        {!working && imp.rows_purged_at === null && imp.can.purge !== false && (
          <button type="button" disabled={busy} onClick={() => void purge()} className={secondary}>Clear stored file contents</button>
        )}
      </div>
      {imp.rows_purged_at && <p className="text-center text-[11px] text-text-muted">The file contents were cleared on {formatDateTime(imp.rows_purged_at)}. Row results are kept.</p>}
    </div>
  );
};

/* ------------------------------------------------------------------------------------------------ recent */

const RecentImports: React.FC<{ activeId: string | undefined; onOpen: (id: string) => void }> = ({ activeId, onOpen }) => {
  const recent = useRecentImports();
  const list = recent.data ?? [];
  if (recent.isLoading || recent.error || list.length === 0) return null;
  return (
    <section aria-label="Recent imports" className="rounded-lg border border-border bg-surface">
      <h2 className="border-b border-border px-5 py-3 text-sm font-semibold text-text-primary">Recent imports</h2>
      <ul className="divide-y divide-border">
        {list.map((i) => (
          <li key={i.id}>
            <button type="button" onClick={() => onOpen(i.id)} className={cn('flex w-full cursor-pointer items-center justify-between gap-4 px-5 py-2.5 text-left text-[13px] hover:bg-surface-neutral', i.id === activeId && 'bg-surface-neutral')}>
              <span className="min-w-0">
                <span className="block truncate font-medium text-text-primary">{i.source_name ?? 'File'}</span>
                <span className="text-xs text-text-muted">{isKnownKind(i.kind) ? KIND_INFO[i.kind].title : i.kind} · {formatDateTime(i.created_at)}</span>
              </span>
              <span className="shrink-0 text-xs text-text-secondary">{STATUS_LABEL[i.status] ?? i.status}{i.status === 'completed' ? ` · ${i.rows_applied} imported` : ''}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
};
