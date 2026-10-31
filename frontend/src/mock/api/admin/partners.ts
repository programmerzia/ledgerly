import { simulatedCall } from '../client';
import { useAdminStore } from '@/mock/store/adminStore';
import { Partner } from '@/types/admin';

export const adminPartnersApi = {
  async listPartners(): Promise<Partner[]> {
    return simulatedCall(() => useAdminStore.getState().partners);
  },
};
