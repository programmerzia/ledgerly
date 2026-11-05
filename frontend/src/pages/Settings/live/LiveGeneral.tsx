/** Settings → Company: the profile and tax rounding. Country and base currency are fixed when the company is created. */
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { IntentSlot } from '@/api/intentSlot';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { ApiError } from '@/api/errors';
import type { ApiSettings } from '@/api/live/admin';
import { fieldError } from '@/api/messages';
import { isSigningCancelled } from '@/data/signing';
import { TAX_ROUNDING_LABEL, profilePatch, purchasingErrors, purchasingPatch, toProfileForm, toPurchasingForm, type ProfileForm, type PurchasingForm } from '@/api/adapters/admin';
import { Checkbox } from '@/components/ui/checkbox';
import { settingsKey, useAdminActions, useSettings } from '@/data/admin';
import { useQueryClient } from '@tanstack/react-query';
import { useCurrentCompany } from '@/data/team';
import { Field, FormError, LoadError, Loading, field, primary, secondary } from '@/components/live/form';
import { SettingsCard } from '../settings-ui';
import { LiveDocumentLook } from './LiveDocumentLook';
import { LiveDunning } from './LiveDunning';
import { LiveFormats } from './LiveFormats';

export const LiveGeneral: React.FC = () => {
  const company = useCurrentCompany();
  const settings = useSettings(company.id);
  if (settings.isPending) return <Loading what="Loading company settings" />;
  if (settings.isError) return <LoadError error={settings.error} onRetry={() => void settings.refetch()} />;
  return (
    <div className="flex flex-col gap-5">
      <GeneralForm key={settings.data.version} settings={settings.data} companyId={company.id} />
      <LiveFormats key={`formats-${settings.data.version}`} settings={settings.data} companyId={company.id} />
      <LiveDocumentLook key={`look-${settings.data.version}`} settings={settings.data} companyId={company.id} />
      <LiveDunning companyId={company.id} />
    </div>
  );
};

