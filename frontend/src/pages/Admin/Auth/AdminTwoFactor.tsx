/**
 * Platform Admin Two-Factor Authentication per docs/10_SaaS_Admin.md §1 and §10.
 * Mandatory 2FA TOTP code or FIDO2 hardware security key challenge for staff.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminStore } from '@/mock/store/adminStore';
import { AuthLayout } from '@/pages/Auth/AuthLayout';
import { toast } from 'sonner';

export const AdminTwoFactor: React.FC = () => {
  const [code, setCode] = useState('771920');
  const navigate = useNavigate();
  const { currentAdmin, loginAdmin } = useAdminStore();

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    if (code.length < 6) {
      toast.error('Enter the 6-digit code');
      return;
    }
    loginAdmin(currentAdmin.id);
    toast.success(`Signed in as ${currentAdmin.name}`);
    navigate('/admin');
  };

  const handleWebAuthnFido = () => {
    loginAdmin(currentAdmin.id);
    toast.success('Security key accepted');
    navigate('/admin');
  };

  return (
    <AuthLayout>
      <h1 className="text-[22px] font-semibold text-text-primary">Two-factor verification</h1>
      <p className="mt-1 text-[13px] text-text-muted">
        Enter the 6-digit code from your hardware token or authenticator app for{' '}
        <span className="text-text-primary">{currentAdmin.email}</span>. Platform role: {currentAdmin.role}.
      </p>

      <form onSubmit={handleVerify} className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="admin-code" className="text-[13px] font-medium text-text-primary">Code</label>
          <input
            id="admin-code"
            type="text"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-[14px] tabular-nums tracking-[0.3em] text-text-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
          <span className="text-xs text-text-muted">Demo code is pre-filled: 771920</span>
        </div>

        <button type="submit" className="mt-1 h-9 rounded-md bg-accent text-[14px] font-medium text-white transition hover:bg-accent-hover cursor-pointer">
          Verify
        </button>
      </form>

      <div className="mt-4 flex flex-col items-start gap-2 text-[13px]">
        <button type="button" onClick={handleWebAuthnFido} className="text-accent hover:underline cursor-pointer">
          Use a security key or Touch ID instead
        </button>
        <button type="button" onClick={() => navigate('/admin/login')} className="text-text-muted hover:text-text-primary cursor-pointer">
          Back to staff sign in
        </button>
      </div>
    </AuthLayout>
  );
};
