/**
 * Live Settings: only what is connected to the API (Security, and Team for people allowed to manage it).
 * Company profile, numbering, posting accounts and the rest stay on the demo screen until their step.
 */
import React from 'react';
import { NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/domain/PageHeader';
import { currentTenant } from '@/api/adapters/session';
import { useMe } from '@/data/session';
import { cn } from '@/lib/utils';
import { LiveSecurity } from './LiveSecurity';
import { LiveTeam } from './LiveTeam';

export const LiveSettings: React.FC = () => {
  const { co } = useParams();
  const me = useMe();
  const canManage = Boolean(me.data && currentTenant(me.data)?.can.manage_members);
  const tabs = [
    { to: `/${co}/settings/security`, label: 'Security', show: true },
    { to: `/${co}/settings/team`, label: 'Team', show: canManage },
  ].filter((t) => t.show);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <PageHeader title="Settings" subtitle="Company profile, numbering and posting accounts are not connected to your books yet." />
      <nav aria-label="Settings" className="flex gap-1 border-b border-border">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            className={({ isActive }) => cn('-mb-px border-b-2 px-3 py-2 text-[13px] font-medium', isActive ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-primary')}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route path="security" element={<LiveSecurity />} />
        <Route path="team" element={canManage ? <LiveTeam /> : <Navigate to="../security" replace />} />
        <Route path="*" element={<Navigate to="security" replace />} />
      </Routes>
    </div>
  );
};
