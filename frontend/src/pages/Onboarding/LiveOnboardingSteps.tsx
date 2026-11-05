/** The working steps of the live onboarding wizard: chart, opening balances, tax codes, team. */
import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { fiscalYearStart, localDateISO, orderTemplates } from '@/api/adapters/onboarding';
import { fractionToPercent, TAX_KINDS, toTaxCodeBody, type TaxCodeForm } from '@/api/adapters/tax';
import { ApiError } from '@/api/errors';
import { fieldError } from '@/api/messages';
import type { Company } from '@/types';
import { useApplyChartTemplate, useChartTemplates, useCreateTaxCode, useTaxCodes } from '@/data/setup';
import { useInvitations } from '@/data/team';
import { useAccess } from '@/data/menu';
import { Field, FormError, LoadError, Loading, field, primary, secondary } from '@/components/live/form';
import { InviteForm } from '@/pages/Settings/live/InviteForm';

const Actions: React.FC<{ children: React.ReactNode }> = ({ children }) => <div className="mt-6 flex items-center justify-between gap-3">{children}</div>;

export const ChartStep: React.FC<{ company: Company; done: boolean; onNext: () => void; onSkip: () => void }> = ({ company, done, onNext, onSkip }) => {
  const templates = useChartTemplates(company.id, !done);
  const apply = useApplyChartTemplate(company.id);
  const [picked, setPicked] = useState<string | null>(null);

  if (done) {
    return (
      <>
        <p role="status" className="text-[13px] text-text-secondary">Your chart of accounts is already set up.</p>
        <Actions>
          <Link to={`/${company.slug}/accounts`} className="text-[13px] text-accent hover:underline">View the chart of accounts</Link>
          <button type="button" onClick={onNext} className={primary}>Continue</button>
        </Actions>
      </>
    );
  }
  if (templates.isPending) return <Loading what="Loading account lists" />;
  if (templates.isError) {
    return (
      <>
        <LoadError error={templates.error} onRetry={() => void templates.refetch()} />
        <Actions><button type="button" onClick={onSkip} className={secondary}>Skip for now</button><span /></Actions>
      </>
    );
  }
  const list = orderTemplates(templates.data, company.country);
  const chosen = picked ?? list[0]?.code ?? null;

  return (
    <>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Account list</legend>
        {list.length === 0 && <p className="text-[13px] text-text-muted">No ready-made lists are available. You can start with an empty chart.</p>}
        {list.map((t) => (
          <label key={t.code} className={`flex cursor-pointer items-start gap-3 rounded-md border px-4 py-3 ${chosen === t.code ? 'border-accent bg-accent/5' : 'border-border'}`}>
            <input type="radio" name="template" className="mt-1" checked={chosen === t.code} onChange={() => setPicked(t.code)} />
            <span className="flex-1">
              <span className="block text-[13px] font-medium text-text-primary">
                {t.name}
                {t.recommended && <span className="ml-2 rounded-[3px] border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-[11px] font-medium text-accent">Recommended</span>}
              </span>
              <span className="block text-xs text-text-muted">{t.standard} · {t.account_count} accounts{t.country ? ` · ${t.country}` : ''}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="mt-3 text-xs text-text-muted">The full list of accounts appears under Chart of accounts once you use a list; you can add, rename and switch off accounts there.</p>
      <FormError error={apply.error} />
      <Actions>
        <button type="button" onClick={onSkip} disabled={apply.isPending} className={secondary}>Skip: start with an empty chart</button>
        <button
          type="button"
          disabled={!chosen || apply.isPending}
          onClick={() => chosen && apply.mutate(chosen, { onSuccess: (r) => { toast.success(`${r.accounts_created} accounts added.`); onNext(); } })}
          className={primary}
        >
          {apply.isPending ? 'Adding accounts…' : 'Use this list'}
        </button>
      </Actions>
    </>
  );
};

export const OpeningStep: React.FC<{ onNext: () => void }> = ({ onNext }) => (
  <>
    <div className="rounded-md border border-border bg-canvas px-4 py-3 text-[13px] text-text-secondary">
      <p className="font-medium text-text-primary">Start fresh</p>
      <p className="mt-1">Begin with empty books from today. Loading opening balances from a trial balance file is not available in this setup yet.</p>
    </div>
    <Actions><span /><button type="button" onClick={onNext} className={primary}>Start fresh and continue</button></Actions>
  </>
);

export const TaxStep: React.FC<{ company: Company; onNext: () => void; onSkip: () => void }> = ({ company, onNext, onSkip }) => {
  const codes = useTaxCodes(company.id);
  const create = useCreateTaxCode(company.id);
  const [form, setForm] = useState<TaxCodeForm>({
    code: '', name: '', kind: 'vat', percent: '', effectiveFrom: fiscalYearStart(company.fiscal_year_start_month, localDateISO()),
  });
  const [localError, setLocalError] = useState<{ field: string; message: string } | null>(null);
  const set = <K extends keyof TaxCodeForm>(k: K, v: TaxCodeForm[K]) => setForm({ ...form, [k]: v });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const out = toTaxCodeBody(form);
    if ('field' in out) {
      setLocalError(out);
      return;
    }
    setLocalError(null);
    create.mutate(out.body, { onSuccess: () => setForm({ ...form, code: '', name: '', percent: '' }) });
  };
  const err = (f: string) => (localError?.field === f ? localError.message : fieldError(create.error, f === 'percent' ? 'rate' : f));
  const known = ['code', 'name', 'kind', 'rate', 'effective_from'].some((f) => fieldError(create.error, f)) || (create.error instanceof ApiError && create.error.code === 'tax_code_exists');
  const hasCodes = (codes.data?.length ?? 0) > 0;

  return (
    <>
      <p className="mb-4 text-[13px] text-text-secondary">There is no ready-made tax list for {company.country}, so add the codes you use. Rates are percentages.</p>
      {codes.isPending ? <Loading what="Loading tax codes" /> : codes.isError ? <LoadError error={codes.error} onRetry={() => void codes.refetch()} /> : hasCodes && (
        <ul className="mb-5 divide-y divide-border rounded-md border border-border" aria-label="Tax codes">
          {codes.data.map((c) => (
            <li key={c.id} data-tax-code={c.code} className="flex items-center justify-between px-4 py-2 text-[13px]">
              <span><span className="font-medium text-text-primary">{c.code}</span> <span className="text-text-muted">{c.name}</span></span>
              <span className="tabular-nums text-text-primary">{fractionToPercent(c.rate ?? null)}</span>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={submit} className="grid grid-cols-2 gap-4" aria-label="Add a tax code">
        <Field id="tax-code" label="Code" error={err('code')}>
          <input id="tax-code" value={form.code} onChange={(e) => set('code', e.target.value)} maxLength={32} className={field} />
        </Field>
        <Field id="tax-name" label="Name" error={err('name')}>
          <input id="tax-name" value={form.name} onChange={(e) => set('name', e.target.value)} className={field} />
        </Field>
        <Field id="tax-kind" label="Kind" error={err('kind')}>
          <select id="tax-kind" value={form.kind} onChange={(e) => set('kind', e.target.value as TaxCodeForm['kind'])} className={field}>
            {TAX_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
        </Field>
        <Field id="tax-percent" label="Rate (%)" error={err('percent')} hint={form.kind === 'exempt' || form.kind === 'zero' ? 'Recorded as 0%.' : undefined}>
          <input id="tax-percent" inputMode="decimal" value={form.percent} onChange={(e) => set('percent', e.target.value)} disabled={form.kind === 'exempt' || form.kind === 'zero'} className={field} />
        </Field>
        <Field id="tax-from" label="Applies from" error={err('effective_from')}>
          <input id="tax-from" type="date" value={form.effectiveFrom} onChange={(e) => set('effectiveFrom', e.target.value)} className={field} />
        </Field>
        <div className="col-span-2 flex flex-col gap-2">
          <FormError error={known ? null : create.error} />
          {create.error instanceof ApiError && create.error.code === 'tax_code_exists' && <p role="alert" className="text-[13px] text-danger">A tax code with that code already exists.</p>}
          <div><button type="submit" disabled={create.isPending} className={secondary}>{create.isPending ? 'Adding…' : 'Add tax code'}</button></div>
        </div>
      </form>
      <Actions>
        <button type="button" onClick={onSkip} className={secondary}>Skip for now</button>
        <button type="button" onClick={onNext} className={primary}>{hasCodes ? 'Continue' : 'Continue without tax codes'}</button>
      </Actions>
    </>
  );
};

export const TeamStep: React.FC<{ company: Company; onNext: () => void; onSkip: () => void }> = ({ company, onNext, onSkip }) => {
  const access = useAccess();
  const invitations = useInvitations(access.ready && access.orgAdmin);
  const [sent, setSent] = useState<string[]>([]);
  const forbidden = (access.ready && !access.orgAdmin) || (invitations.error instanceof ApiError && invitations.error.status === 403);
  if (forbidden) {
    return (
      <>
        <p role="alert" className="text-[13px] text-text-secondary">Only owners and administrators can invite people.</p>
        <Actions><span /><button type="button" onClick={onNext} className={primary}>Continue</button></Actions>
      </>
    );
  }
  return (
    <>
      {sent.length > 0 && (
        <ul role="status" className="mb-4 text-[13px] text-text-primary">
          {sent.map((e) => <li key={e}>Invitation sent to {e}.</li>)}
        </ul>
      )}
      <InviteForm companyId={company.id} onInvited={(e) => setSent((s) => [...s, e])} />
      <Actions>
        <button type="button" onClick={onSkip} className={secondary}>Skip for now</button>
        <button type="button" onClick={onNext} className={primary}>{sent.length > 0 ? 'Continue' : 'Continue without inviting'}</button>
      </Actions>
    </>
  );
};
