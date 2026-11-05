import React, { useState } from 'react';
import { useAssetTaxClasses, useFixedAssetActions, useTaxSchedule } from '@/data/fixedAssets';
import { useActiveCompany } from '@/data/session';
import { bpLabel, emptyTaxClassDraft, taxClassToDraft, toTaxClassRequest, type AssetTaxClass, type TaxClassDraft } from '@/api/adapters/fixedAssets';
import { formatMoney } from '@/lib/format';
import { ErrorLine, LoadingLine } from '../parts';
import { Badge, DialogShell, Field, fieldClass, Note, primaryBtn, Problem, secondaryBtn, type Writer } from './parts';

export const TaxTab: React.FC<{ writer: Writer }> = ({ writer }) => {
  const { company } = useActiveCompany();
  const cur = company.base_currency;
  const classes = useAssetTaxClasses();
  const schedule = useTaxSchedule(true);
  const actions = useFixedAssetActions();
  const [editing, setEditing] = useState<{ cls: AssetTaxClass | null } | null>(null);
  const [draft, setDraft] = useState<TaxClassDraft>(emptyTaxClassDraft());
  const [problem, setProblem] = useState<string | null>(null);

  const openEdit = (cls: AssetTaxClass | null) => {
    setProblem(null);
    setDraft(cls ? taxClassToDraft(cls) : emptyTaxClassDraft());
    setEditing({ cls });
  };

  const save = async () => {
    if (!editing) return;
    const built = toTaxClassRequest(draft, editing.cls?.version);
    if (!built.ok) {
      setProblem(built.error);
      return;
    }
    setProblem(null);
    const cls = editing.cls;
    const r = await writer.exec(`taxclass:${cls?.id ?? 'new'}`, JSON.stringify(built.body), (intent) => (cls ? actions.updateTaxClass(cls.id, built.body, intent) : actions.createTaxClass(built.body, intent)), {
      noun: 'tax class',
      onProblem: setProblem,
    });
    if (r) setEditing(null);
  };

  const set = <K extends keyof TaxClassDraft>(k: K, v: TaxClassDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const years = schedule.data?.by_year ?? [];

  return (
    <div className="flex flex-col gap-5">
      <Note>
        Tax depreciation is a separate schedule for your tax return. It never posts anything to your books. Ledgerly has no country tax rates built in, so you
        enter the classes and rates your tax authority allows, then give each asset a class when you add or edit it.
      </Note>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-text-primary">Tax classes</h2>
          <button type="button" onClick={() => openEdit(null)} className={primaryBtn}>New tax class</button>
        </div>
        {classes.isLoading ? (
          <LoadingLine what="tax classes" />
        ) : classes.error ? (
          <ErrorLine error={classes.error} onRetry={classes.refetch} />
        ) : classes.data.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-[13px] text-text-muted">No tax classes yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="h-8 border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase text-text-muted">
                  <th className="px-3">Code</th>
                  <th className="px-3">Name</th>
                  <th className="px-3 text-right">Yearly rate</th>
                  <th className="px-3 text-right">First year</th>
                  <th className="px-3">Status</th>
                  <th className="px-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border" data-testid="tax-class-rows">
                {classes.data.map((c) => (
                  <tr key={c.id} className="h-9">
                    <td className="px-3 font-mono text-text-primary">{c.code}</td>
                    <td className="px-3 text-text-primary">{c.name}</td>
                    <td className="px-3 text-right tabular-nums">{bpLabel(c.annual_rate_bp)}</td>
                    <td className="px-3 text-right tabular-nums">{c.first_year_rate_bp === null ? 'Same' : bpLabel(c.first_year_rate_bp)}</td>
                    <td className="px-3">{c.is_active ? <Badge tone="active">Active</Badge> : <Badge tone="disposed">Inactive</Badge>}</td>
                    <td className="px-3 text-right">{c.can.update && <button type="button" onClick={() => openEdit(c)} className="text-xs font-medium text-accent hover:underline">Edit</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-text-primary">Tax depreciation by asset</h2>
        {schedule.isLoading ? (
          <LoadingLine what="the tax schedule" />
        ) : schedule.error ? (
          <ErrorLine error={schedule.error} onRetry={schedule.refetch} />
        ) : !schedule.data || schedule.data.assets.length === 0 ? (
          <p className="rounded-lg border border-border bg-surface px-4 py-6 text-center text-[13px] text-text-muted">No assets have a tax class yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full border-collapse text-left text-xs" data-testid="tax-schedule">
              <thead>
                <tr className="h-8 border-b border-border bg-surface-neutral text-[11px] font-semibold uppercase text-text-muted">
                  <th className="px-3">Asset</th>
                  <th className="px-3">Class</th>
                  <th className="px-3 text-right">Cost</th>
                  {years.map((y) => (
                    <th key={y.year} className="px-3 text-right">{y.label || y.year}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {schedule.data.assets.map((a) => (
                  <tr key={a.asset_id} className="align-top">
                    <td className="px-3 py-2">
                      <div className="font-medium text-text-primary">{a.name}</div>
                      <div className="font-mono text-[11px] text-text-muted">{a.number}</div>
                    </td>
                    <td className="px-3 py-2 text-text-secondary">{a.class_name}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{formatMoney(a.cost, cur)}</td>
                    {years.map((y) => {
                      const cell = a.years.find((x) => x.year === y.year);
                      return (
                        <td key={y.year} className="px-3 py-2 text-right tabular-nums">
                          {cell ? (
                            <>
                              <div className="text-text-primary">{formatMoney(cell.allowance, cur)}</div>
                              <div className="text-[11px] text-text-muted">left {formatMoney(cell.written_down, cur)}</div>
                            </>
                          ) : (
                            <span className="text-text-muted">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border-strong bg-surface-neutral/50 font-semibold">
                  <td className="px-3 py-2" colSpan={3}>All assets</td>
                  {years.map((y) => (
                    <td key={y.year} className="px-3 py-2 text-right tabular-nums">
                      <div>{formatMoney(y.allowance, cur)}</div>
                      <div className="text-[11px] font-normal text-text-muted">left {formatMoney(y.written_down, cur)}</div>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="text-[11px] text-text-muted">Each year shows the allowance for that year and the tax value left at its end.</p>
      </section>

      <DialogShell
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.cls ? 'Edit tax class' : 'New tax class'}
        footer={
          <>
            <button type="button" onClick={() => setEditing(null)} className={secondaryBtn}>Cancel</button>
            <button type="button" onClick={() => void save()} className={primaryBtn}>Save tax class</button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Code"><input value={draft.code} onChange={(e) => set('code', e.target.value)} className={fieldClass} /></Field>
          <Field label="Name"><input value={draft.name} onChange={(e) => set('name', e.target.value)} className={fieldClass} /></Field>
          <Field label="Yearly rate (%)" hint="For example 20 or 12.5"><input inputMode="decimal" value={draft.annual_percent} onChange={(e) => set('annual_percent', e.target.value)} className={fieldClass} /></Field>
          <Field label="First-year rate (%)" hint="Leave blank to use the yearly rate"><input inputMode="decimal" value={draft.first_year_percent} onChange={(e) => set('first_year_percent', e.target.value)} className={fieldClass} /></Field>
        </div>
        <label className="flex items-center gap-2 text-xs text-text-secondary">
          <input type="checkbox" checked={draft.is_active} onChange={(e) => set('is_active', e.target.checked)} />
          Active
        </label>
        <Problem message={problem} />
      </DialogShell>
    </div>
  );
};
