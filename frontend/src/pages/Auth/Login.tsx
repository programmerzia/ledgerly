import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerlyStore } from '@/mock/store';
import { User } from '@/types';
import { Avatar } from '@/components/ui/avatar';
import { AuthLayout } from './AuthLayout';
import { ShieldCheck, ArrowRight, UserCheck } from 'lucide-react';

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
    'h-10 px-3 bg-surface border border-border rounded-lg text-[13px] text-text-primary transition focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20';
  return (
    <AuthLayout>
      <div className="flex flex-col gap-6 rounded-2xl border border-border bg-surface p-8 shadow-card">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Welcome back</h1>
          <p className="mt-1 text-[13px] text-text-muted">Sign in to your company books.</p>
        </div>

        {isAuthenticated && (
          <div className="flex items-center justify-between rounded-lg border border-success/30 bg-success-soft px-3 py-2.5 text-[13px]">
            <div className="flex items-center gap-2">
              <span className="size-2 rounded-full bg-success" />
              <span className="text-text-primary">Signed in as <strong>{currentUser.name}</strong></span>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/${currentCompany.slug}/dashboard`)}
              className="text-accent hover:underline font-semibold text-xs cursor-pointer"
            >
              Go to dashboard →
            </button>
          </div>
        )}

        <div className="flex flex-col gap-2.5">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">
            <UserCheck className="size-3.5" />
            Demo: sign in as
          </span>
          <div className="grid grid-cols-2 gap-2">
            {users.map((u: User) => {
              const isSelected = selectedRole === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => handleQuickSelect(u.id)}
                  aria-pressed={isSelected}
                  className={`flex items-center gap-2.5 rounded-xl border p-2 text-left transition ${
                    isSelected
                      ? 'border-accent bg-accent-soft/60 ring-2 ring-accent/20'
                      : 'border-border bg-surface hover:border-border-strong hover:shadow-card'
                  }`}
                >
                  <Avatar name={u.name} />
                  <span className="flex min-w-0 flex-col leading-tight">
                    <span className="truncate text-[13px] font-medium text-text-primary">{u.name}</span>
                    <span className="truncate text-[11px] text-text-muted">{u.roleTitle.split('(')[0]}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-[13px] font-medium text-text-primary">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={field} />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[13px] font-medium text-text-primary">Password</label>
              <a href="#" className="text-xs text-accent hover:underline">Forgot password?</a>
            </div>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className={field} />
          </div>

          <button
            type="submit"
            className="mt-1 flex h-10 items-center justify-center gap-2 rounded-lg bg-accent text-[13px] font-semibold text-white shadow-sm transition hover:bg-accent-hover"
          >
            <span>Continue</span>
            <ArrowRight className="size-4" />
          </button>
        </form>

        <div className="flex items-center justify-center gap-1.5 border-t border-border pt-4 text-xs text-text-muted">
          <ShieldCheck className="size-3.5 text-success" />
          <span>Protected with two-step sign-in</span>
        </div>
      </div>
    </AuthLayout>
  );
};
