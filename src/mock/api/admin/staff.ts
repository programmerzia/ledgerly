import { simulatedCall } from '../client';
import { useAdminStore } from '@/mock/store/adminStore';
import { AdminUser, AdminApproval, AdminAuditEvent } from '@/types/admin';

export const adminStaffApi = {
  async listStaff(): Promise<AdminUser[]> {
    return simulatedCall(() => useAdminStore.getState().staffUsers);
  },

  async listApprovals(): Promise<AdminApproval[]> {
    return simulatedCall(() => useAdminStore.getState().approvals);
  },

  async decideApproval(
    approvalId: string,
    decision: 'approved' | 'rejected',
    pin: string,
    rejectionReason?: string
  ): Promise<void> {
    return simulatedCall(() => {
      useAdminStore.getState().decideApproval(approvalId, decision, pin, rejectionReason);
    });
  },

  async listAuditEvents(): Promise<AdminAuditEvent[]> {
    return simulatedCall(() => useAdminStore.getState().auditEvents);
  },
};
