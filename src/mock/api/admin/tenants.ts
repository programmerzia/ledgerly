import { simulatedCall } from '../client';
import { useAdminStore } from '@/mock/store/adminStore';
import { AdminTenant, PlanCode, ImpersonationSession } from '@/types/admin';

export const adminTenantsApi = {
  async listTenants(): Promise<AdminTenant[]> {
    return simulatedCall(() => useAdminStore.getState().tenants);
  },

  async getTenant(id: string): Promise<AdminTenant | null> {
    return simulatedCall(() => {
      const tenant = useAdminStore.getState().tenants.find((t) => t.id === id);
      return tenant || null;
    });
  },

  async changePlan(
    tenantId: string,
    newPlanCode: PlanCode,
    billingInterval: 'monthly' | 'annual',
    reason: string
  ): Promise<{ prorationCredit: number; newCharge: number; netPayable: number }> {
    return simulatedCall(() => {
      return useAdminStore.getState().changeTenantPlan(tenantId, newPlanCode, billingInterval, reason);
    });
  },

  async extendTrial(tenantId: string, daysToAdd: number, reason: string): Promise<void> {
    return simulatedCall(() => {
      useAdminStore.getState().extendTenantTrial(tenantId, daysToAdd, reason);
    });
  },

  async applyCoupon(tenantId: string, couponCode: string): Promise<void> {
    return simulatedCall(() => {
      useAdminStore.getState().applyCouponToTenant(tenantId, couponCode);
    });
  },

  async suspend(tenantId: string, reason: string): Promise<void> {
    return simulatedCall(() => {
      useAdminStore.getState().suspendTenant(tenantId, reason);
    });
  },

  async reactivate(tenantId: string, reason: string): Promise<void> {
    return simulatedCall(() => {
      useAdminStore.getState().reactivateTenant(tenantId, reason);
    });
  },

  async startImpersonation(
    tenantId: string,
    mode: 'read' | 'write',
    reason: string,
    approvalId?: string
  ): Promise<ImpersonationSession> {
    return simulatedCall(() => {
      return useAdminStore.getState().startImpersonation(tenantId, mode, reason, approvalId);
    });
  },

  async endImpersonation(): Promise<void> {
    return simulatedCall(() => {
      useAdminStore.getState().endImpersonation();
    });
  },
};
