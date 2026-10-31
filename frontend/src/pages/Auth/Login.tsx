import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerlyStore } from '@/mock/store';
import { User } from '@/types';
import { AuthLayout } from './AuthLayout';

export const Login: React.FC = () => {
  const [email, setEmail] = useState('rahim@acmegroup.so');
  const [password, setPassword] = useState('••••••••••••');
  const [selectedRole, setSelectedRole] = useState('usr-1'); // Rahim
  const navigate = useNavigate();
  const { users, setCurrentUser, isAuthenticated, currentUser, currentCompany } = useLedgerlyStore();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setCurrentUser(selectedRole);
    navigate('/two-factor-challenge');
  };

  const handleQuickSelect = (userId: string) => {
    setSelectedRole(userId);
    const u = users.find((x: User) => x.id === userId);
    if (u) setEmail(u.email);
  };

  const field =
    'h-9 px-3 bg-surface border border-border-strong rounded-md text-[14px] text-text-primary transition focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/15';
  return (
    <AuthLayout>
      <h1 className="text-[22px] font-semibold text-text-primary">Sign in</h1>

      {isAuthenticated && (
        <p className="mt-3 text-[13px] text-text-secondary">
          You're signed in as {currentUser.name}.{' '}
          <button type="button" onClick={() => navigate(`/${currentCompany.slug}/dashboard`)} className="text-accent hover:underline cursor-pointer">
            Go to your books
          </button>
        </p>
      )}

      <form onSubmit={handleLogin} className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="email" className="text-[13px] font-medium text-text-primary">Email</label>
          <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required className={field} />
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="text-[13px] font-medium text-text-primary">Password</label>
            <a href="#" className="text-xs text-text-muted hover:text-accent">Forgot it?</a>
          </div>
          <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className={field} />
        </div>

        <button type="submit" className="mt-1 h-9 rounded-md bg-accent text-[14px] font-medium text-white transition hover:bg-accent-hover cursor-pointer">
          Sign in
        </button>
      </form>

      <p className="mt-4 text-[13px] text-text-muted">
        New to Ledgerly? <a href="#" className="text-accent hover:underline">Create an account</a>
      </p>

      <section className="mt-10 border-t border-border pt-5">
        <h2 className="text-xs font-medium text-text-muted">Demo accounts</h2>
        <p className="mt-1 text-xs text-text-muted">Each person has a different role, so you can try approvals from both sides.</p>
        <ul className="mt-3 border border-border rounded-md bg-surface divide-y divide-border">
          {users.map((u: User) => {
            const isSelected = selectedRole === u.id;
            return (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => handleQuickSelect(u.id)}
                  aria-pressed={isSelected}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-[13px] transition cursor-pointer ${isSelected ? 'bg-accent-soft' : 'hover:bg-canvas'}`}
                >
                  <span className="text-text-primary">{u.name}</span>
                  <span className="text-xs text-text-muted">{u.roleTitle.split('(')[0].trim()}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </AuthLayout>
  );
};
