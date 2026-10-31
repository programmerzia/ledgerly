/**
 * Plans & Pricing Matrix per docs/10_SaaS_Admin.md §3.3.
 * Multi-currency switchers (USD, KES, EUR), limits & quotas, feature entitlements,
 * and Stripe product synchronization status.
 */

import React, { useState } from 'react';
import { useAdminStore } from '@/mock/store/adminStore';
import { Plan, SupportedCurrency } from '@/types/admin';
import { toast } from 'sonner';
import {
  Package,
  Check,
  X,
  CreditCard,
  Plus,
  RefreshCw,
  Layers,
  Users,
  ShieldCheck,
  Zap,
  Lock,
} from 'lucide-react';

export const PlansList: React.FC = () => {
  const { plans, mockPlanAddons } = useAdminStore() as any;
  const [currency, setCurrency] = useState<SupportedCurrency>('USD');
  const [interval, setInterval] = useState<'monthly' | 'annual'>('monthly');

  const currencySymbols: Record<SupportedCurrency, string> = {
    USD: '$',
    KES: 'KSh ',
    EUR: '€',
  };

  const allAddons = [
    { code: 'addon-co', name: 'Additional Operating Company', price: '$20 / mo', desc: 'Allows extra legal entity with independent ledger' },
    { code: 'addon-users', name: '5-Seat User Pack', price: '$35 / mo', desc: 'Extra makers and approvers with 2FA licenses' },
    { code: 'addon-storage', name: '100 GB Encrypted Storage', price: '$15 / mo', desc: 'Extended audit evidence & PDF invoice archive' },
    { code: 'addon-api', name: '10,000 Extra API Calls', price: '$25 / mo', desc: 'High-frequency ERP webhook synchronization' },
  ];

  return (
    <div className="flex-1 flex flex-col p-4 space-y-4 max-w-7xl mx-auto w-full select-none text-text-primary">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight">Plans & Entitlements Matrix</h1>
            <span className="px-2 py-0.5 rounded-full bg-violet-soft text-violet text-[10px] font-mono font-semibold">
              Stripe Products Synced
            </span>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Subscription tiers, multi-currency rates, hard entitlement gates, and grandfathering versions.
          </p>
        </div>

        {/* Currency & Interval Switchers */}
        <div className="flex items-center gap-2 text-xs">
          {/* Currency Toggle */}
          <div className="flex rounded border border-border overflow-hidden bg-surface">
            {(['USD', 'KES', 'EUR'] as SupportedCurrency[]).map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCurrency(c)}
                className={`px-2.5 py-1 font-mono font-medium cursor-pointer transition ${
                  currency === c ? 'bg-violet text-white' : 'text-text-muted hover:text-text-primary'
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* Interval Toggle */}
          <div className="flex rounded border border-border overflow-hidden bg-surface">
            <button
              type="button"
              onClick={() => setInterval('monthly')}
              className={`px-2.5 py-1 font-medium cursor-pointer transition ${
                interval === 'monthly' ? 'bg-violet text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Monthly
            </button>
            <button
              type="button"
              onClick={() => setInterval('annual')}
              className={`px-2.5 py-1 font-medium cursor-pointer transition ${
                interval === 'annual' ? 'bg-violet text-white' : 'text-text-muted hover:text-text-primary'
              }`}
            >
              Annual (-15%)
            </button>
          </div>
        </div>
      </div>

      {/* 4 Plans Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
        {plans.map((p: Plan) => {
          const version = p.currentVersion;
          const priceObj = version.prices[currency] || { monthly: 4900, annual: 49000 };
          const rawPrice = interval === 'annual' ? priceObj.annual : priceObj.monthly;
          const displayPrice = (rawPrice / 100).toLocaleString('en-US', { minimumFractionDigits: 0 });

          return (
            <div
              key={p.id}
              className={`p-4 rounded-lg bg-surface border flex flex-col justify-between transition-all ${
                p.code === 'business' ? 'border-violet shadow-sm ring-1 ring-violet/20' : 'border-border'
              }`}
            >
              <div>
                <div className="flex items-center justify-between">
                  <h3 className="font-bold text-sm text-text-primary">{p.name}</h3>
                  {p.code === 'business' && (
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-violet text-white font-semibold">
                      Popular
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-text-muted mt-0.5">v{version.version} • {version.trialDays}d Trial</div>

                {/* Price Display */}
                <div className="mt-3 pb-3 border-b border-border/60">
                  <div className="flex items-baseline gap-1">
                    <span className="text-2xl font-bold font-mono text-text-primary">
                      {currencySymbols[currency]}{displayPrice}
                    </span>
                    <span className="text-[11px] text-text-muted font-mono">
                      /{interval === 'annual' ? 'yr' : 'mo'}
                    </span>
                  </div>
                  <div className="text-[10px] text-text-muted font-mono mt-0.5">
                    Stripe Product: {version.stripeProductId}
                  </div>
                </div>

                {/* Quotas & Limits */}
                <div className="mt-3 space-y-2 text-xs">
                  <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">
                    Included Limits
                  </span>
                  <div className="flex justify-between py-0.5">
                    <span className="text-text-muted">Companies</span>
                    <span className="font-mono font-semibold">{version.limits.companies}</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-text-muted">Users</span>
                    <span className="font-mono font-semibold">{version.limits.users} seats</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-text-muted">Journal Lines</span>
                    <span className="font-mono font-semibold">{version.limits.journalLinesPerMonth.toLocaleString()} / mo</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-text-muted">Storage</span>
                    <span className="font-mono font-semibold">{(version.limits.storageMb / 1024).toFixed(0)} GB</span>
                  </div>
                  <div className="flex justify-between py-0.5">
                    <span className="text-text-muted">API Throughput</span>
                    <span className="font-mono font-semibold">{version.limits.apiCallsPerDay.toLocaleString()} / day</span>
                  </div>
                </div>

                {/* Entitlements Checklist */}
                <div className="mt-4 pt-3 border-t border-border/60 space-y-1.5 text-xs">
                  <span className="text-[10px] font-bold text-text-muted uppercase tracking-wider block">
                    Feature Entitlements
                  </span>
                  <div className="flex items-center gap-2 text-text-secondary">
                    {version.entitlements.multiCurrency ? <Check className="w-3.5 h-3.5 text-success" /> : <X className="w-3.5 h-3.5 text-text-muted opacity-40" />}
                    <span>Multi-Currency Ledgers</span>
                  </div>
                  <div className="flex items-center gap-2 text-text-secondary">
                    {version.entitlements.independentApprovals ? <Check className="w-3.5 h-3.5 text-success" /> : <X className="w-3.5 h-3.5 text-text-muted opacity-40" />}
                    <span>Maker-Checker Approval Workflows</span>
                  </div>
                  <div className="flex items-center gap-2 text-text-secondary">
                    {version.entitlements.fixedAssets ? <Check className="w-3.5 h-3.5 text-success" /> : <X className="w-3.5 h-3.5 text-text-muted opacity-40" />}
                    <span>Fixed Assets Register & Depreciation</span>
                  </div>
                  <div className="flex items-center gap-2 text-text-secondary">
                    {version.entitlements.budgets ? <Check className="w-3.5 h-3.5 text-success" /> : <X className="w-3.5 h-3.5 text-text-muted opacity-40" />}
                    <span>Budgets & Variance Reporting</span>
                  </div>
                  <div className="flex items-center gap-2 text-text-secondary">
                    {version.entitlements.apiAccess ? <Check className="w-3.5 h-3.5 text-success" /> : <X className="w-3.5 h-3.5 text-text-muted opacity-40" />}
                    <span>Developer REST API & Webhooks</span>
                  </div>
                  <div className="flex items-center gap-2 text-text-secondary">
                    {version.entitlements.ssoSaml ? <Check className="w-3.5 h-3.5 text-success" /> : <X className="w-3.5 h-3.5 text-text-muted opacity-40" />}
                    <span>Enterprise SAML SSO</span>
                  </div>
                </div>
              </div>

              {/* Card Footer Button */}
              <div className="mt-4 pt-3 border-t border-border">
                <button
                  type="button"
                  onClick={() => toast.info(`Plan versioning is managed via Stripe Product sync. Current version: v${version.version}`)}
                  className="w-full h-8 rounded border border-border hover:bg-surface-neutral text-text-primary text-xs font-medium cursor-pointer transition"
                >
                  Configure Plan v{version.version}
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Add-Ons Catalog */}
      <div className="rounded bg-surface border border-border p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-text-primary">
              Available Add-On Packages & Metered Overage
            </h3>
            <p className="text-[11px] text-text-muted">Modular add-ons attachable to any active tenant subscription</p>
          </div>
          <button
            type="button"
            onClick={() => toast.success('Stripe Add-On catalog refreshed')}
            className="h-7 px-2.5 rounded border border-border text-xs flex items-center gap-1.5 hover:bg-surface-neutral cursor-pointer"
          >
            <RefreshCw className="w-3 h-3 text-text-muted" />
            <span>Sync Add-Ons</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {allAddons.map((addon) => (
            <div key={addon.code} className="p-3 rounded bg-surface-neutral/40 border border-border/80 space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-semibold text-text-primary">{addon.name}</span>
                <span className="font-mono text-violet font-bold">{addon.price}</span>
              </div>
              <p className="text-[11px] text-text-muted">{addon.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
