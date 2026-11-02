/**
 * Fortify's two-factor endpoints need a recently confirmed password. `run(fn)` calls `fn`; if the API says
 * the password must be confirmed (423), it asks for it in a dialog, confirms it, then calls `fn` once more.
 */
import React, { useCallback, useState } from 'react';
import { confirmPassword, needsPasswordConfirmation } from '@/api/live/account';
import { fieldError } from '@/api/messages';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Field, FormError, field, primary, secondary } from './form';

export class PasswordGateCancelled extends Error {
  constructor() {
    super('Password confirmation cancelled');
    this.name = 'PasswordGateCancelled';
  }
}

interface Pending {
  resolve: () => void;
  reject: (e: unknown) => void;
}

const PasswordDialog: React.FC<{ onConfirmed: () => void; onCancel: () => void }> = ({ onConfirmed, onCancel }) => {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await confirmPassword(password);
      onConfirmed();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-sm p-6 bg-surface-elevated border border-border shadow-popover rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold text-text-primary">Confirm your password</DialogTitle>
          <DialogDescription>This is a security setting, so we ask for your password again.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="mt-4 flex flex-col gap-4">
          <Field id="confirm-password" label="Password" error={fieldError(error, 'password')}>
            <input id="confirm-password" type="password" autoComplete="current-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} required className={field} />
          </Field>
          <FormError error={fieldError(error, 'password') ? null : error} />
          <div className="flex justify-end gap-2">
            <button type="button" onClick={onCancel} className={secondary}>Cancel</button>
            <button type="submit" disabled={busy} className={primary}>{busy ? 'Checking…' : 'Confirm'}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export function usePasswordGate() {
  const [pending, setPending] = useState<Pending | null>(null);

  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T> => {
    try {
      return await fn();
    } catch (e) {
      if (!needsPasswordConfirmation(e)) throw e;
    }
    await new Promise<void>((resolve, reject) => setPending({ resolve, reject }));
    return fn();
  }, []);

  const dialog = pending ? (
    <PasswordDialog
      onConfirmed={() => { pending.resolve(); setPending(null); }}
      onCancel={() => { pending.reject(new PasswordGateCancelled()); setPending(null); }}
    />
  ) : null;

  return { run, dialog };
}
