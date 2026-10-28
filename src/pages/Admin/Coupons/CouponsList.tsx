/**
 * Coupons & Discounts Management per docs/10_SaaS_Admin.md §3.4.
 * Mirrors Stripe coupons with duration, partner attribution, redemptions limit,
 * and Create Coupon modal dialog.
 */

import React, { useState } from 'react';
import { useAdminStore } from '@/mock/store/adminStore';
import { Coupon } from '@/types/admin';
import { toast } from 'sonner';
import {
  Ticket,
  Plus,
  Search,
  CheckCircle2,
  Percent,
  Calendar,
  Users,
  Briefcase,
  Copy,
  ExternalLink,
} from 'lucide-react';

export const CouponsList: React.FC = () => {
  const { coupons, createCoupon } = useAdminStore();
  const [searchQuery, setSearchQuery] = useState('');
  const [showCreateModal, setShowCreateModal] = useState(false);

  // New Coupon Form state
  const [code, setCode] = useState('');
  const [discountType, setDiscountType] = useState<'percent' | 'amount'>('percent');
  const [discountValue, setDiscountValue] = useState(20);
  const [duration, setDuration] = useState<'once' | 'repeating' | 'forever'>('repeating');
  const [durationMonths, setDurationMonths] = useState(3);
  const [maxRedemptions, setMaxRedemptions] = useState(100);
  const [partnerAttribution, setPartnerAttribution] = useState('');

  const filteredCoupons = coupons.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.code.toLowerCase().includes(q) ||
      (c.partnerName && c.partnerName.toLowerCase().includes(q)) ||
      c.stripeCouponId.toLowerCase().includes(q)
    );
  });

  const handleCreateCoupon = (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      toast.error('Please enter a coupon code');
      return;
    }

    try {
      createCoupon({
        code: code.trim().toUpperCase(),
        stripeCouponId: `cou_${code.trim().toLowerCase()}_${Date.now().toString().slice(-4)}`,
        percentOff: discountType === 'percent' ? discountValue : undefined,
        amountOff: discountType === 'amount' ? discountValue * 100 : undefined,
        currency: 'USD',
        duration,
        durationMonths: duration === 'repeating' ? durationMonths : undefined,
        maxRedemptions,
        expiresAt: '2027-12-31T23:59:59Z',
        partnerName: partnerAttribution.trim() || undefined,
        isActive: true,
        newCustomersOnly: false,
      });

      toast.success(`Coupon ${code.toUpperCase()} created and synced with Stripe Billing.`);
      setShowCreateModal(false);
      setCode('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create coupon');
    }
  };

  const handleCopyCode = (couponCode: string) => {
    navigator.clipboard.writeText(couponCode);
    toast.success(`Coupon code ${couponCode} copied to clipboard!`);
  };

  return (
    <div className="flex-1 flex flex-col p-4 space-y-3 max-w-7xl mx-auto w-full select-none text-text-primary">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold tracking-tight">Coupons & Commercial Discounts</h1>
            <span className="px-2 py-0.5 rounded-full bg-violet-soft text-violet text-[10px] font-mono font-semibold">
              {coupons.length} Active Codes
            </span>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            Partner incentives, acquisition promo codes, and retention credits mirrored to Stripe.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search coupons..."
              className="h-8 pl-8 pr-3 w-52 text-xs bg-surface border border-border rounded-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <button
            type="button"
            onClick={() => setShowCreateModal(true)}
            className="h-8 px-3 rounded-sm bg-violet text-white hover:opacity-90 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer shadow-xs"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Create Coupon</span>
          </button>
        </div>
      </div>

      {/* 36px Dense Controls Table */}
      <div className="rounded bg-surface border border-border overflow-hidden">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="h-8 bg-surface-neutral/60 border-b border-border text-text-muted text-[11px] uppercase font-semibold">
              <th className="px-3">Coupon Code</th>
              <th className="px-3">Discount</th>
              <th className="px-3">Duration</th>
              <th className="px-3">Redemptions</th>
              <th className="px-3">Attribution / Partner</th>
              <th className="px-3">Stripe ID</th>
              <th className="px-3">Expires</th>
              <th className="px-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {filteredCoupons.map((c: Coupon) => {
              const discountText = c.percentOff ? `${c.percentOff}% OFF` : `$${((c.amountOff || 0) / 100).toFixed(0)} OFF`;
              const durationText = c.duration === 'once' ? 'Single Use' : c.duration === 'forever' ? 'Forever' : `${c.durationMonths} Months`;
              const isExhausted = c.maxRedemptions ? c.timesRedeemed >= c.maxRedemptions : false;

              return (
                <tr key={c.id} className="h-9 hover:bg-surface-neutral/50 transition-colors">
                  {/* Code */}
                  <td className="px-3 font-mono font-bold text-violet flex items-center gap-1.5">
                    <Ticket className="w-3.5 h-3.5 text-text-muted" />
                    <span>{c.code}</span>
                  </td>

                  {/* Discount */}
                  <td className="px-3 font-mono font-semibold text-text-primary">
                    <span className="px-1.5 py-0.2 rounded bg-success-soft text-success text-[11px]">
                      {discountText}
                    </span>
                  </td>

                  {/* Duration */}
                  <td className="px-3 text-text-secondary capitalize">{durationText}</td>

                  {/* Redemptions */}
                  <td className="px-3 font-mono text-text-secondary">
                    <span className={isExhausted ? 'text-danger font-bold' : ''}>
                      {c.timesRedeemed} / {c.maxRedemptions || '∞'}
                    </span>
                  </td>

                  {/* Partner Attribution */}
                  <td className="px-3 text-text-secondary">
                    {c.partnerName ? (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-text-primary">
                        <Briefcase className="w-3 h-3 text-text-muted" />
                        {c.partnerName}
                      </span>
                    ) : (
                      <span className="text-text-muted text-[11px]">— Direct</span>
                    )}
                  </td>

                  {/* Stripe ID */}
                  <td className="px-3 font-mono text-[10px] text-text-muted truncate max-w-[120px]">
                    {c.stripeCouponId}
                  </td>

                  {/* Expires */}
                  <td className="px-3 font-mono text-[11px] text-text-muted">
                    {c.expiresAt ? new Date(c.expiresAt).toLocaleDateString() : 'Never'}
                  </td>

                  {/* Copy */}
                  <td className="px-3 text-right">
                    <button
                      type="button"
                      onClick={() => handleCopyCode(c.code)}
                      className="p-1 rounded hover:bg-surface-neutral text-text-muted hover:text-text-primary transition"
                      title="Copy Coupon Code"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Create Coupon Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <form
            onSubmit={handleCreateCoupon}
            className="w-full max-w-md bg-surface border border-border rounded-lg shadow-xl p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3 className="text-sm font-bold text-text-primary">Create Promotional Coupon</h3>
              <span className="text-[10px] font-mono text-violet">Stripe Sync</span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <label className="font-semibold text-text-secondary block mb-1">Coupon Code (Uppercase)</label>
                <input
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. Q4GROWTH30"
                  className="w-full h-8 px-2.5 font-mono uppercase bg-surface border border-border rounded text-xs"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-text-secondary block mb-1">Discount Type</label>
                  <select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as any)}
                    className="w-full h-8 px-2 bg-surface border border-border rounded text-xs"
                  >
                    <option value="percent">Percent Off (%)</option>
                    <option value="amount">Fixed Amount ($)</option>
                  </select>
                </div>
                <div>
                  <label className="font-semibold text-text-secondary block mb-1">Value ({discountType === 'percent' ? '%' : '$'})</label>
                  <input
                    type="number"
                    min="1"
                    max={discountType === 'percent' ? 100 : 1000}
                    value={discountValue}
                    onChange={(e) => setDiscountValue(parseInt(e.target.value) || 0)}
                    className="w-full h-8 px-2.5 font-mono bg-surface border border-border rounded text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="font-semibold text-text-secondary block mb-1">Duration</label>
                  <select
                    value={duration}
                    onChange={(e) => setDuration(e.target.value as any)}
                    className="w-full h-8 px-2 bg-surface border border-border rounded text-xs"
                  >
                    <option value="once">Once</option>
                    <option value="repeating">Repeating (Months)</option>
                    <option value="forever">Forever</option>
                  </select>
                </div>
                {duration === 'repeating' && (
                  <div>
                    <label className="font-semibold text-text-secondary block mb-1">Months</label>
                    <input
                      type="number"
                      min="1"
                      max="24"
                      value={durationMonths}
                      onChange={(e) => setDurationMonths(parseInt(e.target.value) || 1)}
                      className="w-full h-8 px-2.5 font-mono bg-surface border border-border rounded text-xs"
                    />
                  </div>
                )}
              </div>

              <div>
                <label className="font-semibold text-text-secondary block mb-1">Max Redemptions Limit</label>
                <input
                  type="number"
                  min="1"
                  value={maxRedemptions}
                  onChange={(e) => setMaxRedemptions(parseInt(e.target.value) || 1)}
                  className="w-full h-8 px-2.5 font-mono bg-surface border border-border rounded text-xs"
                />
              </div>

              <div>
                <label className="font-semibold text-text-secondary block mb-1">Partner Attribution (Optional)</label>
                <input
                  type="text"
                  value={partnerAttribution}
                  onChange={(e) => setPartnerAttribution(e.target.value)}
                  placeholder="e.g. BDO Somalia or PwC East Africa"
                  className="w-full h-8 px-2.5 bg-surface border border-border rounded text-xs"
                />
              </div>
            </div>

            <div className="pt-2 border-t border-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="h-8 px-3 rounded border border-border hover:bg-surface-neutral text-xs cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-8 px-4 rounded bg-violet text-white hover:opacity-90 text-xs font-semibold cursor-pointer shadow-xs"
              >
                Create & Mirror to Stripe
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
