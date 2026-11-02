/**
 * Live-mode auth screens (VITE_API_MODE=live): sign in, two-factor challenge, register, first company.
 * Same layout and field styling as the mock Login/TwoFactor pages.
 */
import React, { useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AuthLayout } from './AuthLayout';
import { createCompany, login, register, submitTwoFactor } from '@/api/live/session';
import { fieldError } from '@/api/messages';
import { Field, FormError, field, primary as primaryBase } from '@/components/live/form';
import { companiesKey, meKey, useAuthStatus, useHomePath, useMe } from '@/data/session';
import { currentTenant, type ApiCompany } from '@/api/adapters/session';
import { takeNextPath } from '@/api/adapters/security';

const primary = `mt-1 ${primaryBase}`;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Sends a signed-in visitor to their books instead of showing a sign-in form. */
const AlreadySignedIn: React.FC = () => {
  const { status } = useAuthStatus();
  const home = useHomePath();
  if (status === 'authenticated' && home) return <Navigate to={home} replace />;
  return null;
};

export const LiveLogin: React.FC = () => {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await login(email, password);
      if (res.twoFactor) {
        navigate('/two-factor-challenge');
        return;
      }
      await qc.invalidateQueries({ queryKey: meKey });
      navigate(takeNextPath() ?? '/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <AlreadySignedIn />
      <h1 className="text-[22px] font-semibold text-text-primary">Sign in</h1>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <Field id="email" label="Email" error={fieldError(error, 'email')}>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required className={field} />
        </Field>
        <Field id="password" label="Password" error={fieldError(error, 'password')}>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className={field} />
        </Field>
        <FormError error={fieldError(error, 'email') || fieldError(error, 'password') ? null : error} />
        <button type="submit" disabled={busy} className={primary}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <Link to={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`} className="text-[13px] text-text-muted hover:text-accent">Forgot your password?</Link>
      </form>
      <p className="mt-4 text-[13px] text-text-muted">
        New to Ledgerly? <Link to="/register" className="text-accent hover:underline">Create an account</Link>
      </p>
    </AuthLayout>
  );
};

export const LiveTwoFactor: React.FC = () => {
  const [code, setCode] = useState('');
  const [recovery, setRecovery] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await submitTwoFactor(recovery ? { recoveryCode: code.trim() } : { code: code.trim() });
      await qc.invalidateQueries({ queryKey: meKey });
      navigate(takeNextPath() ?? '/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h1 className="text-[22px] font-semibold text-text-primary">{recovery ? 'Enter a recovery code' : 'Enter your code'}</h1>
      <p className="mt-1 text-[13px] text-text-muted">
        {recovery ? 'Use one of the recovery codes you saved when you turned on two-factor sign-in.' : 'From the authenticator app you set up for your account.'}
      </p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <Field id="code" label={recovery ? 'Recovery code' : '6-digit code'} error={fieldError(error, recovery ? 'recovery_code' : 'code')}>
          <input id="code" inputMode={recovery ? 'text' : 'numeric'} autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} required className={field} />
        </Field>
        <FormError error={fieldError(error, 'code') || fieldError(error, 'recovery_code') ? null : error} />
        <button type="submit" disabled={busy} className={primary}>{busy ? 'Verifying…' : 'Verify'}</button>
      </form>
      <div className="mt-6 flex items-center justify-between border-t border-border pt-4 text-[13px] text-text-muted">
        <Link to="/login" className="hover:text-text-primary">Use a different account</Link>
        <button type="button" onClick={() => { setRecovery(!recovery); setCode(''); setError(null); }} className="hover:text-accent cursor-pointer">
          {recovery ? 'Use an authenticator code' : 'Use a recovery code'}
        </button>
      </div>
    </AuthLayout>
  );
};

export const LiveRegister: React.FC = () => {
  const [form, setForm] = useState({ name: '', organisation_name: '', email: '', password: '', password_confirmation: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(form);
      await qc.invalidateQueries({ queryKey: meKey });
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const anyField = ['name', 'organisation_name', 'email', 'password'].some((f) => fieldError(error, f));

  return (
    <AuthLayout>
      <AlreadySignedIn />
      <h1 className="text-[22px] font-semibold text-text-primary">Create your account</h1>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <Field id="name" label="Your name" error={fieldError(error, 'name')}>
          <input id="name" autoComplete="name" value={form.name} onChange={set('name')} required className={field} />
        </Field>
        <Field id="organisation" label="Organisation name" error={fieldError(error, 'organisation_name')}>
          <input id="organisation" value={form.organisation_name} onChange={set('organisation_name')} required className={field} />
        </Field>
        <Field id="email" label="Email" error={fieldError(error, 'email')}>
          <input id="email" type="email" autoComplete="username" value={form.email} onChange={set('email')} required className={field} />
        </Field>
        <Field id="password" label="Password" error={fieldError(error, 'password')}>
          <input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required className={field} />
        </Field>
        <Field id="password_confirmation" label="Confirm password">
          <input id="password_confirmation" type="password" autoComplete="new-password" value={form.password_confirmation} onChange={set('password_confirmation')} required className={field} />
        </Field>
        <FormError error={anyField ? null : error} />
        <button type="submit" disabled={busy} className={primary}>{busy ? 'Creating…' : 'Create account'}</button>
      </form>
      <p className="mt-4 text-[13px] text-text-muted">
        Already have an account? <Link to="/login" className="text-accent hover:underline">Sign in</Link>
      </p>
    </AuthLayout>
  );
};

/** Step 1 of onboarding: create a company. The wizard (chart, tax codes, team) continues at /:co/onboarding. */
export const LiveNewCompany: React.FC = () => {
  const [form, setForm] = useState({ name: '', legal_name: '', tax_id: '', country: 'US', base_currency: 'USD', fiscal_year_start_month: 1 });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const tenant = me.data ? currentTenant(me.data) : undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const company = await createCompany({
        name: form.name,
        legal_name: form.legal_name.trim() || null,
        tax_id: form.tax_id.trim() || null,
        country: form.country.toUpperCase(),
        base_currency: form.base_currency.toUpperCase(),
        fiscal_year_start_month: form.fiscal_year_start_month,
      });
      if (tenant) {
        // Seed the cache so the route guard sees the new company immediately, then let it refresh.
        qc.setQueryData<ApiCompany[]>(companiesKey(tenant.id), (old) => [...(old ?? []), company]);
        void qc.invalidateQueries({ queryKey: companiesKey(tenant.id) });
      }
      navigate(`/${company.slug}/onboarding`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  const anyField = ['name', 'country', 'base_currency', 'fiscal_year_start_month', 'legal_name', 'tax_id'].some((f) => fieldError(error, f));

  return (
    <AuthLayout>
      <h1 className="text-[22px] font-semibold text-text-primary">Set up your company</h1>
      <p className="mt-1 text-[13px] text-text-muted">{tenant ? `It will belong to ${tenant.name}.` : 'Companies hold the books.'}</p>
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        <Field id="company-name" label="Company name" error={fieldError(error, 'name')}>
          <input id="company-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className={field} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field id="country" label="Country (2 letters)" error={fieldError(error, 'country')}>
            <input id="country" maxLength={2} value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} required className={field} />
          </Field>
          <Field id="currency" label="Base currency" error={fieldError(error, 'base_currency')}>
            <input id="currency" maxLength={3} value={form.base_currency} onChange={(e) => setForm({ ...form, base_currency: e.target.value })} required className={field} />
          </Field>
        </div>
        <Field id="fy" label="Financial year starts in" error={fieldError(error, 'fiscal_year_start_month')}>
          <select id="fy" value={form.fiscal_year_start_month} onChange={(e) => setForm({ ...form, fiscal_year_start_month: Number(e.target.value) })} className={field}>
            {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
        </Field>
        <Field id="legal-name" label="Legal name (optional)" error={fieldError(error, 'legal_name')}>
          <input id="legal-name" value={form.legal_name} onChange={(e) => setForm({ ...form, legal_name: e.target.value })} className={field} />
        </Field>
        <Field id="tax-id" label="Tax ID (optional)" error={fieldError(error, 'tax_id')}>
          <input id="tax-id" value={form.tax_id} onChange={(e) => setForm({ ...form, tax_id: e.target.value })} className={field} />
        </Field>
        <FormError error={anyField ? null : error} />
        <button type="submit" disabled={busy} className={primary}>{busy ? 'Creating…' : 'Create company'}</button>
      </form>
    </AuthLayout>
  );
};
