import { simulatedCall } from '../client';
import { useAdminStore } from '@/mock/store/adminStore';
import { AdminTenant } from '@/types/admin';

export const adminGrowthApi = {
  async getTrials(): Promise<AdminTenant[]> {
    return simulatedCall(() => {
      return useAdminStore.getState().tenants.filter((t) => t.status === 'trialing');
    });
  },

  async getExpiringTrials(daysThreshold = 3): Promise<AdminTenant[]> {
    return simulatedCall(() => {
      const now = new Date('2026-10-28T00:00:00Z').getTime();
      return useAdminStore.getState().tenants.filter((t) => {
        if (t.status !== 'trialing' || !t.subscription.trialEndsAt) return false;
        const diffDays = (new Date(t.subscription.trialEndsAt).getTime() - now) / (1000 * 60 * 60 * 24);
        return diffDays >= 0 && diffDays <= daysThreshold;
      });
    });
  },
};
