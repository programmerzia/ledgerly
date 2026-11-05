/** Live document numbering calls (plan 3c.17). The server decides when a change starts; nothing here computes a number. */
import { http } from '../http';
import type { Intent } from '../idempotency';

export interface NumberingKindRow {
  kind: string;
  label: string;
  default_prefix: string;
  prefix: string;
  padding: number;
  example: string;
  current_year_sequence: { prefix: string; padding: number; issued: number } | null;
  pending: { prefix: string; padding: number; effective_from: string; fiscal_year: string | null; version: number; example: string } | null;
  next_change_from: string;
}
export interface NumberingOverview {
  current_fiscal_year: { id: string; name: string; starts_on: string; ends_on: string } | null;
  kinds: NumberingKindRow[];
}
export interface NumberingChange {
  overview: NumberingOverview;
  meta: { kind: string; effective_from: string; fiscal_year: string | null; unchanged: boolean };
}

export async function fetchNumbering(companyId: string): Promise<NumberingOverview> {
  const res = await http.get('/v1/companies/{company}/numbering', { path: { company: companyId } });
  return res.data as unknown as NumberingOverview;
}

export async function setNumbering(companyId: string, kind: string, body: { prefix: string; padding: number; version?: number | null }, intent?: Intent): Promise<NumberingChange> {
  const res = await http.put('/v1/companies/{company}/numbering/{kind}', { path: { company: companyId, kind }, body, intent });
  const r = res as unknown as { data: NumberingOverview; meta: NumberingChange['meta'] };
  return { overview: r.data, meta: r.meta };
}
