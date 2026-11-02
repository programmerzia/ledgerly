import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MoneyInput } from '@/components/domain/MoneyInput';
import { ConflictDialog, type VersionConflict } from '@/components/domain/ConflictDialog';
import { ApiError } from '@/api/errors';
import { describeError } from '@/api/messages';
import { IntentSlot } from '@/api/intentSlot';
import { draftOf, toContactRequest, type ContactDraft, type LiveContact } from '@/api/adapters/contact';
import { useContactActions } from '@/data/contacts';
import { inputClass } from './parts';
import { SIDES } from './side';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'KES', 'SOS', 'JPY'];

interface Props {
  open: boolean;
  onClose: () => void;
  /** Absent: create. Present: edit (replaces the contact at its version). */
  contact?: LiveContact;
  kind?: 'customer' | 'supplier';
  baseCurrency: string;
  onSaved?: (c: LiveContact) => void;
}

/** New and edit contact. Errors from the server land on the field they name; a version conflict opens ConflictDialog. */
export const ContactDialog: React.FC<Props> = ({ open, onClose, contact, kind = 'customer', baseCurrency, onSaved }) => {
  const S = SIDES[kind === 'supplier' ? 'purchases' : 'sales'];
  const actions = useContactActions();
  const [draft, setDraft] = useState<ContactDraft>(() =>
    contact
      ? draftOf(contact)
      : { kind, code: '', name: '', email: '', phone: '', tax_id: '', default_currency: baseCurrency, payment_terms_days: 30, credit_limit: null, billing_address: [], notes: '' },
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [banner, setBanner] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<VersionConflict | null>(null);
  const slot = useRef(new IntentSlot()).current;
  const set = <K extends keyof ContactDraft>(k: K, v: ContactDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  async function save(over?: LiveContact) {
    setBusy(true);
    setErrors({});
    setBanner('');
    const target = over ?? contact;
    const body = toContactRequest(draft, target);
    const intent = slot.for(JSON.stringify([target?.id ?? null, body]));
    try {
      const saved = target ? await actions.update(target.id, body, intent) : await actions.create(body, intent);
      slot.clear();
      toast.success(target ? `${S.Contact} saved` : `${S.Contact} ${saved.name} created`);
      onSaved?.(saved);
      onClose();
    } catch (e) {
      if (e instanceof ApiError && e.isVersionConflict && contact) {
        const serverVersion = e.serverVersion;
        setConflict({
          noun: S.contact,
          serverVersion,
          localVersion: contact.version,
          busy: false,
          onClose: () => setConflict(null),
          onReload: () => {
            setConflict(null);
            onClose();
            toast.message(`Closed without saving. Open the ${S.contact} again to see the latest.`);
          },
          onOverwrite:
            typeof serverVersion === 'number'
              ? () => {
                  setConflict(null);
                  void save({ ...contact, version: serverVersion });
                }
              : undefined,
        });
      } else if (e instanceof ApiError && e.isValidation) {
        setErrors(Object.fromEntries(Object.entries(e.errors ?? {}).map(([k, v]) => [k, v[0] ?? ''])));
        setBanner(Object.keys(e.errors ?? {}).length ? '' : describeError(e));
      } else if (e instanceof ApiError && e.code === 'contact_code_taken') {
        setErrors({ code: 'That code is already used by another contact.' });
      } else setBanner(describeError(e));
    } finally {
      setBusy(false);
    }
  }

  const field = (id: string, label: string, el: React.ReactNode, err?: string) => (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-xs font-medium text-text-secondary">
        {label}
      </label>
      {el}
      {err && <span className="text-[11px] text-danger">{err}</span>}
    </div>
  );

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && !busy && onClose()}>
        <DialogContent className="max-w-xl rounded-lg border border-border bg-surface-elevated p-6 shadow-popover">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold text-text-primary">{contact ? `Edit ${contact.name}` : `New ${S.contact}`}</DialogTitle>
          </DialogHeader>
          <form
            className="grid grid-cols-2 gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!draft.name.trim() || !draft.code.trim()) {
                setErrors({ ...(draft.name.trim() ? {} : { name: 'Enter a name.' }), ...(draft.code.trim() ? {} : { code: 'Enter a code.' }) });
                return;
              }
              void save();
            }}
          >
            {field('c-name', 'Name', <input id="c-name" value={draft.name} onChange={(e) => set('name', e.target.value)} className={inputClass} autoFocus />, errors.name)}
            {field('c-code', 'Code', <input id="c-code" value={draft.code} onChange={(e) => set('code', e.target.value)} placeholder={kind === 'supplier' ? 'e.g. SUP-001' : 'e.g. CUST-001'} className={inputClass} disabled={Boolean(contact)} />, errors.code)}
            {field('c-email', 'Email', <input id="c-email" type="email" value={draft.email} onChange={(e) => set('email', e.target.value)} className={inputClass} />, errors.email)}
            {field('c-phone', 'Phone', <input id="c-phone" value={draft.phone} onChange={(e) => set('phone', e.target.value)} className={inputClass} />, errors.phone)}
            {field('c-tax', 'Tax ID', <input id="c-tax" value={draft.tax_id} onChange={(e) => set('tax_id', e.target.value)} className={inputClass} />, errors.tax_id)}
            {field(
              'c-cur',
              'Currency',
              <select id="c-cur" value={draft.default_currency} onChange={(e) => set('default_currency', e.target.value)} className={inputClass}>
                {Array.from(new Set([baseCurrency, draft.default_currency, ...CURRENCIES])).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>,
              errors.default_currency,
            )}
            {field(
              'c-terms',
              'Payment terms (days)',
              <input id="c-terms" type="number" min={0} max={3650} value={draft.payment_terms_days} onChange={(e) => set('payment_terms_days', Math.max(0, Math.floor(Number(e.target.value) || 0)))} className={inputClass} />,
              errors.payment_terms_days,
            )}
            {field(
              'c-limit',
              `Credit limit (${draft.default_currency})`,
              <MoneyInput id="c-limit" value={draft.credit_limit ?? 0} onChange={(v) => set('credit_limit', v > 0 ? v : null)} currency={draft.default_currency} allowNegative={false} size="sm" />,
              errors['credit_limit.amount'] ?? errors.credit_limit,
            )}
            <div className="col-span-2">
              {field(
                'c-addr',
                kind === 'supplier' ? 'Address' : 'Billing address',
                <textarea id="c-addr" rows={3} value={draft.billing_address.join('\n')} onChange={(e) => set('billing_address', e.target.value.split('\n'))} className="rounded-md border border-border bg-surface p-2 text-xs text-text-primary focus:border-accent focus:outline-none" />,
                errors.billing_address,
              )}
            </div>
            <div className="col-span-2">
              {field('c-notes', 'Notes', <input id="c-notes" value={draft.notes} onChange={(e) => set('notes', e.target.value)} className={inputClass} />, errors.notes)}
            </div>
            {banner && (
              <p role="alert" className="col-span-2 text-xs font-medium text-danger">
                {banner}
              </p>
            )}
            <DialogFooter className="col-span-2 mt-1 flex justify-end gap-2">
              <button type="button" onClick={onClose} disabled={busy} className="h-8 rounded-md border border-border bg-surface px-3 text-[13px] font-medium hover:bg-surface-neutral">
                Cancel
              </button>
              <button type="submit" disabled={busy} className="h-8 rounded-md bg-accent px-3 text-[13px] font-medium text-white hover:bg-accent-hover disabled:opacity-50">
                {busy ? 'Saving…' : contact ? 'Save changes' : `Create ${S.contact}`}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
      <ConflictDialog conflict={conflict} />
    </>
  );
};
