import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLedgerlyStore } from '@/mock/store';
import { User } from '@/types';
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

  return (
    <div className="min-h-screen bg-ink-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface border border-ink-200 rounded-xl shadow-lg p-8 flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-10 h-10 rounded-lg bg-brand-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
            L
          </div>
          <h1 className="text-h1 font-bold text-ink-900">Ledgerly</h1>
          <p className="text-xs text-ink-500">
            Controls-grade multi-tenant general ledger & financial controls
          </p>
        </div>

        {isAuthenticated && (
          <div className="p-3 bg-brand-50 border border-brand-200 rounded-md flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-success inline-block" />
              <span className="text-ink-700">Signed in as <strong>{currentUser.name}</strong></span>
            </div>
            <button
              type="button"
              onClick={() => navigate(`/${currentCompany.slug}/dashboard`)}
              className="text-brand-600 hover:text-brand-800 font-semibold underline text-[11px] cursor-pointer"
            >
              Go to Dashboard →
            </button>
          </div>
        )}

        {/* Demo Fast-Switch User Selector */}
        <div className="flex flex-col gap-2 p-3 bg-brand-50/60 rounded-md border border-brand-100">
          <span className="text-[11px] font-semibold text-brand-700 uppercase tracking-wider flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5" />
            Quick Demo Persona Login
          </span>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {users.map((u: User) => {
              const isSelected = selectedRole === u.id;
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => handleQuickSelect(u.id)}
                  className={`p-2 rounded border text-left flex flex-col transition-all ${
                    isSelected
                      ? 'border-brand-500 bg-surface shadow-sm text-brand-700 font-semibold'
                      : 'border-ink-200 bg-surface/50 text-ink-700 hover:border-ink-300'
                  }`}
                >
                  <span className="truncate">{u.name}</span>
                  <span className="text-[10px] text-ink-500 font-normal">{u.roleTitle.split('(')[0]}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Login Form */}
        <form onSubmit={handleLogin} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink-700">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-9 px-3 bg-surface border border-ink-200 rounded-sm text-xs text-ink-900 focus:outline-none focus:border-brand-500"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-ink-700">Password</label>
              <a href="#" className="text-[11px] text-brand-600 hover:underline">
                Forgot password?
              </a>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-9 px-3 bg-surface border border-ink-200 rounded-sm text-xs text-ink-900 focus:outline-none focus:border-brand-500"
            />
          </div>

          <button
            type="submit"
            className="h-9 mt-2 bg-brand-600 hover:bg-brand-700 text-white rounded-sm text-xs font-semibold flex items-center justify-center gap-2 shadow-sm transition-colors"
          >
            <span>Proceed to 2FA Challenge</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="text-center text-[11px] text-ink-500 border-t border-ink-100 pt-4 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-3.5 h-3.5 text-success" />
          <span>SOC 1 Type II & ISO 27001 Controls Enforced</span>
        </div>
      </div>
    </div>
  );
};
