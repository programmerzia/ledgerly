import { simulatedCall } from '../client';
import { useAdminStore } from '@/mock/store/adminStore';
import { Coupon } from '@/types/admin';

export const adminCouponsApi = {
  async listCoupons(): Promise<Coupon[]> {
    return simulatedCall(() => useAdminStore.getState().coupons);
  },

  async createCoupon(data: Omit<Coupon, 'id' | 'timesRedeemed' | 'createdAt'>): Promise<Coupon> {
    return simulatedCall(() => {
      useAdminStore.getState().createCoupon(data);
      const created = useAdminStore.getState().coupons.find((c) => c.code === data.code);
      if (!created) throw new Error('Failed to create coupon');
      return created;
    });
  },
};
