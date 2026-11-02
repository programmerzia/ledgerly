/**
 * Live Settings: company details, posting accounts, approvals, security, team, API access and webhooks. A tab only appears
 * for someone the server lets use it (settings.can.update, manage_members); 403s on a screen are still handled there.
 */
import React from 'react';
import { NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/domain/PageHeader';
import { ApiError } from '@/api/errors';
import { currentTenant } from '@/api/adapters/session';
import { useMe } from '@/data/session';
import { useSettings } from '@/data/admin';
import { useCurrentCompany } from '@/data/team';
import { cn } from '@/lib/utils';
import { LiveApiClients } from './LiveApiClients';
import { LiveGeneral } from './LiveGeneral';
import { LivePosting } from './LivePosting';
import { LiveSecurity } from './LiveSecurity';
import { LiveTeam } from './LiveTeam';
import { LiveWebhooks } from './LiveWebhooks';
import { LiveWorkflows } from './LiveWorkflows';

export const LiveSettings: React.FC = () => {
  const { co } = useParams();
  const company = useCurrentCompany();
  const me = useMe();
  const settings = useSettings(company.id);
  const canManage = Boolean(me.data && currentTenant(me.data)?.can.manage_members);
  // While loading, assume the company tabs are there; a 403 on the settings read takes them away.
  const forbidden = settings.error instanceof ApiError && settings.error.status === 403;
  const companyTabs = !forbidden;
  const canApprovals = companyTabs && (settings.isPending || Boolean(settings.data?.can.update));
  const tabs = [
    { to: 'general', label: 'Company', show: companyTabs },
    { to: 'posting', label: 'Posting accounts', show: companyTabs },
    { to: 'workflows', label: 'Approvals', show: canApprovals },
    { to: 'security', label: 'Security', show: true },
    { to: 'team', label: 'Team', show: canManage },
    { to: 'api-clients', label: 'API access', show: canManage },
    { to: 'webhooks', label: 'Webhooks', show: canManage },
  ].filter((t) => t.show);
  const first = tabs[0]?.to ?? 'security';

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      <PageHeader title="Settings" />
      <nav aria-label="Settings" className="flex flex-wrap gap-1 border-b border-border">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={`/${co}/settings/${t.to}`}
            className={({ isActive }) => cn('-mb-px border-b-2 px-3 py-2 text-[13px] font-medium', isActive ? 'border-accent text-text-primary' : 'border-transparent text-text-muted hover:text-text-primary')}
          >
            {t.label}
          </NavLink>
        ))}
      </nav>
      <Routes>
        <Route path="general" element={companyTabs ? <LiveGeneral /> : <Navigate to="../security" replace />} />
        <Route path="posting" element={companyTabs ? <LivePosting /> : <Navigate to="../security" replace />} />
        <Route path="workflows" element={canApprovals ? <LiveWorkflows /> : <Navigate to="../security" replace />} />
        <Route path="security" element={<LiveSecurity />} />
        <Route path="team" element={canManage ? <LiveTeam /> : <Navigate to="../security" replace />} />
        <Route path="api-clients" element={canManage ? <LiveApiClients /> : <Navigate to="../security" replace />} />
        <Route path="webhooks" element={canManage ? <LiveWebhooks /> : <Navigate to="../security" replace />} />
        <Route path="*" element={<Navigate to={first} replace />} />
      </Routes>
    </div>
  );
};
