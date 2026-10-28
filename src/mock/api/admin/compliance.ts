import { simulatedCall } from '../client';
import { useAdminStore } from '@/mock/store/adminStore';
import { GdprRequest } from '@/types/admin';

export const adminComplianceApi = {
  async listGdprRequests(): Promise<GdprRequest[]> {
    return simulatedCall(() => useAdminStore.getState().gdprRequests);
  },

  async createGdprRequest(tenantId: string, kind: 'export' | 'delete', requestedBy: string, email: string): Promise<void> {
    return simulatedCall(() => {
      useAdminStore.getState().createGdprRequest(tenantId, kind, requestedBy, email);
    });
  },

  async completeGdprRequest(requestId: string, exportPath: string): Promise<void> {
    return simulatedCall(() => {
      useAdminStore.getState().completeGdprRequest(requestId, exportPath);
    });
  },
};
