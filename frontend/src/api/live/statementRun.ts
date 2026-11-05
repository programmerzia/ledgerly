/** Live calls for the statement run (3c.7a). */
import type { components } from '../schema';
import { http } from '../http';
import type { Intent } from '../idempotency';

export type RunCustomer = components['schemas']['StatementRunCustomerResource'];
export type RunResult = components['schemas']['StatementRunResultResource'];
export type SendStatus = components['schemas']['SendStatusResource'];
export interface Allowance {
  used: number;
  limit: number;
  remaining: number;
}

const root = (companyId: string) => `/v1/companies/${encodeURIComponent(companyId)}/statement-run`;

export interface RunPeriod {
  basis: 'as_of' | 'period';
  as_of?: string;
  from?: string;
  to?: string;
}

export async function listRunCustomers(companyId: string, p: RunPeriod): Promise<{ rows: RunCustomer[]; from: string; to: string; allowance: Allowance }> {
  const q = new URLSearchParams(Object.entries(p).filter(([, v]) => v) as [string, string][]).toString();
  const res = await http.send<{ data: RunCustomer[]; meta: { from: string; to: string; allowance: Allowance } }>('GET', `${root(companyId)}?${q}`);
  return { rows: res.data, from: res.meta.from, to: res.meta.to, allowance: res.meta.allowance };
}

export async function runStatements(companyId: string, p: RunPeriod, contactIds: string[], intent: Intent): Promise<{ results: RunResult[]; allowance: Allowance }> {
  const res = await http.send<{ data: RunResult[]; meta: { allowance: Allowance } }>('POST', root(companyId), { ...p, contact_ids: contactIds }, intent);
  return { results: res.data, allowance: res.meta.allowance };
}

export async function fetchSendStatuses(companyId: string, ids: string[]): Promise<SendStatus[]> {
  const q = new URLSearchParams(ids.map((id) => ['ids[]', id])).toString();
  return (await http.send<{ data: SendStatus[] }>('GET', `${root(companyId)}/sends?${q}`)).data;
}
