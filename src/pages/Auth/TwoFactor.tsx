import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerlyStore } from '@/mock/store';
import { AuthLayout } from './AuthLayout';
import { ArrowRight, KeyRound } from 'lucide-react';

export const TwoFactor: React.FC = () => {
  const [code, setCode] = useState('829104');
  const navigate = useNavigate();
  const { currentUser, currentCompany, loginUser } = useLedgerlyStore();

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    loginUser(currentUser);
    navigate(`/${currentCompany.slug}/dashboard`);
  };

  const digits = code.padEnd(6, ' ').slice(0, 6).split('');
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <AuthLayout>
      <div className="flex flex-col gap-6 rounded-2xl border border-border bg-surface p-8 shadow-card">
        <div className="flex flex-col gap-3">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-accent-soft to-violet-soft text-accent ring-1 ring-inset ring-border">
            <KeyRound className="size-6" />
          </span>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-text-primary">Check your authenticator</h1>
            <p className="mt-1 text-[13px] text-text-muted">
              Enter the 6-digit code from your app for{' '}
              <span className="font-medium text-text-primary">{currentUser.email}</span>.
            </p>
          </div>
        </div>

        <form onSubmit={handleVerify} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="relative flex justify-between gap-2" onClick={() => inputRef.current?.focus()}>
              {digits.map((d, i) => (
                <span
                  key={i}
                  className={`flex h-14 flex-1 items-center justify-center rounded-xl border bg-surface-neutral/50 font-mono text-2xl font-semibold text-text-primary transition ${
                    i === Math.min(code.length, 5) ? 'border-accent ring-2 ring-accent/20' : 'border-border'
                  }`}
                >
                  {d.trim()}
                </span>
              ))}
              <input
                ref={inputRef}
                type="text"
                inputMode="numeric"
                maxLength={6}
                autoFocus
                aria-label="6-digit verification code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                className="absolute inset-0 h-full w-full cursor-text opacity-0"
              />
            </div>
            <span className="text-xs text-text-muted">Demo: the code is already filled in (829104).</span>
          </div>

          <button
            type="submit"
            className="flex h-10 items-center justify-center gap-2 rounded-lg bg-accent text-[13px] font-semibold text-white shadow-sm transition hover:bg-accent-hover"
          >
            <span>Verify and sign in</span>
            <ArrowRight className="size-4" />
          </button>
        </form>

        <div className="flex items-center justify-between border-t border-border pt-4 text-[13px] text-text-muted">
          <button type="button" onClick={() => navigate('/login')} className="hover:text-text-primary cursor-pointer">
            Use a different account
          </button>
          <a href="#" className="text-accent hover:underline">Use a recovery code</a>
        </div>
      </div>
    </AuthLayout>
  );
};
