import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerlyStore } from '@/mock/store';
import { ShieldAlert, ArrowRight, KeyRound } from 'lucide-react';

export const TwoFactor: React.FC = () => {
  const [code, setCode] = useState('829104');
  const navigate = useNavigate();
  const { currentUser, currentCompany, loginUser } = useLedgerlyStore();

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    loginUser(currentUser);
    navigate(`/${currentCompany.slug}/dashboard`);
  };

  return (
    <div className="min-h-screen bg-ink-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface border border-ink-200 rounded-xl shadow-lg p-8 flex flex-col gap-6">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-12 h-12 rounded-full bg-brand-50 text-brand-600 flex items-center justify-center mb-1 shadow-sm">
            <KeyRound className="w-6 h-6" />
          </div>
          <h1 className="text-h1 font-bold text-ink-900">Two-Factor Authentication</h1>
          <p className="text-xs text-ink-500 max-w-xs">
            Enter the 6-digit verification code from your authenticator app for{' '}
            <span className="font-semibold text-ink-900">{currentUser.email}</span>.
          </p>
        </div>

        <form onSubmit={handleVerify} className="flex flex-col gap-5">
          <div className="flex flex-col items-center gap-2">
            <input
              type="text"
              maxLength={6}
              autoFocus
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              placeholder="000000"
              className="w-48 text-center text-2xl font-mono tracking-[0.5em] h-12 bg-ink-50 border border-ink-300 rounded-sm focus:outline-none focus:border-brand-500 font-bold text-ink-900"
            />
            <span className="text-[11px] text-ink-500 font-mono">Demo pre-filled: 829104</span>
          </div>

          <button
            type="submit"
            className="h-9 bg-brand-600 hover:bg-brand-700 text-white rounded-sm text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition-colors"
          >
            <span>Verify & Enter Ledgerly</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="flex items-center justify-between text-xs text-ink-500 border-t border-ink-100 pt-4">
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="hover:text-ink-900"
          >
            Switch Account
          </button>
          <a href="#" className="text-brand-600 hover:underline">
            Use recovery code
          </a>
        </div>
      </div>
    </div>
  );
};
