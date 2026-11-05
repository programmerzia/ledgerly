/** Settings → General → Documents and email (3c.4, 3c.5): logo, accent colour, footer, payment instructions, email templates. */
import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { ApiError } from '@/api/errors';
import { IntentSlot } from '@/api/intentSlot';
import { fieldError } from '@/api/messages';
import type { ApiSettings } from '@/api/live/admin';
import * as docs from '@/api/live/documents';
import { EMAIL_FAMILIES, isHexColor, logoProblem, lookPatch, toLookForm, unknownPlaceholders, type LookForm } from '@/api/adapters/documentLook';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { Field, FormError, field, primary, secondary } from '@/components/live/form';
import { settingsKey, useAdminActions } from '@/data/admin';
import { isSigningCancelled } from '@/data/signing';
import { SettingsCard } from '../settings-ui';

const area = `${field} h-auto py-2 leading-relaxed`;

export const LiveDocumentLook: React.FC<{ settings: ApiSettings; companyId: string }> = ({ settings, companyId }) => {
  const actions = useAdminActions(companyId);
  const qc = useQueryClient();
  const slot = useRef(new IntentSlot()).current;
  const fileRef = useRef<HTMLInputElement>(null);
  const saved = toLookForm(settings);
  const [form, setForm] = useState<LookForm>(saved);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [logoError, setLogoError] = useState('');
  const [logoStamp, setLogoStamp] = useState(() => Date.now());
  const [conflict, setConflict] = useState<VersionConflict | null>(null);

  const canEdit = settings.can.update;
  const allowed = Object.keys(settings.email_placeholders);
  const patch = lookPatch(saved, form);
  const dirty = Object.keys(patch).length > 0;
  const colourBad = tried && !isHexColor(form.accent_color);
  const templateProblems: Record<string, string> = {};
  for (const { key, label } of EMAIL_FAMILIES) {
    const t = form.email[key];
    if (!t) continue;
    if (!t.subject.trim() || !t.body.trim()) templateProblems[key] = `The ${label.toLowerCase()} email needs a subject and a message.`;
    const bad = unknownPlaceholders(`${t.subject}\n${t.body}`, allowed);
    if (bad.length > 0) templateProblems[key] = `Unknown placeholder ${bad.map((b) => `{{ ${b} }}`).join(', ')}. Use only the ones listed below.`;
  }

  const setEmail = (key: string, part: 'subject' | 'body', value: string) =>
    setForm({ ...form, email: { ...form.email, [key]: { ...(form.email[key] ?? { subject: '', body: '' }), [part]: value } } });

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    if (!isHexColor(form.accent_color) || Object.keys(templateProblems).length > 0) return;
    setBusy(true);
    setError(null);
    try {
      const version = settings.version;
      await actions.saveSettings({ ...patch, version }, slot.for(`${version}:${JSON.stringify(patch)}`));
      slot.clear();
      setTried(false);
      toast.success('Document settings saved.');
    } catch (err) {
      if (err instanceof ApiError && err.isVersionConflict) {
        setConflict({
          noun: 'company settings', serverVersion: err.serverVersion, localVersion: settings.version, onClose: () => setConflict(null),
          onReload: () => { setConflict(null); void qc.invalidateQueries({ queryKey: settingsKey(companyId) }); },
        });
      } else if (!isSigningCancelled(err)) setError(err);
    } finally {
      setBusy(false);
    }
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const problem = logoProblem(file);
    if (problem) return setLogoError(problem);
    setLogoError('');
    try {
      await docs.uploadLogo(companyId, file, new IntentSlot().for(`${file.name}:${file.size}:${file.lastModified}`));
      setLogoStamp(Date.now());
      await qc.invalidateQueries({ queryKey: settingsKey(companyId) });
      toast.success('Logo saved. It appears on the next PDF you make.');
    } catch (err) {
      setLogoError(err instanceof ApiError ? err.message : 'The logo could not be saved. Try again.');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const removeLogo = async () => {
    try {
      await docs.removeLogo(companyId, new IntentSlot().for('remove'));
      await qc.invalidateQueries({ queryKey: settingsKey(companyId) });
      toast.success('Logo removed.');
    } catch (err) {
      setLogoError(err instanceof ApiError ? err.message : 'The logo could not be removed. Try again.');
    }
  };

  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-5" aria-label="Documents and email">
      <SettingsCard title="Documents" description="How your invoices, statements and other PDFs look. Drafts, voided and reversed documents are watermarked automatically.">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <span className="text-[13px] font-medium text-text-primary">Logo</span>
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-40 items-center justify-center rounded-md border border-border bg-surface-neutral">
                {settings.document_look.has_logo ? (
                  <img src={docs.logoUrl(companyId, logoStamp)} alt="Company logo" className="max-h-14 max-w-36 object-contain" />
                ) : (
                  <span className="text-xs text-text-muted">No logo</span>
                )}
              </div>
              {canEdit && (
                <div className="flex flex-col items-start gap-1.5">
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg" className="sr-only" id="co-logo" onChange={(e) => void upload(e.target.files?.[0])} />
                  <label htmlFor="co-logo" className={`${secondary} inline-flex items-center`}>{settings.document_look.has_logo ? 'Replace logo' : 'Upload logo'}</label>
                  {settings.document_look.has_logo && <button type="button" className="text-xs text-text-muted hover:text-danger" onClick={() => void removeLogo()}>Remove logo</button>}
                </div>
              )}
            </div>
            <span className="text-xs text-text-muted">PNG or JPEG, up to 512 KB. A wide logo about 600 by 200 pixels looks best.</span>
            {logoError && <span role="alert" className="text-xs text-danger">{logoError}</span>}
          </div>
          <Field id="co-accent" label="Accent colour" hint="Used for the title, table headings and totals." error={colourBad ? 'Use a colour like #1F4E79.' : fieldError(error, 'accent_color')}>
            <div className="flex items-center gap-2">
              <input type="color" aria-label="Pick accent colour" value={isHexColor(form.accent_color) ? form.accent_color : '#1f4e79'} onChange={(e) => setForm({ ...form, accent_color: e.target.value.toUpperCase() })} disabled={!canEdit} className="h-9 w-12 cursor-pointer rounded-md border border-border-strong bg-surface p-1" />
              <input id="co-accent" className={`${field} w-32 uppercase tabular-nums`} value={form.accent_color} onChange={(e) => setForm({ ...form, accent_color: e.target.value })} disabled={!canEdit} maxLength={7} />
            </div>
          </Field>
          <Field id="co-footer" label="Footer text" hint="One line at the bottom of every page, for example your registration number." error={fieldError(error, 'footer_text')}>
            <input id="co-footer" className={field} value={form.footer_text} onChange={(e) => setForm({ ...form, footer_text: e.target.value })} disabled={!canEdit} maxLength={300} />
          </Field>
          <Field id="co-pay" label="Payment instructions" hint="Printed on invoices and statements, and available to email templates." error={fieldError(error, 'payment_instructions')}>
            <textarea id="co-pay" rows={4} className={area} value={form.payment_instructions} onChange={(e) => setForm({ ...form, payment_instructions: e.target.value })} disabled={!canEdit} maxLength={1000} />
          </Field>
        </div>
      </SettingsCard>

      <SettingsCard title="Email sender" description="How your emails appear in a customer's inbox.">
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          <Field id="co-sender" label="Sender name" hint="Shown as the sender. Leave empty to use your company name." error={fieldError(error, 'sender_name')}>
            <input id="co-sender" className={field} value={form.sender_name} onChange={(e) => setForm({ ...form, sender_name: e.target.value })} disabled={!canEdit} maxLength={100} />
          </Field>
          <Field id="co-reply" label="Reply-to address" hint="Where a customer's reply goes. Leave empty to have no reply address." error={fieldError(error, 'reply_to')}>
            <input id="co-reply" type="email" className={field} value={form.reply_to} onChange={(e) => setForm({ ...form, reply_to: e.target.value })} disabled={!canEdit} maxLength={254} />
          </Field>
        </div>
        <p className="mt-3 rounded-md bg-surface-neutral p-3 text-xs text-text-secondary">
          Emails are always sent from <strong className="text-text-primary">{settings.document_look.from_address}</strong>, the address Ledgerly is set up to send from. Your own address cannot be used as the sender, because mail that claims to come from your domain without being sent by it is rejected or lands in spam (SPF and DKIM). Replies go to the reply-to address above.
        </p>
      </SettingsCard>

      <SettingsCard title="Email templates" description="The wording that fills the email box when you send a document. You can still change it for each email.">
        <div className="flex flex-col gap-6">
          {EMAIL_FAMILIES.map(({ key, label }) => (
            <fieldset key={key} className="flex flex-col gap-2">
              <legend className="mb-1 text-[13px] font-semibold text-text-primary">{label}</legend>
              <Field id={`em-${key}-subject`} label="Subject" error={fieldError(error, `email_templates.${key}.subject`)}>
                <input id={`em-${key}-subject`} className={field} value={form.email[key]?.subject ?? ''} onChange={(e) => setEmail(key, 'subject', e.target.value)} disabled={!canEdit} maxLength={200} />
              </Field>
              <Field id={`em-${key}-body`} label="Message" error={templateProblems[key] && tried ? templateProblems[key] : fieldError(error, `email_templates.${key}.body`)}>
                <textarea id={`em-${key}-body`} rows={6} className={area} value={form.email[key]?.body ?? ''} onChange={(e) => setEmail(key, 'body', e.target.value)} disabled={!canEdit} maxLength={5000} />
              </Field>
            </fieldset>
          ))}
          <div className="rounded-md bg-surface-neutral p-3 text-xs text-text-secondary">
            <p className="mb-1.5 font-medium text-text-primary">Placeholders you can use</p>
            <ul className="grid gap-x-6 gap-y-1 md:grid-cols-2">
              {Object.entries(settings.email_placeholders).map(([name, what]) => (
                <li key={name}><code className="rounded bg-surface px-1 py-0.5 text-text-primary">{`{{ ${name} }}`}</code> {String(what)}</li>
              ))}
            </ul>
            <p className="mt-2">Only these are filled in. Nothing else in a template is ever run or shown as code.</p>
          </div>
        </div>
      </SettingsCard>

      <FormError error={error} />
      {canEdit ? (
        <div className="flex gap-2">
          <button type="submit" className={primary} disabled={!dirty || busy}>{busy ? 'Saving…' : 'Save documents and email'}</button>
          <button type="button" className={secondary} disabled={!dirty || busy} onClick={() => { setForm(saved); setTried(false); setError(null); }}>Discard</button>
        </div>
      ) : (
        <p className="text-[13px] text-text-muted">You can read these settings but not change them.</p>
      )}
      <ConflictDialog conflict={conflict} />
    </form>
  );
};
