import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerlyStore } from '@/mock/store';
import { AuthLayout } from './AuthLayout';

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
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-[22px] font-semibold text-text-primary">Enter your code</h1>
          <p className="mt-1 text-[13px] text-text-muted">
            From the authenticator app you set up for <span className="text-text-primary">{currentUser.email}</span>.
          </p>
        </div>

        <form onSubmit={handleVerify} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <div className="relative flex justify-between gap-2" onClick={() => inputRef.current?.focus()}>
              {digits.map((d, i) => (
                <span
                  key={i}
                  className={`flex h-12 flex-1 items-center justify-center rounded-md border bg-surface font-code text-xl text-text-primary transition ${
                    i === Math.min(code.length, 5) ? 'border-accent ring-2 ring-accent/15' : 'border-border-strong'
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
            <span className="text-xs text-text-muted">Demo: the code 829104 is filled in for you.</span>
          </div>

          <button
            type="submit"
            className="h-9 rounded-md bg-accent text-[14px] font-medium text-white transition hover:bg-accent-hover cursor-pointer"
          >
            Verify
          </button>
        </form>

        <div className="flex items-center justify-between border-t border-border pt-4 text-[13px] text-text-muted">
          <button type="button" onClick={() => navigate('/login')} className="hover:text-text-primary cursor-pointer">
            Use a different account
          </button>
          <a href="#" className="text-text-muted hover:text-accent">Use a recovery code</a>
        </div>
      </div>
    </AuthLayout>
  );
};