const GeneralForm: React.FC<{ settings: ApiSettings; companyId: string }> = ({ settings: loaded, companyId }) => {
  const settings = { data: loaded };
  const actions = useAdminActions(companyId);
  const slot = useRef(new IntentSlot()).current;
  const saved = toProfileForm(loaded);
  const [form, setForm] = useState<ProfileForm>(saved);
  const savedPurchasing = toPurchasingForm(loaded);
  const [purchasing, setPurchasing] = useState<PurchasingForm>(savedPurchasing);
  const [tried, setTried] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const qc = useQueryClient();

  const canEdit = settings.data.can.update;
  const patch = { ...profilePatch(saved, form), ...purchasingPatch(savedPurchasing, purchasing) };
  const dirty = Object.keys(patch).length > 0;
  const pctErrors = tried ? purchasingErrors(purchasing) : {};
  const set = (k: keyof ProfileForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm({ ...form, [k]: e.target.value });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (Object.keys(purchasingErrors(purchasing)).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const version = settings.data.version;
      const next = await actions.saveSettings({ ...patch, version }, slot.for(`${version}:${JSON.stringify(patch)}`));
      slot.clear();
      setForm(toProfileForm(next));
      setPurchasing(toPurchasingForm(next));
      setTried(false);
      toast.success('Company details saved.');
    } catch (err) {
      if (err instanceof ApiError && err.isVersionConflict) {
        const reload = () => {
          setConflict(null);
          void qc.invalidateQueries({ queryKey: settingsKey(companyId) });
        };
        setConflict({ noun: 'company profile', serverVersion: err.serverVersion, localVersion: settings.data.version, onReload: reload, onClose: () => setConflict(null) });
      } else if (!isSigningCancelled(err)) setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-5" aria-label="Company details">
      <SettingsCard title="Company" description="These details appear on your documents and reports.">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Field id="co-name" label="Name" error={fieldError(error, 'name')}>
            <input id="co-name" className={field} value={form.name} onChange={set('name')} disabled={!canEdit} required maxLength={255} />
          </Field>
          <Field id="co-legal" label="Legal name" hint="As registered with the tax authority." error={fieldError(error, 'legal_name')}>
            <input id="co-legal" className={field} value={form.legal_name} onChange={set('legal_name')} disabled={!canEdit} maxLength={255} />
          </Field>
          <Field id="co-tax" label="Tax number" error={fieldError(error, 'tax_id')}>
            <input id="co-tax" className={field} value={form.tax_id} onChange={set('tax_id')} disabled={!canEdit} maxLength={64} />
          </Field>
          <Field id="co-tz" label="Time zone" hint="For example Europe/Sofia. Decides which day a posting falls on." error={fieldError(error, 'timezone')}>
            <input id="co-tz" className={field} value={form.timezone} onChange={set('timezone')} disabled={!canEdit} />
          </Field>
          <Field id="co-locale" label="Language and format" hint="For example en or bg-BG." error={fieldError(error, 'locale')}>
            <input id="co-locale" className={field} value={form.locale} onChange={set('locale')} disabled={!canEdit} maxLength={16} />
          </Field>
          <Field id="co-round" label="Round tax" error={fieldError(error, 'tax_rounding')}>
            <select id="co-round" className={field} value={form.tax_rounding} onChange={set('tax_rounding')} disabled={!canEdit}>
              {Object.entries(TAX_ROUNDING_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </Field>
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-4 border-t border-border pt-4 text-[13px] md:grid-cols-3">
          <div><dt className="text-xs text-text-muted">Country</dt><dd className="text-text-primary">{settings.data.country}</dd></div>
          <div><dt className="text-xs text-text-muted">Currency of the books</dt><dd className="text-text-primary">{settings.data.base_currency}</dd></div>
          <div className="col-span-2 text-xs text-text-muted md:col-span-1">Country and currency are set when the company is created and cannot change, because every posted amount is in that currency.</div>
        </dl>
      </SettingsCard>
      <SettingsCard title="Purchasing" description="How strictly a supplier’s bill has to match the purchase order and what was received.">
        <div className="flex flex-col gap-4">
          <label className="flex items-start gap-2.5 text-[13px] text-text-primary">
            <Checkbox
              id="co-require-po"
              checked={purchasing.require_purchase_order}
              onCheckedChange={(v) => setPurchasing({ ...purchasing, require_purchase_order: v === true })}
              disabled={!canEdit}
              aria-label="Require a purchase order on every bill line"
              className="mt-0.5"
            />
            <span>
              <span className="font-medium">Require a purchase order on every bill line</span>
              <span className="block text-xs text-text-muted">A bill line with no order is refused unless someone with the override permission passes it with a reason.</span>
            </span>
          </label>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <Field id="co-po-price" label="Price tolerance (%)" hint="How far a bill’s price may differ from the order’s, up or down." error={pctErrors.po_price_tolerance_pct ?? fieldError(error, 'po_price_tolerance_pct')}>
              <input id="co-po-price" className={`${field} text-right tabular-nums`} inputMode="decimal" value={purchasing.po_price_tolerance_pct} onChange={(e) => setPurchasing({ ...purchasing, po_price_tolerance_pct: e.target.value })} disabled={!canEdit} />
            </Field>
            <Field id="co-po-qty" label="Quantity tolerance (%)" hint="How far the quantity billed may go over what was received." error={pctErrors.po_quantity_tolerance_pct ?? fieldError(error, 'po_quantity_tolerance_pct')}>
              <input id="co-po-qty" className={`${field} text-right tabular-nums`} inputMode="decimal" value={purchasing.po_quantity_tolerance_pct} onChange={(e) => setPurchasing({ ...purchasing, po_quantity_tolerance_pct: e.target.value })} disabled={!canEdit} />
            </Field>
            <Field id="co-receipt-over" label="Over-delivery tolerance (%)" hint="How far a receipt may go over what was ordered." error={pctErrors.receipt_over_tolerance_pct ?? fieldError(error, 'receipt_over_tolerance_pct')}>
              <input id="co-receipt-over" className={`${field} text-right tabular-nums`} inputMode="decimal" value={purchasing.receipt_over_tolerance_pct} onChange={(e) => setPurchasing({ ...purchasing, receipt_over_tolerance_pct: e.target.value })} disabled={!canEdit} />
            </Field>
          </div>
        </div>
      </SettingsCard>
      <FormError error={error} />
      {canEdit ? (
        <div className="flex gap-2">
          <button type="submit" className={primary} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save changes'}</button>
          <button type="button" className={secondary} disabled={!dirty || busy} onClick={() => { setForm(saved); setPurchasing(savedPurchasing); setTried(false); setError(null); }}>Discard</button>
        </div>
      ) : (
        <p className="text-[13px] text-text-muted">You can read these details but not change them.</p>
      )}
      <ConflictDialog conflict={conflict} />
    </form>
  );
};
