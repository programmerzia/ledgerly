/** Live calls for the bell (3c.6). */
import { http } from '../http';
import type { Intent } from '../idempotency';
import type { ApiNotification } from '../adapters/notifications';

export interface NotificationPage {
  items: ApiNotification[];
  unreadCount: number;
}

export async function listNotifications(companyId: string): Promise<NotificationPage> {
  const res = await http.send<{ data: ApiNotification[]; meta: { unread_count: number } }>('GET', `/v1/companies/${companyId}/notifications?limit=30`);
  return { items: res.data, unreadCount: res.meta.unread_count };
}

export const markNotificationRead = async (companyId: string, id: string, intent: Intent): Promise<void> => {
  await http.send('POST', `/v1/companies/${companyId}/notifications/${id}/read`, {}, intent);
};

export const markAllNotificationsRead = async (companyId: string, intent: Intent): Promise<void> => {
  await http.send('POST', `/v1/companies/${companyId}/notifications/read-all`, {}, intent);
};
