/**
 * Platform Admin Staff Login per docs/10_SaaS_Admin.md §1, §2, and §10.
 * Staff credentials with mandatory 2FA enforcement and quick persona selector.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAdminStore } from '@/mock/store/adminStore';
import { AdminUser } from '@/types/admin';
import { AuthLayout } from '@/pages/Auth/AuthLayout';
import { toast } from 'sonner';

export const AdminLogin: React.FC = () => {
  const navigate = useNavigate();
  const { staffUsers, currentAdmin, switchAdminStaff, isAdminAuthenticated } = useAdminStore();

  const [selectedStaffId, setSelectedStaffId] = useState(currentAdmin.id);
  const [email, setEmail] = useState(currentAdmin.email);
  const [password, setPassword] = useState('••••••••••••');

  const field =
    'h-9 w-full rounded-md border border-border-strong bg-surface px-3 text-[14px] text-text-primary outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20';

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
    <AuthLayout>
      <h1 className="text-[22px] font-semibold text-text-primary">Platform admin sign in</h1>
      <p className="mt-1 text-[13px] text-text-muted">Vendor back office, staff only. Two-factor and a hardware key are required.</p>

      {isAdminAuthenticated && (
        <p className="mt-3 text-[13px] text-text-secondary">
          Signed in as {currentAdmin.name}.{' '}
          <button type="button" onClick={() => navigate('/admin')} className="text-accent hover:underline cursor-pointer">
            Go to the console
          </button>
        </p>
      )}

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label htmlFor="admin-email" className="text-[13px] font-medium text-text-primary">Staff email</label>
          <input id="admin-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={field} />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor="admin-password" className="text-[13px] font-medium text-text-primary">Password</label>
          <input id="admin-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required className={field} />
        </div>

        <button type="submit" className="mt-1 h-9 rounded-md bg-accent text-[14px] font-medium text-white transition hover:bg-accent-hover cursor-pointer">
          Continue
        </button>
      </form>

      <p className="mt-4 text-[13px] text-text-muted">
        Not staff?{' '}
        <button type="button" onClick={() => navigate('/login')} className="text-accent hover:underline cursor-pointer">Go to the customer sign in</button>
      </p>

      <section className="mt-10 border-t border-border pt-5">
        <h2 className="text-xs font-medium text-text-muted">Demo staff accounts</h2>
        <ul className="mt-3 border border-border rounded-md bg-surface divide-y divide-border">
          {staffUsers.slice(0, 6).map((staff) => {
            const isSelected = selectedStaffId === staff.id;
            return (
              <li key={staff.id}>
                <button
                  type="button"
                  onClick={() => handleQuickSelect(staff)}
                  aria-pressed={isSelected}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left text-[13px] transition cursor-pointer ${isSelected ? 'bg-accent-soft' : 'hover:bg-canvas'}`}
                >
                  <span className="text-text-primary">{staff.name}</span>
                  <span className="text-xs text-text-muted capitalize">{staff.role}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </AuthLayout>
  );
};
