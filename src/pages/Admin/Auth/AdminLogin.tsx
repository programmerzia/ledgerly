/**
 * Platform Admin Staff Login per docs/10_SaaS_Admin.md §1, §2, and §10.
 * Staff credentials with mandatory 2FA enforcement and quick persona selector.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminStore } from '@/mock/store/adminStore';
import { AdminUser } from '@/types/admin';
import { ShieldCheck, ArrowRight, UserCheck, Lock, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

export const AdminLogin: React.FC = () => {
  const navigate = useNavigate();
  const { staffUsers, currentAdmin, switchAdminStaff } = useAdminStore();

  const [selectedStaffId, setSelectedStaffId] = useState(currentAdmin.id);
  const [email, setEmail] = useState(currentAdmin.email);
  const [password, setPassword] = useState('••••••••••••');

  const handleQuickSelect = (staff: AdminUser) => {
    setSelectedStaffId(staff.id);
    setEmail(staff.email);
    switchAdminStaff(staff.id);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    switchAdminStaff(selectedStaffId);
    toast.info('Credentials validated. Two-factor authentication required.');
    navigate('/admin/two-factor');
  };

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-surface border border-border rounded-xl shadow-lg p-7 flex flex-col gap-6">
        {/* Header */}
        <div className="flex flex-col items-center text-center gap-2">
          <div className="w-11 h-11 rounded-lg bg-violet text-white flex items-center justify-center font-bold text-xl shadow-xs">
            Ω
          </div>
          <div>
            <h1 className="text-lg font-bold text-text-primary tracking-tight">Ledgerly Platform Admin</h1>
            <p className="text-xs text-text-muted mt-0.5">
              Vendor back-office & operator console (Staff Only)
            </p>
          </div>
          <div className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-violet-soft text-violet text-[11px] font-medium font-mono">
            <Lock className="w-3 h-3" />
            <span>Strict 2FA + Hardware Key Enforced</span>
          </div>
        </div>

        {/* Staff Persona Fast-Selector */}
        <div className="flex flex-col gap-2 p-3 bg-violet-soft/30 rounded-md border border-violet-soft">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-violet uppercase tracking-wider flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5" />
              Demo Staff Personas
            </span>
            <span className="text-[10px] text-text-muted font-mono">Select to test</span>
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {staffUsers.slice(0, 6).map((staff) => {
              const isSelected = selectedStaffId === staff.id;
              return (
                <button
                  key={staff.id}
                  type="button"
                  onClick={() => handleQuickSelect(staff)}
                  className={`p-2 rounded border text-left flex flex-col transition-all cursor-pointer ${
                    isSelected
                      ? 'border-violet bg-surface shadow-xs font-semibold'
                      : 'border-border bg-surface/60 text-text-secondary hover:border-border-strong'
                  }`}
                >
                  <span className="truncate text-text-primary text-[11px]">{staff.name}</span>
                  <span className="text-[10px] text-violet font-mono uppercase">{staff.role}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Login Form */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
          <div className="flex flex-col gap-1">
            <label className="text-xs font-medium text-text-secondary">Staff Corporate Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="h-8 px-2.5 bg-surface border border-border rounded-sm text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-text-secondary">Password</label>
              <span className="text-[10px] text-text-muted">SSO / Okta Enabled</span>
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="h-8 px-2.5 bg-surface border border-border rounded-sm text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <button
            type="submit"
            className="h-9 mt-2 bg-violet hover:opacity-90 text-white rounded-sm text-xs font-semibold flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
          >
            <span>Authenticate Staff Session</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        {/* Footer info & link to tenant login */}
        <div className="pt-2 border-t border-border flex items-center justify-between text-[11px] text-text-muted">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-success" />
            IP: 197.232.88.14 (Allowlisted)
          </span>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="hover:text-text-primary flex items-center gap-1 cursor-pointer"
          >
            Tenant Login <ExternalLink className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
};
