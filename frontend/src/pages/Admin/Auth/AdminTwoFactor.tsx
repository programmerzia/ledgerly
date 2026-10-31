/**
 * Platform Admin Two-Factor Authentication per docs/10_SaaS_Admin.md §1 and §10.
 * Mandatory 2FA TOTP code or FIDO2 hardware security key challenge for staff.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminStore } from '@/mock/store/adminStore';
import { ShieldCheck, ArrowRight, KeyRound, Lock, Fingerprint } from 'lucide-react';
import { toast } from 'sonner';

export const AdminTwoFactor: React.FC = () => {
  const [code, setCode] = useState('771920');
  const navigate = useNavigate();
  const { currentAdmin, loginAdmin } = useAdminStore();

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < 6) {
      toast.error('Please enter a valid 6-digit TOTP code');
      return;
    }
    loginAdmin(currentAdmin.id);
    toast.success(`Staff session active: Welcome back, ${currentAdmin.name}!`);
    navigate('/admin');
  };

  const handleWebAuthnFido = () => {
    loginAdmin(currentAdmin.id);
    toast.success('Hardware Security Key (FIDO2) acknowledged. Cryptographic sign valid.');
    navigate('/admin');
  };

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface border border-border rounded-xl shadow-lg p-7 flex flex-col gap-6">
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-12 h-12 rounded-full bg-violet-soft text-violet flex items-center justify-center mb-1 shadow-xs">
            <KeyRound className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-text-primary tracking-tight">Staff Two-Factor Verification</h1>
          <p className="text-xs text-text-muted max-w-xs">
            Enter the 6-digit time-based code from your hardware token or authenticator app for{' '}
            <span className="font-semibold text-text-primary">{currentAdmin.email}</span>.
          </p>
          <div className="px-2 py-0.5 rounded bg-surface-neutral border border-border text-[11px] font-mono text-text-secondary uppercase">
            Platform Role: {currentAdmin.role}
          </div>
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
              className="w-52 text-center text-2xl font-mono tracking-[0.4em] h-12 bg-surface-neutral border border-border-strong rounded-sm focus:outline-none focus:ring-1 focus:ring-accent font-bold text-text-primary"
            />
            <span className="text-[11px] text-text-muted font-mono">Demo pre-filled: 771920</span>
          </div>

          <button
            type="submit"
            className="h-9 bg-violet hover:opacity-90 text-white rounded-sm text-xs font-semibold flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
          >
            <span>Verify & Access Back-Office</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <div className="flex flex-col gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={handleWebAuthnFido}
            className="h-8 px-3 rounded-sm border border-border hover:border-border-strong bg-surface text-text-secondary hover:text-text-primary text-xs flex items-center justify-center gap-2 transition cursor-pointer"
          >
            <Fingerprint className="w-4 h-4 text-violet" />
            <span>Use YubiKey / Touch ID (FIDO2)</span>
          </button>

          <div className="flex items-center justify-between text-xs text-text-muted pt-2">
            <button
              type="button"
              onClick={() => navigate('/admin/login')}
              className="hover:text-text-primary cursor-pointer"
            >
              ← Back to Staff Login
            </button>
            <span className="font-mono text-[10px] text-success flex items-center gap-1">
              <ShieldCheck className="w-3 h-3 text-success" />
              mTLS Encrypted
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
