import React, { useMemo } from 'react';
import { AccountPicker } from '@/components/domain/AccountPicker';
import { useDimensions } from '@/data/dimensions';
import { useRouteCompany } from '@/data/session';
import { useContactChoices, useChartAccounts } from '@/data/banking';
import { useTaxCodes } from '@/data/setup';
import { fractionToPercent } from '@/api/adapters/tax';
import { Field, SimpleSelect, codableAccounts, inputCls } from '../reconcile/shared';

export interface CodingValue {
  account_id: string | null;
  tax_code_id: string | null;
  contact_id: string | null;
  dimensions: Record<string, string>;
  memo: string;
}

/**
 * The fields shared by "code this bank line" and "bank rule": account, tax, contact, dimensions, memo. Everything offered
 * comes from the server (chart, tax codes, contacts, dimensions); which combinations post is the server's call.
 */
export const CodingFields: React.FC<{ value: CodingValue; onChange: (v: CodingValue) => void; showMemo?: boolean }> = ({ value, onChange, showMemo = true }) => {
  const company = useRouteCompany();
  const accounts = useChartAccounts();
  const taxes = useTaxCodes(company.id);
  const contacts = useContactChoices();
  const dims = useDimensions();
  const set = <K extends keyof CodingValue>(k: K, v: CodingValue[K]) => onChange({ ...value, [k]: v });
  const options = useMemo(() => codableAccounts(accounts.data), [accounts.data]);
  const account = accounts.data.find((a) => a.id === value.account_id);

  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Account" className="col-span-2">
        <AccountPicker accounts={options} value={value.account_id ?? ''} onChange={(id) => set('account_id', id || null)} placeholder="Choose an account..." />
      </Field>
      <Field label="Tax">
        <SimpleSelect
          aria-label="Tax code"
          value={value.tax_code_id ?? undefined}
          onChange={(v) => set('tax_code_id', v ?? null)}
          noneLabel="No tax"
          options={(taxes.data ?? [])
            .filter((t) => t.is_active && t.kind !== 'wht')
            .map((t) => ({ value: t.id, label: `${t.code} · ${fractionToPercent(t.rate ?? null)}` }))}
        />
      </Field>
      <Field label="Contact (optional)">
        <SimpleSelect aria-label="Contact" value={value.contact_id ?? undefined} onChange={(v) => set('contact_id', v ?? null)} noneLabel="No contact" options={contacts.data.map((c) => ({ value: c.id, label: c.name }))} />
      </Field>
      {dims.data
        .filter((d) => d.is_active && account?.dimension_rules?.[d.id] !== 'forbidden')
        .map((d) => {
          const required = account?.dimension_rules?.[d.id] === 'required';
          return (
            <Field key={d.id} label={`${d.name}${required ? '' : ' (optional)'}`}>
              <SimpleSelect
                aria-label={d.name}
                value={value.dimensions[d.id]}
                allowNone={!required}
                noneLabel="None"
                placeholder="Choose..."
                onChange={(v) => {
                  const next = { ...value.dimensions };
                  if (v) next[d.id] = v;
                  else delete next[d.id];
                  set('dimensions', next);
                }}
                options={d.values.filter((x) => x.is_active).map((x) => ({ value: x.id, label: `${x.code} ${x.name}` }))}
              />
            </Field>
          );
        })}
      {showMemo && (
        <Field label="Memo (optional)" className="col-span-2">
          <input className={inputCls} value={value.memo} onChange={(e) => set('memo', e.target.value)} aria-label="Memo" />
        </Field>
      )}
    </div>
  );
};
