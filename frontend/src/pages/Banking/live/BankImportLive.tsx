import React, { useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, FileText } from 'lucide-react';
import { PageHeader } from '@/components/domain/PageHeader';
import { formatMoney, getCurrencyMinorUnits } from '@/lib/format';
import { useRouteCompany } from '@/data/session';
import { useBankAccounts, useBankingActions } from '@/data/banking';
import { IntentSlot } from '@/api/intentSlot';
import { describeError } from '@/api/messages';
import {
  COLUMN_FIELDS,
  DATE_FORMATS,
  DELIMITERS,
  bankingErrorText,
  describeImportWarning,
  detectDelimiter,
  sniffKind,
  emptyMapping,
  guessColumns,
  guessDateFormat,
  guessLocale,
  guessSign,
  importProblems,
  mappingProblem,
  parseAmountInput,
  peekCsv,
  toMappingBody,
  type ColumnField,
  type FileKind,
  type CsvMapping,
  type LiveBankAccount,
  type StatementImportResult,
} from '@/api/adapters/banking';
import { ErrorLine, LoadingLine } from '@/pages/Accounting/live/parts';
import { Field, Segmented, SimpleSelect, inputCls } from '../reconcile/shared';

type Kind = FileKind;

/** A saved mapping is offered only when every column it names exists in this file with its separator. */
function savedFits(m: CsvMapping, text: string): boolean {
  const pk = peekCsv(text, m);
  return Object.values(m.columns).every((c) => (m.has_header ? pk.headers.includes(c) : Number(c) < pk.headers.length));
}

const FIELD_LABEL: Record<ColumnField, string> = {
  date: 'Date',
  value_date: 'Value date',
  description: 'Description',
  reference: 'Reference',
  counterparty: 'Payee or payer',
  amount: 'Amount',
  debit: 'Money out (debit)',
  credit: 'Money in (credit)',
  balance: 'Running balance',
};
const REQUIRED: ColumnField[] = ['date', 'description'];

const primary = 'flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[13px] font-medium text-white transition hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50';
const secondary = 'flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-3 text-[13px] font-medium text-text-secondary hover:bg-surface-neutral';

