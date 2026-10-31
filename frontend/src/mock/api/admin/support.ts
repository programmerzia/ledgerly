import { simulatedCall } from '../client';
import { useAdminStore } from '@/mock/store/adminStore';
import { Announcement } from '@/types/admin';

export const adminSupportApi = {
  async listAnnouncements(): Promise<Announcement[]> {
    return simulatedCall(() => useAdminStore.getState().announcements);
  },

  async createAnnouncement(data: Omit<Announcement, 'id' | 'createdAt' | 'createdBy'>): Promise<Announcement> {
    return simulatedCall(() => {
      useAdminStore.getState().createAnnouncement(data);
      const items = useAdminStore.getState().announcements;
      return items[items.length - 1];
    });
  },

  async listFailedJobs() {
    return simulatedCall(() => useAdminStore.getState().failedJobs);
  },

  async retryJob(jobId: string): Promise<void> {
    return simulatedCall(() => {
      useAdminStore.getState().retryFailedJob(jobId);
    });
  },
};
