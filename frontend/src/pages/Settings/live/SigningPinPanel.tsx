/** Settings → Security: the signing PIN (ADR-0004). Set or change, after re-proving the password. */
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { setSigningPin } from '@/api/live/account';
import { ApiError } from '@/api/errors';
import { pinViolationText } from '@/api/adapters/security';
import { fieldError } from '@/api/messages';
import { meKey, useMe } from '@/data/session';
import { Field, FormError, field, primary } from '@/components/live/form';
import { SettingsCard } from '../settings-ui';

export const SigningPinPanel: React.FC = () => {
  const me = useMe();
  const qc = useQueryClient();
  const isSet = Boolean(me.data?.signing_pin_set);
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMismatch(pin !== again);
    if (pin !== again) return;
    setBusy(true);
    try {
      await setSigningPin({ current_password: password, pin });
      await qc.invalidateQueries({ queryKey: meKey });
      setPin('');
      setAgain('');
      setPassword('');
      toast.success(isSet ? 'Signing PIN changed.' : 'Signing PIN set.');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  // PIN rules come back as `pin_policy` with one violation per broken rule.
  const policy = error instanceof ApiError && error.code === 'pin_policy' ? error : null;
  const handled = Boolean(policy) || Boolean(fieldError(error, 'current_password')) || Boolean(fieldError(error, 'pin'));

  return (
    <SettingsCard
      title="Signing PIN"
      description="A 6-digit PIN, separate from your password, that you enter to approve and post. Three wrong PINs lock signing for 15 minutes."
    >
      <p className="mb-4 text-[13px] text-text-secondary">
        {isSet ? <>A signing PIN is <span className="font-medium text-text-primary">set</span>. Choosing a new one replaces it and ends any signing approval you have right now.</> : <>No signing PIN yet. You need one before you can approve or post.</>}
      </p>
      <form onSubmit={submit} className="flex max-w-xs flex-col gap-4">
        <Field id="pin" label={isSet ? 'New PIN' : 'PIN'} error={mismatch ? undefined : fieldError(error, 'pin')} hint="Six digits. Not 123456, 111111 or similar.">
          <input id="pin" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} required className={field} />
        </Field>
        <Field id="pin-again" label="Type it again" error={mismatch ? 'The two PINs are different.' : undefined}>
          <input id="pin-again" type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={again} onChange={(e) => setAgain(e.target.value.replace(/\D/g, ''))} required className={field} />
        </Field>
        <Field id="pin-password" label="Your password" error={fieldError(error, 'current_password')} hint="We ask again because this controls who can approve.">
          <input id="pin-password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className={field} />
        </Field>
        {policy && (
          <ul role="alert" className="list-disc pl-5 text-[13px] text-danger">
            {(policy.violations?.length ? policy.violations.map((v) => pinViolationText(v.code)) : [pinViolationText('')]).map((m) => <li key={m}>{m}</li>)}
          </ul>
        )}
        <FormError error={handled ? null : error} />
        <div><button type="submit" disabled={busy} className={primary}>{busy ? 'Saving…' : isSet ? 'Change PIN' : 'Set PIN'}</button></div>
      </form>
    </SettingsCard>
  );
};
