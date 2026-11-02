/** Settings → Security: two-factor sign-in. Turn on (QR + code), recovery codes shown once, turn off. */
import React, { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  confirmTwoFactor, disableTwoFactor, enableTwoFactor, fetchRecoveryCodes, fetchTwoFactorSetup, regenerateRecoveryCodes, type TwoFactorSetup,
} from '@/api/live/account';
import { groupSecret, qrImageSrc } from '@/api/adapters/security';
import { fieldError } from '@/api/messages';
import { meKey, useMe } from '@/data/session';
import { Field, FormError, field, primary, secondary } from '@/components/live/form';
import { PasswordGateCancelled, usePasswordGate } from '@/components/live/usePasswordGate';
import { SettingsCard } from '../settings-ui';

type Phase =
  | { name: 'idle' }
  | { name: 'enrol'; setup: TwoFactorSetup }
  | { name: 'codes'; codes: string[]; why: 'enabled' | 'regenerated' };

export const RecoveryCodes: React.FC<{ codes: string[]; onDone: () => void }> = ({ codes, onDone }) => {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
    } catch {
      toast.error('Could not copy. Select the codes and copy them by hand.');
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-text-secondary">
        Each code signs you in once if you lose your authenticator. Keep them somewhere safe. <span className="font-medium text-text-primary">They are shown only now.</span>
      </p>
      <ul aria-label="Recovery codes" className="grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-md border border-border bg-canvas px-4 py-3 font-mono text-[13px] text-text-primary">
        {codes.map((c) => <li key={c} data-recovery-code>{c}</li>)}
      </ul>
      <div className="flex gap-2">
        <button type="button" onClick={() => void copy()} className={secondary}>{copied ? 'Copied' : 'Copy codes'}</button>
        <button type="button" onClick={onDone} className={primary}>I have saved them</button>
      </div>
    </div>
  );
};

export const TwoFactorPanel: React.FC = () => {
  const me = useMe();
  const qc = useQueryClient();
  const gate = usePasswordGate();
  const enabled = Boolean(me.data?.two_factor_enabled);
  const [phase, setPhase] = useState<Phase>({ name: 'idle' });
  const [code, setCode] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const refreshMe = () => qc.invalidateQueries({ queryKey: meKey });

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (!(e instanceof PasswordGateCancelled)) setError(e);
    } finally {
      setBusy(false);
    }
  };

  const start = () => guard(async () => {
    const setup = await gate.run(async () => {
      await enableTwoFactor();
      return fetchTwoFactorSetup();
    });
    setCode('');
    setPhase({ name: 'enrol', setup });
  });

  const confirm = (e: React.FormEvent) => {
    e.preventDefault();
    void guard(async () => {
      await confirmTwoFactor(code.trim());
      const codes = await fetchRecoveryCodes();
      await refreshMe();
      setPhase({ name: 'codes', codes, why: 'enabled' });
    });
  };

  const cancelEnrol = () => guard(async () => {
    // A half-finished set-up is dropped on the server too, so the next try starts clean.
    await gate.run(disableTwoFactor);
    setPhase({ name: 'idle' });
  });

  const regenerate = () => guard(async () => {
    const codes = await gate.run(async () => {
      await regenerateRecoveryCodes();
      return fetchRecoveryCodes();
    });
    setPhase({ name: 'codes', codes, why: 'regenerated' });
  });

  const turnOff = () => guard(async () => {
    await gate.run(disableTwoFactor);
    await refreshMe();
    setPhase({ name: 'idle' });
    toast.success('Two-factor sign-in is off.');
  });

  const qr = phase.name === 'enrol' ? qrImageSrc(phase.setup.svg) : null;

  return (
    <SettingsCard title="Two-factor sign-in" description="Ask for a code from an authenticator app each time you sign in, on top of your password.">
      {gate.dialog}
      {phase.name === 'codes' ? (
        <div className="flex flex-col gap-3">
          <p role="status" className="text-[13px] font-medium text-text-primary">
            {phase.why === 'enabled' ? 'Two-factor sign-in is on.' : 'New recovery codes. The old ones no longer work.'}
          </p>
          <RecoveryCodes codes={phase.codes} onDone={() => setPhase({ name: 'idle' })} />
        </div>
      ) : phase.name === 'enrol' ? (
        <div className="flex flex-col gap-4">
          <ol className="list-decimal pl-5 text-[13px] text-text-secondary flex flex-col gap-1">
            <li>Open an authenticator app (any that supports time-based codes).</li>
            <li>Scan the square below, or type the key by hand.</li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <div className="flex flex-wrap items-start gap-5">
            {qr ? (
              <img src={qr} alt="QR code for your authenticator app" width={176} height={176} className="rounded-md border border-border bg-white p-1" />
            ) : (
              <p role="alert" className="max-w-[176px] text-[13px] text-danger">The QR code could not be shown. Use the key instead.</p>
            )}
            <div className="flex flex-col gap-1">
              <span className="text-xs text-text-muted">Setup key</span>
              <code data-setup-key className="rounded border border-border bg-canvas px-2 py-1 font-mono text-[13px] text-text-primary select-all">{groupSecret(phase.setup.secretKey)}</code>
            </div>
          </div>
          <form onSubmit={confirm} className="flex max-w-xs flex-col gap-3">
            <Field id="tf-code" label="6-digit code" error={fieldError(error, 'code')}>
              <input id="tf-code" inputMode="numeric" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} required className={field} />
            </Field>
            <FormError error={fieldError(error, 'code') ? null : error} />
            <div className="flex gap-2">
              <button type="submit" disabled={busy} className={primary}>{busy ? 'Checking…' : 'Turn on'}</button>
              <button type="button" disabled={busy} onClick={() => void cancelEnrol()} className={secondary}>Cancel</button>
            </div>
          </form>
        </div>
      ) : enabled ? (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-text-secondary">Two-factor sign-in is <span className="font-medium text-text-primary">on</span>.</p>
          <FormError error={error} />
          <div className="flex flex-wrap gap-2">
            <button type="button" disabled={busy} onClick={() => void regenerate()} className={secondary}>New recovery codes</button>
            <button type="button" disabled={busy} onClick={() => void turnOff()} className={secondary}>Turn off</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] text-text-secondary">Two-factor sign-in is <span className="font-medium text-text-primary">off</span>.</p>
          <FormError error={error} />
          <div><button type="button" disabled={busy} onClick={() => void start()} className={primary}>{busy ? 'Starting…' : 'Turn on'}</button></div>
        </div>
      )}
    </SettingsCard>
  );
};
