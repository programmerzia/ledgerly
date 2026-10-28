import { simulatedCall } from '../client';
import { useAdminStore } from '@/mock/store/adminStore';
import { PennantFeatureFlag } from '@/types/admin';

export const adminFlagsApi = {
  async listFlags(): Promise<PennantFeatureFlag[]> {
    return simulatedCall(() => useAdminStore.getState().featureFlags);
  },

  async toggleTenantOverride(flagId: string, tenantId: string, value: boolean): Promise<void> {
    return simulatedCall(() => {
      useAdminStore.getState().toggleFeatureFlagTenantOverride(flagId, tenantId, value);
    });
  },

  async updateRollout(flagId: string, percentage: number): Promise<void> {
    return simulatedCall(() => {
      useAdminStore.getState().updateFeatureFlagRollout(flagId, percentage);
    });
  },
};
