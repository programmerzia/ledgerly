/**
 * Partners & Resellers Directory per docs/10_SaaS_Admin.md §3.7.
 * Accounting firms, managed tenant instances, revenue share tiers, and partner commissions.
 */

import React, { useState } from 'react';
import { useAdminStore } from '@/mock/store/adminStore';
import { Partner } from '@/types/admin';
import { toast } from 'sonner';
import { Plus, Search } from 'lucide-react';

export const PartnersList: React.FC = () => {
  const { partners } = useAdminStore();
  const [searchQuery, setSearchQuery] = useState('');

  const filteredPartners = partners.filter((p) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return p.name.toLowerCase().includes(q) || p.contactEmail.toLowerCase().includes(q);
  });

  return (
    <div className="flex-1 flex flex-col p-4 space-y-4 max-w-7xl mx-auto w-full select-none text-text-primary">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">Partners and resellers</h1>
            <span className="px-2 py-0.5 rounded-[3px] bg-surface-neutral text-text-secondary text-[11px] font-medium">
              {partners.length} certified firms
            </span>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            CPA firms and regional advisors managing multi-tenant customer portfolios with revenue share.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search partner firms"
              className="h-8 pl-8 pr-3 w-52 text-xs bg-surface border border-border rounded-md text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <button
            type="button"
            onClick={() => toast.info('Partner invitation email generated')}
            className="h-8 px-3 rounded-md bg-accent text-white hover:bg-accent-hover text-[13px] font-medium flex items-center gap-1.5 transition cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Invite accounting firm</span>
          </button>
        </div>
      </div>

      {/* Partner Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {filteredPartners.map((partner: Partner) => {
          return (
            <div key={partner.id} className="p-4 rounded-lg bg-surface border border-border space-y-3 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-md bg-surface-neutral text-text-secondary flex items-center justify-center font-semibold text-xs">
                      {partner.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-semibold text-sm text-text-primary">{partner.name}</h3>
                      <span className="text-[11px] font-mono text-text-muted">{partner.contactEmail}</span>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-[3px] text-[11px] font-mono font-semibold bg-success-soft text-success">
                    {partner.revenueSharePct}% Rev Share
                  </span>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="p-2 rounded-md bg-surface-neutral/50 border border-border">
                    <span className="text-[11px] text-text-muted">Linked tenants</span>
                    <div className="text-base font-mono font-semibold text-text-primary mt-0.5">
                      {partner.linkedTenantsCount} Organizations
                    </div>
                  </div>
                  <div className="p-2 rounded-md bg-surface-neutral/50 border border-border">
                    <span className="text-[11px] text-text-muted">Managed MRR</span>
                    <div className="text-base font-mono font-semibold text-text-secondary mt-0.5">
                      ${(partner.totalMrrContributed / 100).toLocaleString()}
                    </div>
                  </div>
                </div>

                <div className="mt-2 text-[11px] text-text-muted flex items-center justify-between">
                  <span>Partner tier: <strong className="text-text-primary font-mono">{partner.tier}</strong></span>
                  <span className="font-mono text-success">Active agreement</span>
                </div>
              </div>

              <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
                <span className="text-text-muted font-mono text-[11px]">ID: {partner.id}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
