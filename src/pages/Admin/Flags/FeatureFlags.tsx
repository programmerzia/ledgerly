/**
 * Pennant Feature Flags Manager per docs/10_SaaS_Admin.md §3.10.
 * Dynamic rollout percentages, kill switches, per-plan gating,
 * and per-tenant override controls.
 */

import React, { useState } from 'react';
import { useAdminStore } from '@/mock/store/adminStore';
import { PennantFeatureFlag } from '@/types/admin';
import { toast } from 'sonner';
import {
  Flag,
  Percent,
  CheckCircle2,
  AlertTriangle,
  Sliders,
  ShieldAlert,
  Search,
  Building2,
} from 'lucide-react';

export const FeatureFlags: React.FC = () => {
  const { featureFlags, updateFeatureFlagRollout, toggleFeatureFlagTenantOverride, tenants } = useAdminStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFlagForOverrides, setSelectedFlagForOverrides] = useState<PennantFeatureFlag | null>(null);

  const filteredFlags = featureFlags.filter((f) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return f.name.toLowerCase().includes(q) || f.key.toLowerCase().includes(q) || f.description.toLowerCase().includes(q);
  });

  const handleRolloutChange = (flagId: string, percentage: number) => {
    updateFeatureFlagRollout(flagId, percentage);
    toast.success(`Rollout updated to ${percentage}%`);
  };

  return (
    <div className="flex-1 flex flex-col p-4 space-y-4 max-w-7xl mx-auto w-full select-none text-text-primary">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight">Pennant Feature Flags & Gating</h1>
            <span className="px-2 py-0.5 rounded-full bg-violet-soft text-violet text-[10px] font-mono font-semibold">
              {featureFlags.length} Defined Flags
            </span>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Progressive rollout percentages, emergency kill switches, and per-tenant Pennant overrides.
          </p>
        </div>

        <div className="relative">
          <Search className="w-3.5 h-3.5 text-text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search feature flags..."
            className="h-8 pl-8 pr-3 w-56 text-xs bg-surface border border-border rounded-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* Feature Flags Table */}
      <div className="rounded bg-surface border border-border divide-y divide-border/60 text-xs">
        {filteredFlags.map((flag) => {
          return (
            <div key={flag.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="space-y-1 max-w-xl">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-sm text-text-primary">{flag.name}</span>
                  <span className="font-mono text-[10px] text-violet bg-violet-soft px-1.5 py-0.2 rounded font-semibold">
                    {flag.key}
                  </span>
                  {flag.rolloutPercentage === 0 && (
                    <span className="font-mono text-[10px] text-danger bg-danger-soft px-1.5 py-0.2 rounded font-bold uppercase animate-pulse">
                      Disabled (0%)
                    </span>
                  )}
                </div>
                <p className="text-text-muted text-xs">{flag.description}</p>
                <div className="text-[10px] font-mono text-text-muted">
                  Allowed Plans: {flag.planEntitlements.join(', ').toUpperCase()} • Overrides: {Object.keys(flag.tenantOverrides).length} Tenants
                </div>
              </div>

              {/* Controls */}
              <div className="flex items-center gap-4">
                {/* Rollout slider */}
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1.5 font-mono text-xs">
                    <span className="text-text-muted text-[11px]">Rollout:</span>
                    <strong className="text-text-primary">{flag.rolloutPercentage}%</strong>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={flag.rolloutPercentage}
                    onChange={(e) => handleRolloutChange(flag.id, parseInt(e.target.value))}
                    className="w-32 accent-violet cursor-pointer"
                  />
                </div>

                {/* Overrides Drawer Trigger */}
                <button
                  type="button"
                  onClick={() => setSelectedFlagForOverrides(flag)}
                  className="h-8 px-3 rounded border border-border hover:bg-surface-neutral font-medium text-xs cursor-pointer"
                >
                  Manage Overrides ({Object.keys(flag.tenantOverrides).length})
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Tenant Overrides Modal */}
      {selectedFlagForOverrides && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="w-full max-w-lg bg-surface border border-border rounded-lg shadow-xl p-5 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <div>
                <h3 className="text-sm font-bold text-text-primary">Tenant Overrides: {selectedFlagForOverrides.name}</h3>
                <span className="text-[10px] font-mono text-text-muted">{selectedFlagForOverrides.key}</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFlagForOverrides(null)}
                className="text-text-muted hover:text-text-primary text-xs"
              >
                Close
              </button>
            </div>

            <p className="text-xs text-text-muted">
              Select specific tenants to force-enable or force-disable this feature regardless of rollout tier.
            </p>

            <div className="max-h-64 overflow-y-auto divide-y divide-border/60 text-xs">
              {tenants.slice(0, 10).map((t) => {
                const overrideVal = selectedFlagForOverrides.tenantOverrides[t.id];
                const isEnabled = overrideVal !== undefined ? overrideVal : selectedFlagForOverrides.globalDefault;

                return (
                  <div key={t.id} className="py-2 flex items-center justify-between">
                    <div>
                      <div className="font-semibold text-text-primary">{t.name}</div>
                      <div className="text-[10px] font-mono text-text-muted">{t.slug} • {t.subscription.planCode}</div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        toggleFeatureFlagTenantOverride(selectedFlagForOverrides.id, t.id, !isEnabled);
                        toast.success(`Override updated for ${t.name}`);
                      }}
                      className={`h-6 px-2.5 rounded text-[11px] font-medium cursor-pointer transition ${
                        isEnabled ? 'bg-success text-white' : 'bg-surface-neutral text-text-muted'
                      }`}
                    >
                      {isEnabled ? 'ENABLED' : 'DISABLED'}
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="pt-2 border-t border-border flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedFlagForOverrides(null)}
                className="h-8 px-4 rounded bg-violet text-white text-xs font-semibold cursor-pointer shadow-xs"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
