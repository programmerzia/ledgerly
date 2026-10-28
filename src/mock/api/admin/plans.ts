import { simulatedCall } from '../client';
import { useAdminStore } from '@/mock/store/adminStore';
import { Plan } from '@/types/admin';

export const adminPlansApi = {
  async listPlans(): Promise<Plan[]> {
    return simulatedCall(() => useAdminStore.getState().plans);
  },

  async getPlan(id: string): Promise<Plan | null> {
    return simulatedCall(() => {
      const plan = useAdminStore.getState().plans.find((p) => p.id === id);
      return plan || null;
    });
  },
};
