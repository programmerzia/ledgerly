import { simulatedCall } from '../client';
import { useAdminStore } from '@/mock/store/adminStore';
import { AdminUser } from '@/types/admin';

export const adminSessionApi = {
  async getCurrentAdmin(): Promise<AdminUser> {
    return simulatedCall(() => useAdminStore.getState().currentAdmin);
  },

  async login(email: string, password: string): Promise<{ user: AdminUser; requiresTwoFactor: boolean }> {
    return simulatedCall(() => {
      const staff = useAdminStore.getState().staffUsers.find((u) => u.email.toLowerCase() === email.toLowerCase());
      if (!staff) {
        throw new Error('Invalid staff credentials.');
      }
      return { user: staff, requiresTwoFactor: true };
    });
  },

  async verifyTwoFactor(code: string): Promise<AdminUser> {
    return simulatedCall(() => {
      // accepts standard 6-digit code or "123456" in demo
      if (code.length !== 6) {
        throw new Error('Two-factor authentication code must be 6 digits.');
      }
      return useAdminStore.getState().currentAdmin;
    });
  },

  async switchStaff(staffId: string): Promise<AdminUser> {
    return simulatedCall(() => {
      useAdminStore.getState().switchAdminStaff(staffId);
      return useAdminStore.getState().currentAdmin;
    });
  },
};
