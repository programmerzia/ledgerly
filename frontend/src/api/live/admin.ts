/** Live settings and organisation calls (step 3.9): company settings, approval workflows, API clients, webhooks, audit log. */
import { http } from '../http';
import type { Intent } from '../idempotency';
import type { components } from '../schema';

export type ApiSettings = components['schemas']['CompanySettingsResource'];
export type ApiWorkflow = components['schemas']['ApprovalWorkflowResource'];
export type WorkflowBody = components['schemas']['ApprovalWorkflowRequest'];
export type ApiClient = components['schemas']['ApiClientResource'];
export type ApiClientBody = components['schemas']['ApiClientRequest'];
export type ApiWebhook = components['schemas']['WebhookEndpointResource'];
export type WebhookBody = components['schemas']['WebhookEndpointRequest'];
export type ApiDelivery = components['schemas']['WebhookDeliveryResource'];
export type ApiAuditEvent = components['schemas']['AuditEventResource'];
export type ApiAuditReport = components['schemas']['AuditChainReportResource'];

/** The partial update the server takes (the OpenAPI document has no body for this operation). */
export interface SettingsPatch {
  version?: number;
  journal_threshold?: number | null;
  name?: string;
  legal_name?: string | null;
  tax_id?: string | null;
  timezone?: string;
  locale?: string;
  tax_rounding?: string;
  posting_accounts?: Record<string, string | null>;
}

export async function fetchSettings(companyId: string): Promise<ApiSettings> {
  return (await http.get('/v1/companies/{company}/settings', { path: { company: companyId } })).data;
}

export async function updateSettings(companyId: string, body: SettingsPatch, intent?: Intent): Promise<ApiSettings> {
  return (await http.send<{ data: ApiSettings }>('PUT', `/v1/companies/${encodeURIComponent(companyId)}/settings`, body, intent)).data;
}

/* workflows */

export async function fetchWorkflows(companyId: string): Promise<ApiWorkflow[]> {
  return (await http.get('/v1/companies/{company}/approval-workflows', { path: { company: companyId } })).data;
}

export async function createWorkflow(companyId: string, body: WorkflowBody, intent?: Intent): Promise<ApiWorkflow> {
  return (await http.post('/v1/companies/{company}/approval-workflows', { path: { company: companyId }, body, intent })).data;
}

export async function updateWorkflow(companyId: string, id: string, body: WorkflowBody, intent?: Intent): Promise<ApiWorkflow> {
  return (await http.put('/v1/companies/{company}/approval-workflows/{workflow}', { path: { company: companyId, workflow: id }, body, intent })).data;
}

export async function deactivateWorkflow(companyId: string, id: string, version: number, intent?: Intent): Promise<ApiWorkflow> {
  return (await http.post('/v1/companies/{company}/approval-workflows/{workflow}/deactivate', { path: { company: companyId, workflow: id }, body: { version }, intent })).data;
}

/* API clients */

export async function fetchApiClients(): Promise<ApiClient[]> {
  return (await http.get('/v1/api-clients')).data;
}

/** The answer carries `token` once. Callers show it and drop it; it is never put in a query cache or storage. */
export async function createApiClient(body: ApiClientBody, intent?: Intent): Promise<ApiClient> {
  return (await http.post('/v1/api-clients', { body, intent })).data;
}

/** A further token takes only a name, abilities and expiry (the server refuses `name` and `company_ids` here, though the OpenAPI body lists them). */
export interface TokenBody {
  token_name?: string | null;
  abilities: string[];
  expires_at?: string | null;
}

export async function issueApiToken(id: string, body: TokenBody, intent?: Intent): Promise<ApiClient> {
  return (await http.send<{ data: ApiClient }>('POST', `/v1/api-clients/${encodeURIComponent(id)}/tokens`, body, intent)).data;
}

export async function revokeApiClient(id: string, intent?: Intent): Promise<ApiClient> {
  return (await http.post('/v1/api-clients/{apiClient}/revoke', { path: { apiClient: id }, intent })).data;
}

/* webhooks */

export async function fetchWebhooks(): Promise<ApiWebhook[]> {
  return (await http.get('/v1/webhook-endpoints')).data;
}

export async function createWebhook(body: WebhookBody, intent?: Intent): Promise<ApiWebhook> {
  return (await http.post('/v1/webhook-endpoints', { body, intent })).data;
}

export async function updateWebhook(id: string, body: WebhookBody, intent?: Intent): Promise<ApiWebhook> {
  return (await http.put('/v1/webhook-endpoints/{webhook}', { path: { webhook: id }, body, intent })).data;
}

export async function rotateWebhookSecret(id: string, intent?: Intent): Promise<ApiWebhook> {
  return (await http.post('/v1/webhook-endpoints/{webhook}/rotate-secret', { path: { webhook: id }, intent })).data;
}

export async function setWebhookEnabled(id: string, enabled: boolean, intent?: Intent): Promise<ApiWebhook> {
  const path = enabled ? '/v1/webhook-endpoints/{webhook}/enable' : '/v1/webhook-endpoints/{webhook}/disable';
  return (await http.post(path, { path: { webhook: id }, intent })).data;
}

export async function fetchDeliveries(id: string, status: string | undefined, cursor: string | undefined) {
  return http.get('/v1/webhook-endpoints/{webhook}/deliveries', {
    path: { webhook: id },
    query: { status: (status || undefined) as 'pending' | undefined, cursor, limit: 25 },
  });
}

export async function redeliver(id: string, deliveryId: string, intent?: Intent): Promise<ApiDelivery> {
  return (await http.post('/v1/webhook-endpoints/{webhook}/deliveries/{delivery}/redeliver', { path: { webhook: id, delivery: deliveryId }, intent })).data;
}

/* audit log */

export interface AuditFilters {
  action?: string;
  subject_type?: string;
  subject_id?: string;
  actor_id?: string;
  request_id?: string;
}

export async function fetchAuditPage(companyId: string, filters: AuditFilters, cursor: string | undefined) {
  return http.get('/v1/companies/{company}/audit-events', { path: { company: companyId }, query: { ...filters, cursor, limit: 50 } });
}

/** `full` re-checks from the first event; otherwise from the newest seal that still matches. The report is shown as is. */
export async function verifyAuditChain(companyId: string, full: boolean, intent?: Intent): Promise<ApiAuditReport> {
  return (await http.send<{ data: ApiAuditReport }>('POST', `/v1/companies/${encodeURIComponent(companyId)}/audit-events/verify`, { full }, intent)).data;
}
