/**
 * Live-mode account screens reached from an email link or the sign-in page: forgot password, reset password,
 * accept an invitation. Same layout and field styling as the sign-in screens.
 */
import React, { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AuthLayout } from './AuthLayout';
import { requestPasswordReset, resetPassword } from '@/api/live/account';
import { logout } from '@/api/live/session';
import { acceptInvitation, previewInvitation } from '@/api/live/team';
import { ApiError } from '@/api/errors';
import { describeError, fieldError } from '@/api/messages';
import { invitationView, viewForAcceptError, type InvitationView } from '@/api/adapters/invitation';
import { rememberNextPath } from '@/api/adapters/security';
import { Field, FormError, Loading, LoadError, field, primary } from '@/components/live/form';
import { forgetSession, meKey, useMe } from '@/data/session';
import { queryClient } from '@/api/queryClient';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const LiveForgotPassword: React.FC = () => {
  const [params] = useSearchParams();
  const [email, setEmail] = useState(params.get('email') ?? '');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!EMAIL.test(email.trim())) {
      setError(new ApiError({ status: 422, code: 'validation_failed', detail: '', errors: { email: ['Enter a valid email address.'] }, requestId: null }));
      return;
    }
    setBusy(true);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout>
      <h1 className="text-[22px] font-semibold text-text-primary">Reset your password</h1>
      {sent ? (
        <div className="mt-4 flex flex-col gap-4">
          <p role="status" className="text-[14px] text-text-secondary">
            If there is an account for <span className="font-medium text-text-primary">{email.trim()}</span>, a link to choose a new password is on its way. It works for 60 minutes.
          </p>
          <Link to="/login" className="text-[13px] text-accent hover:underline">Back to sign in</Link>
        </div>
      ) : (
        <>
          <p className="mt-1 text-[13px] text-text-muted">Enter the email you sign in with and we will send you a link.</p>
          <form onSubmit={submit} noValidate className="mt-6 flex flex-col gap-4">
            <Field id="email" label="Email" error={fieldError(error, 'email')}>
              <input id="email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} required className={field} />
            </Field>
            <FormError error={fieldError(error, 'email') ? null : error} />
            <button type="submit" disabled={busy} className={primary}>{busy ? 'Sending…' : 'Send reset link'}</button>
          </form>
          <p className="mt-4 text-[13px] text-text-muted"><Link to="/login" className="text-accent hover:underline">Back to sign in</Link></p>
        </>
      )}
    </AuthLayout>
  );
};

export const LiveResetPassword: React.FC = () => {
  const { token = '' } = useParams();
  const [params] = useSearchParams();
  const emailFromLink = params.get('email') ?? '';
  const [email, setEmail] = useState(emailFromLink);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await resetPassword({ token, email, password, password_confirmation: confirmation });
      setDone(true);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const linkProblem = error instanceof ApiError && error.code === 'reset_link_invalid';
  const anyField = ['password', 'email'].some((f) => fieldError(error, f));

  if (done) {
    return (
      <AuthLayout>
        <h1 className="text-[22px] font-semibold text-text-primary">Password changed</h1>
        <p role="status" className="mt-2 text-[14px] text-text-secondary">You can sign in with your new password now.</p>
        <Link to="/login" className={`${primary} mt-6 inline-flex items-center justify-center`}>Sign in</Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <h1 className="text-[22px] font-semibold text-text-primary">Choose a new password</h1>
      {linkProblem && (
        <div role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger-soft px-3 py-2.5 text-[13px] text-danger">
          This link has expired or was already used. <Link to={`/forgot-password?email=${encodeURIComponent(emailFromLink)}`} className="underline">Ask for a new one</Link>.
        </div>
      )}
      <form onSubmit={submit} className="mt-6 flex flex-col gap-4">
        {emailFromLink === '' ? (
          <Field id="email" label="Email" error={linkProblem ? undefined : fieldError(error, 'email')}>
            <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required className={field} />
          </Field>
        ) : (
          <Field id="email" label="Email">
            <input id="email" type="email" autoComplete="username" value={email} readOnly className={`${field} bg-surface-neutral`} />
          </Field>
        )}
        <Field id="password" label="New password" error={fieldError(error, 'password')}>
          <input id="password" type="password" autoComplete="new-password" autoFocus value={password} onChange={(e) => setPassword(e.target.value)} required className={field} />
        </Field>
        <Field id="password_confirmation" label="Confirm new password">
          <input id="password_confirmation" type="password" autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} required className={field} />
        </Field>
        <FormError error={anyField || linkProblem ? null : error} />
        <button type="submit" disabled={busy} className={primary}>{busy ? 'Saving…' : 'Change password'}</button>
      </form>
      <p className="mt-4 text-[13px] text-text-muted"><Link to="/login" className="text-accent hover:underline">Back to sign in</Link></p>
    </AuthLayout>
  );
};

