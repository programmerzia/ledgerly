import { simulatedCall } from '../client';
import { useAdminStore } from '@/mock/store/adminStore';

export const adminOpsApi = {
  async getQueueMetrics() {
    return simulatedCall(() => useAdminStore.getState().queueMetrics);
  },

  async getPlatformHealth() {
    return simulatedCall(() => ({
      status: 'normal' as const,
      uptime: 99.98,
      latencyP95: 142,
      errorRate: 0.04,
      databaseSizeBytes: 42.8 * 1024 * 1024 * 1024,
      activeConnections: 68,
    }));
  },
};
