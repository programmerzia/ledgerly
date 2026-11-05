/** Live data-import calls (13 §15, plan 2.18). Transport only: adapters shape the results. */
import { http } from '../http';
import type { Intent } from '../idempotency';
import type { CursorPage } from '../cursor';
import type { ApiImport, ApiImportRow } from '../adapters/imports';

const base = (company: string) => `/v1/companies/${company}/imports`;

export interface ApiImportKind {
  kind: string;
  permission: string;
  all_or_nothing: boolean;
  needs_signature: boolean;
  fields: ApiImport['fields'];
}

export const listKinds = async (company: string): Promise<ApiImportKind[]> => (await http.send<{ data: ApiImportKind[] }>('GET', `${base(company)}/kinds`)).data;

export const listImports = async (company: string): Promise<ApiImport[]> => (await http.send<{ data: ApiImport[] }>('GET', `${base(company)}?limit=10`)).data;

export const getImport = async (company: string, id: string): Promise<ApiImport> => (await http.send<{ data: ApiImport }>('GET', `${base(company)}/${id}`)).data;

/** Multipart: `kind`, `file`, and `options[key]` fields. */
export const uploadImport = async (company: string, form: FormData, intent: Intent): Promise<ApiImport> =>
  (await http.send<{ data: ApiImport }>('POST', base(company), form, intent)).data;

export const setMapping = async (company: string, id: string, body: unknown, intent: Intent): Promise<ApiImport> =>
  (await http.send<{ data: ApiImport }>('PUT', `${base(company)}/${id}/mapping`, body, intent)).data;

export const previewImport = async (company: string, id: string, intent: Intent): Promise<ApiImport> =>
  (await http.send<{ data: ApiImport }>('POST', `${base(company)}/${id}/preview`, undefined, intent)).data;

export const applyImport = async (company: string, id: string, intent: Intent): Promise<ApiImport> =>
  (await http.send<{ data: ApiImport }>('POST', `${base(company)}/${id}/apply`, undefined, intent)).data;

export const purgeImport = async (company: string, id: string, intent: Intent): Promise<ApiImport> =>
  (await http.send<{ data: ApiImport }>('POST', `${base(company)}/${id}/purge`, undefined, intent)).data;

export const listRows = async (company: string, id: string, status: string | undefined, cursor: string | undefined, limit = 50): Promise<CursorPage<ApiImportRow>> => {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (status) qs.set('status', status);
  if (cursor) qs.set('cursor', cursor);
  return http.send<CursorPage<ApiImportRow>>('GET', `${base(company)}/${id}/rows?${qs.toString()}`);
};