/* ------------------------------------------------------------------ invitation */

const Notice: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <div>
    <h1 className="text-[22px] font-semibold text-text-primary">{title}</h1>
    <div className="mt-2 flex flex-col gap-4 text-[14px] text-text-secondary">{children}</div>
  </div>
);

export const LiveAcceptInvitation: React.FC = () => {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const me = useMe();
  const preview = useQuery({ queryKey: ['invitation', token], queryFn: () => previewInvitation(token), retry: false });
  const signedInEmail = me.data?.email ?? null;

  const [form, setForm] = useState({ name: '', password: '', password_confirmation: '' });
  const [error, setError] = useState<unknown>(null);
  const [override, setOverride] = useState<InvitationView | null>(null);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  const accept = useMutation({
    mutationFn: (withAccount: boolean) => acceptInvitation(token, withAccount ? undefined : form),
    onSuccess: async () => {
      // The server signed the new person in (or switched the signed-in one) to the organisation.
      qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'invitation' });
      await qc.invalidateQueries({ queryKey: meKey });
      navigate('/');
    },
    onError: (err) => {
      const viewForError = err instanceof ApiError ? viewForAcceptError(err.code, signedInEmail) : null;
      if (viewForError) setOverride(viewForError);
      else setError(err);
    },
  });

  const signOutAndStay = useMutation({
    mutationFn: async () => {
      try {
        await logout();
      } finally {
        forgetSession(queryClient);
      }
    },
    onSuccess: () => setOverride(null),
  });

  if (preview.isPending || me.isPending) {
    return <AuthLayout><Loading what="Checking your invitation" /></AuthLayout>;
  }
  if (preview.isError) {
    const gone = preview.error instanceof ApiError && preview.error.status === 404;
    return (
      <AuthLayout>
        {gone ? (
          <Notice title="This invitation link is not valid">
            <p>It may have been copied incompletely. Ask the person who invited you to send it again.</p>
            <Link to="/login" className="text-accent hover:underline">Go to sign in</Link>
          </Notice>
        ) : (
          <LoadError error={preview.error} onRetry={() => void preview.refetch()} />
        )}
      </AuthLayout>
    );
  }

  const inv = preview.data;
  const view = override ?? invitationView(inv, signedInEmail);
  const signInHere = () => rememberNextPath(`/invitations/${token}`);
  const roleText = inv.company_role ? `${inv.company_role}` : inv.role === 'member' ? 'Member' : inv.role === 'owner' ? 'Owner' : 'Administrator';

  switch (view.kind) {
    case 'expired':
      return (
        <AuthLayout>
          <Notice title="This invitation has expired">
            <p>The link to join {inv.organisation} is no longer valid. Ask the person who invited you to send a new one.</p>
            <Link to="/login" className="text-accent hover:underline">Go to sign in</Link>
          </Notice>
        </AuthLayout>
      );
    case 'revoked':
      return (
        <AuthLayout>
          <Notice title="This invitation was withdrawn">
            <p>{inv.organisation} cancelled this invitation. If you think that is a mistake, ask them to invite you again.</p>
            <Link to="/login" className="text-accent hover:underline">Go to sign in</Link>
          </Notice>
        </AuthLayout>
      );
    case 'accepted':
      return (
        <AuthLayout>
          <Notice title="This invitation was already used">
            {signedInEmail?.toLowerCase() === inv.email.toLowerCase() ? (
              <>
                <p>You have joined {inv.organisation}.</p>
                <Link to="/" className={`${primary} inline-flex items-center justify-center`}>Open Ledgerly</Link>
              </>
            ) : (
              <>
                <p>{inv.email} has joined {inv.organisation}. Sign in to open it.</p>
                <Link to="/login" onClick={signInHere} className={`${primary} inline-flex items-center justify-center`}>Sign in</Link>
              </>
            )}
          </Notice>
        </AuthLayout>
      );
    case 'wrong_user':
      return (
        <AuthLayout>
          <Notice title="This invitation is for someone else">
            <p>
              You are signed in as <span className="font-medium text-text-primary">{view.signedInAs}</span>, but this invitation to join {inv.organisation} was sent to{' '}
              <span className="font-medium text-text-primary">{inv.email}</span>.
            </p>
            <button type="button" disabled={signOutAndStay.isPending} onClick={() => signOutAndStay.mutate()} className={primary}>
              {signOutAndStay.isPending ? 'Signing out…' : `Sign out and continue as ${inv.email}`}
            </button>
            <Link to="/" className="text-[13px] text-text-muted hover:text-text-primary">Stay signed in as {view.signedInAs}</Link>
          </Notice>
        </AuthLayout>
      );
    case 'sign_in':
      return (
        <AuthLayout>
          <Notice title={`Join ${inv.organisation}`}>
            <p>
              You were invited as <span className="font-medium text-text-primary">{roleText}</span>. <span className="font-medium text-text-primary">{inv.email}</span> already has an account, so sign in with it to accept.
            </p>
            <Link to={`/login?email=${encodeURIComponent(inv.email)}`} onClick={signInHere} className={`${primary} inline-flex items-center justify-center`}>Sign in to accept</Link>
          </Notice>
        </AuthLayout>
      );
    case 'accept_signed_in':
      return (
        <AuthLayout>
          <Notice title={`Join ${inv.organisation}`}>
            <p>
              You are signed in as <span className="font-medium text-text-primary">{inv.email}</span> and invited as <span className="font-medium text-text-primary">{roleText}</span>.
            </p>
            <FormError error={error} />
            <button type="button" disabled={accept.isPending} onClick={() => { setError(null); accept.mutate(true); }} className={primary}>
              {accept.isPending ? 'Joining…' : `Join ${inv.organisation}`}
            </button>
          </Notice>
        </AuthLayout>
      );
    case 'create_account': {
      const anyField = ['name', 'password'].some((f) => fieldError(error, f));
      return (
        <AuthLayout>
          <h1 className="text-[22px] font-semibold text-text-primary">Join {inv.organisation}</h1>
          <p className="mt-1 text-[13px] text-text-muted">
            You were invited as {roleText}. Choose a password to create your account.
          </p>
          <form onSubmit={(e) => { e.preventDefault(); setError(null); accept.mutate(false); }} className="mt-6 flex flex-col gap-4">
            <Field id="email" label="Email">
              <input id="email" type="email" value={inv.email} readOnly className={`${field} bg-surface-neutral`} />
            </Field>
            <Field id="name" label="Your name" error={fieldError(error, 'name')}>
              <input id="name" autoComplete="name" autoFocus value={form.name} onChange={set('name')} required className={field} />
            </Field>
            <Field id="password" label="Password" error={fieldError(error, 'password')}>
              <input id="password" type="password" autoComplete="new-password" value={form.password} onChange={set('password')} required className={field} />
            </Field>
            <Field id="password_confirmation" label="Confirm password">
              <input id="password_confirmation" type="password" autoComplete="new-password" value={form.password_confirmation} onChange={set('password_confirmation')} required className={field} />
            </Field>
            {!anyField && error ? <p role="alert" className="text-[13px] text-danger">{describeError(error)}</p> : null}
            <button type="submit" disabled={accept.isPending} className={primary}>{accept.isPending ? 'Creating…' : 'Create account and join'}</button>
          </form>
          <p className="mt-4 text-[13px] text-text-muted">
            Already have an account with a different email? <Link to="/login" className="text-accent hover:underline">Sign in</Link>
          </p>
        </AuthLayout>
      );
    }
  }
};
