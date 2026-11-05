/** Live calls for overdue-invoice reminders (3c.7). */
import type { components } from '../schema';
import { http } from '../http';
import type { Intent } from '../idempotency';

export type DunningSettings = components['schemas']['DunningSettingsResource'];
export type DunningPreviewRow = components['schemas']['DunningPreviewResource'];
export type DunningBody = components['schemas']['DunningRequest'];

const root = (companyId: string) => `/v1/companies/${encodeURIComponent(companyId)}/dunning`;

export const fetchDunning = async (companyId: string): Promise<DunningSettings> => (await http.send<{ data: DunningSettings }>('GET', root(companyId))).data;

export const saveDunning = async (companyId: string, body: DunningBody, intent: Intent): Promise<DunningSettings> =>
  (await http.send<{ data: DunningSettings }>('PUT', root(companyId), body, intent)).data;

export async function fetchDunningPreview(companyId: string): Promise<{ rows: DunningPreviewRow[]; date: string; enabled: boolean }> {
  const res = await http.send<{ data: DunningPreviewRow[]; meta: { date: string; enabled: boolean } }>('GET', `${root(companyId)}/preview`);
  return { rows: res.data, date: res.meta.date, enabled: res.meta.enabled };
}