/** Statement import: file, columns (CSV only), balances, then the server's result. The server reads and checks the file. */
export const BankImportLive: React.FC = () => {
  const company = useRouteCompany();
  const [params] = useSearchParams();
  const banks = useBankAccounts();
  const actions = useBankingActions();
  const slot = useRef(new IntentSlot()).current;

  const [accountPick, setAccountId] = useState(params.get('account') ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Kind>('csv');
  const [mapping, setMapping] = useState<CsvMapping>(emptyMapping());
  const [mappingFrom, setMappingFrom] = useState<'saved' | 'guess' | 'none'>('none');
  const [save, setSave] = useState(true);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [opening, setOpening] = useState('');
  const [closing, setClosing] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState<StatementImportResult | null>(null);

  const importable = useMemo(() => banks.data.filter((b) => b.is_active && b.can.import), [banks.data]);
  const accountId = accountPick || (importable.length === 1 ? importable[0].id : '');
  const bank: LiveBankAccount | undefined = importable.find((b) => b.id === accountId);
  const minorDigits = getCurrencyMinorUnits(bank?.currency ?? company.base_currency);

  const peek = useMemo(() => (kind === 'csv' ? peekCsv(text, mapping) : null), [kind, text, mapping]);

  // Columns the file offers: set a first guess (or the account's saved mapping) when the file or account changes.
  const prepare = (nextText: string, nextBank: LiveBankAccount | undefined) => {
    const delimiter = detectDelimiter(nextText);
    const saved = nextBank?.import_mapping ?? null;
    if (saved && savedFits(saved, nextText)) {
      setMapping(saved);
      setMappingFrom('saved');
      return;
    }
    const base: CsvMapping = { ...emptyMapping(), delimiter };
    const sample = peekCsv(nextText, base, 20);
    const cols = guessColumns(sample.headers, true);
    setMapping({ ...base, columns: cols, sign: guessSign(cols), locale: guessLocale(sample.rows, sample.headers, cols), date_format: guessDateFormat(sample.rows, sample.headers, cols) });
    setMappingFrom(Object.keys(cols).length ? 'guess' : 'none');
  };

  const onFile = async (f: File | null) => {
    setFile(f);
    setResult(null);
    setError(null);
    if (!f) {
      setText('');
      return;
    }
    const content = await f.text();
    setText(content);
    setKind(sniffKind(f.name, content));
    prepare(content, bank);
  };

  const onAccount = (id: string) => {
    setAccountId(id);
    setError(null);
    if (file && kind === 'csv') prepare(text, importable.find((b) => b.id === id));
  };

  const setCol = (f: ColumnField, v: string | undefined) => setMapping((m) => ({ ...m, columns: { ...m.columns, [f]: v ?? '' } }));
  const mappingIssue = kind === 'csv' ? mappingProblem(mapping) : null;
  const openingParsed = parseAmountInput(opening, minorDigits);
  const closingParsed = parseAmountInput(closing, minorDigits);
  const balancesOk = openingParsed.ok && closingParsed.ok;

  const submit = async () => {
    if (!file || !bank || !balancesOk) return;
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.append('file', file);
    form.append('format', kind);
    if (kind === 'csv') {
      form.append('mapping', JSON.stringify(toMappingBody(mapping)));
      form.append('save_mapping', save ? '1' : '0');
    }
    if (openingParsed.ok && openingParsed.minor !== null) form.append('opening_balance', String(openingParsed.minor));
    if (closingParsed.ok && closingParsed.minor !== null) form.append('closing_balance', String(closingParsed.minor));
    // Same file, account, mapping and balances = same intent, so pressing Import again after a network error cannot double-import.
    const intent = slot.for(JSON.stringify([bank.id, file.name, file.size, file.lastModified, kind, kind === 'csv' ? toMappingBody(mapping) : null, save, opening, closing]));
    try {
      setResult(await actions.importStatement(bank.id, form, intent));
      slot.clear();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setFile(null);
    setText('');
    setResult(null);
    setError(null);
    setStep(1);
    setOpening('');
    setClosing('');
  };

  const problems = importProblems(error);
  const steps = kind === 'csv' ? ['File', 'Columns', 'Balances and import'] : ['File', 'Balances and import'];
  const stepIndex = kind === 'csv' ? step : step === 3 ? 2 : 1;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        breadcrumb={[{ label: 'Bank & cash', to: `/${company.slug}/banking` }, { label: 'Import statement' }]}
        title="Import a bank statement"
        subtitle="CSV, OFX or CAMT.053. Lines already imported are skipped, so importing the same file twice adds nothing."
      />

      {banks.isLoading ? (
        <LoadingLine what="bank accounts" />
      ) : banks.error ? (
        <ErrorLine error={banks.error} onRetry={banks.refetch} />
      ) : importable.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-6 text-[13px] text-text-secondary">
          There is no bank account you can import into. <Link to={`/${company.slug}/banking`} className="text-accent hover:underline">Add one first</Link>.
        </p>
      ) : result ? (
        <ResultPanel result={result} bank={bank} slug={company.slug} baseCurrency={company.base_currency} onAnother={reset} />
      ) : (
        <div className="rounded-lg border border-border bg-surface">
          <ol className="flex flex-wrap gap-x-6 gap-y-1 border-b border-border px-5 py-3 text-xs">
            {steps.map((s, i) => (
              <li key={s} className={i + 1 === stepIndex ? 'font-semibold text-text-primary' : 'text-text-muted'} aria-current={i + 1 === stepIndex ? 'step' : undefined}>
                {i + 1}. {s}
              </li>
            ))}
          </ol>

          <div className="flex flex-col gap-4 p-5">
            {step === 1 && (
              <>
                <Field label="Import into">
                  <SimpleSelect aria-label="Bank account" allowNone={false} value={accountId} onChange={(v) => onAccount(v ?? '')} placeholder="Choose an account..." options={importable.map((b) => ({ value: b.id, label: `${b.name} (${b.currency})` }))} />
                </Field>
                <Field label="Statement file" hint="Up to 2 MB and 5,000 lines. The file is read once and not kept.">
                  <input type="file" accept=".csv,.ofx,.qfx,.xml,.txt,text/csv" aria-label="Statement file" onChange={(e) => void onFile(e.target.files?.[0] ?? null)} className="text-[13px] text-text-secondary file:mr-3 file:h-8 file:cursor-pointer file:rounded-md file:border file:border-border file:bg-surface file:px-3 file:text-[13px] file:font-medium" />
                </Field>
                {file && (
                  <p className="flex items-center gap-2 text-xs text-text-secondary">
                    <FileText className="size-4 text-text-muted" />
                    {file.name} · {kind === 'csv' ? 'CSV, columns to be chosen' : kind === 'ofx' ? 'OFX, columns are read from the file' : 'CAMT.053, columns are read from the file'}
                  </p>
                )}
                <div className="flex justify-end">
                  <button type="button" disabled={!file || !bank} onClick={() => setStep(kind === 'csv' ? 2 : 3)} className={primary}>
                    Continue
                  </button>
                </div>
              </>
            )}

            {step === 2 && peek && (
              <>
                {mappingFrom === 'saved' && <p className="text-xs text-text-muted">These choices were saved from the last import into {bank?.name}. Change anything that does not fit this file.</p>}
                {mappingFrom === 'guess' && <p className="text-xs text-text-muted">Columns, date and number style are guessed from the file. Check each one.</p>}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Field label="Separator">
                    <SimpleSelect aria-label="Separator" allowNone={false} value={mapping.delimiter} onChange={(v) => setMapping((m) => ({ ...m, delimiter: v ?? ',' }))} options={DELIMITERS} />
                  </Field>
                  <Field label="Date looks like">
                    <SimpleSelect aria-label="Date format" allowNone={false} value={mapping.date_format} onChange={(v) => setMapping((m) => ({ ...m, date_format: v ?? 'Y-m-d' }))} options={DATE_FORMATS} />
                  </Field>
                  <Field label="Numbers look like">
                    <SimpleSelect
                      aria-label="Number format"
                      allowNone={false}
                      value={mapping.locale}
                      onChange={(v) => setMapping((m) => ({ ...m, locale: (v ?? 'plain') as CsvMapping['locale'] }))}
                      options={[
                        { value: 'plain', label: '1234.56' },
                        { value: 'us', label: '1,234.56' },
                        { value: 'eu', label: '1.234,56' },
                      ]}
                    />
                  </Field>
                  <Field label="Rows to skip at the top">
                    <input className={inputCls} type="number" min={0} value={mapping.skip_rows} aria-label="Rows to skip" onChange={(e) => setMapping((m) => ({ ...m, skip_rows: Math.max(0, Math.floor(Number(e.target.value) || 0)) }))} />
                  </Field>
                </div>
                <label className="flex items-center gap-2 text-xs text-text-secondary">
                  <input type="checkbox" checked={mapping.has_header} onChange={(e) => setMapping((m) => ({ ...m, has_header: e.target.checked, columns: {} }))} />
                  The first row holds column names
                </label>

                <div>
                  <div className="mb-1 text-[11px] font-medium text-text-muted">Money in and out</div>
                  <Segmented
                    value={mapping.sign}
                    onChange={(v) => setMapping((m) => ({ ...m, sign: v as CsvMapping['sign'] }))}
                    options={[
                      { value: 'signed', label: 'One amount column, money out is negative' },
                      { value: 'inverted', label: 'One amount column, money out is positive' },
                      { value: 'columns', label: 'Separate in and out columns' },
                    ]}
                  />
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  {COLUMN_FIELDS.filter((f) => (mapping.sign === 'columns' ? f !== 'amount' : f !== 'debit' && f !== 'credit')).map((f) => (
                    <Field key={f} label={`${FIELD_LABEL[f]}${REQUIRED.includes(f) || f === 'amount' || f === 'debit' || f === 'credit' ? '' : ' (optional)'}`}>
                      <SimpleSelect
                        aria-label={FIELD_LABEL[f]}
                        value={mapping.columns[f] || undefined}
                        onChange={(v) => setCol(f, v)}
                        noneLabel="Not in the file"
                        placeholder="Choose a column..."
                        options={peek.headers.map((h, i) => ({ value: mapping.has_header ? h : String(i), label: h }))}
                      />
                    </Field>
                  ))}
                </div>
                {mapping.columns.balance && (
                  <Field label="Rows are listed">
                    <Segmented value={mapping.order} onChange={(v) => setMapping((m) => ({ ...m, order: v as 'asc' | 'desc' }))} options={[{ value: 'asc', label: 'Oldest first' }, { value: 'desc', label: 'Newest first' }]} />
                  </Field>
                )}

                <div>
                  <div className="mb-1 text-[11px] font-medium text-text-muted">First rows of the file, as written</div>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-left text-xs" data-testid="csv-preview">
                      <thead className="border-b border-border bg-surface-neutral text-[11px] font-semibold text-text-muted">
                        <tr>
                          {peek.headers.map((h, i) => (
                            <th key={i} className="whitespace-nowrap px-2.5 py-1.5">
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/60">
                        {peek.rows.map((r, i) => (
                          <tr key={i}>
                            {peek.headers.map((_, j) => (
                              <td key={j} className="whitespace-nowrap px-2.5 py-1.5 tabular-nums text-text-primary">
                                {r[j] ?? ''}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {mappingIssue && <p className="text-xs text-warning">{mappingIssue}</p>}
                <div className="flex justify-between">
                  <button type="button" onClick={() => setStep(1)} className={secondary}>
                    Back
                  </button>
                  <button type="button" disabled={Boolean(mappingIssue)} onClick={() => setStep(3)} className={primary}>
                    Continue
                  </button>
                </div>
              </>
            )}

            {step === 3 && bank && file && (
              <>
                <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                  <dt className="text-text-muted">Account</dt>
                  <dd className="text-text-primary">{bank.name} ({bank.currency})</dd>
                  <dt className="text-text-muted">File</dt>
                  <dd className="text-text-primary">{file.name}</dd>
                </dl>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Opening balance (optional)" hint="Only if the file does not state it.">
                    <input className={inputCls} inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} placeholder="e.g. 10,000.00" aria-label="Opening balance" />
                    {!openingParsed.ok && <span className="text-[11px] text-danger">Enter a plain amount with at most {minorDigits} decimals.</span>}
                  </Field>
                  <Field label="Closing balance (optional)" hint="Reconciling needs the statement's closing balance.">
                    <input className={inputCls} inputMode="decimal" value={closing} onChange={(e) => setClosing(e.target.value)} placeholder="e.g. 10,875.00" aria-label="Closing balance" />
                    {!closingParsed.ok && <span className="text-[11px] text-danger">Enter a plain amount with at most {minorDigits} decimals.</span>}
                  </Field>
                </div>
                {kind === 'csv' && (
                  <label className="flex items-center gap-2 text-xs text-text-secondary">
                    <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
                    Remember these column choices for {bank.name}
                  </label>
                )}
                {error != null && (
                  <div role="alert" className="rounded-md border border-danger/30 bg-danger-soft/40 p-3 text-[13px] text-danger">
                    <p>{bankingErrorText(error, describeError)}</p>
                    {problems.length > 0 && (
                      <ul className="mt-1.5 list-disc pl-5 text-xs" data-testid="import-problems">
                        {problems.slice(0, 20).map((p) => (
                          <li key={p}>{p}</li>
                        ))}
                        {problems.length > 20 && <li>and {problems.length - 20} more.</li>}
                      </ul>
                    )}
                    <p className="mt-1.5 text-xs text-text-secondary">Nothing was imported.</p>
                  </div>
                )}
                <div className="flex justify-between">
                  <button type="button" disabled={busy} onClick={() => setStep(kind === 'csv' ? 2 : 1)} className={secondary}>
                    Back
                  </button>
                  <button type="button" disabled={busy || !balancesOk} onClick={() => void submit()} className={primary}>
                    {busy ? 'Importing…' : 'Import statement'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

const ResultPanel: React.FC<{ result: StatementImportResult; bank: LiveBankAccount | undefined; slug: string; baseCurrency: string; onAnother: () => void }> = ({ result, bank, slug, baseCurrency, onAnother }) => (
  <div className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5" data-testid="import-result">
    <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
      <CheckCircle2 className="size-5 text-success" />
      {result.already_imported ? 'This file was already imported' : result.lines_imported === 0 ? 'No new lines in this file' : 'Statement imported'}
    </div>
    <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-[13px]">
      <dt className="text-text-muted">New lines</dt>
      <dd className="tabular-nums text-text-primary">{result.lines_imported}</dd>
      <dt className="text-text-muted">Skipped as already imported</dt>
      <dd className="tabular-nums text-text-primary">{result.duplicate_lines_skipped}</dd>
      {result.statement && (
        <>
          <dt className="text-text-muted">Period</dt>
          <dd className="tabular-nums text-text-primary">
            {result.statement.period_from} to {result.statement.period_to}
          </dd>
          <dt className="text-text-muted">Closing balance</dt>
          <dd className="tabular-nums text-text-primary">{result.statement.closing_balance === null ? 'not stated' : formatMoney(result.statement.closing_balance, bank?.currency ?? baseCurrency)}</dd>
        </>
      )}
    </dl>
    {(result.already_imported || result.lines_imported === 0) && <p className="text-xs text-text-muted">Every line in the file was already on record, so nothing was added.</p>}
    {result.warnings.map((w) => (
      <p key={w} className="text-xs text-warning">
        {describeImportWarning(w)}
      </p>
    ))}
    <div className="flex gap-2">
      {bank && (
        <Link to={`/${slug}/banking/${bank.id}/reconcile`} className={primary}>
          Reconcile {bank.name}
        </Link>
      )}
      <button type="button" onClick={onAnother} className={secondary}>
        Import another file
      </button>
    </div>
  </div>
);
