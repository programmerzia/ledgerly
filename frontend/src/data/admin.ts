/**
 * Settings and organisation data (step 3.9, live mode only; the mock keeps its own CompanySettings and AuditLog pages).
 * Keys start with the resource, then the company or organisation id, so a switch drops them. One-time secrets (API tokens,
 * webhook signing secrets) are returned to the caller and never go into the query cache.
 */
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cursorPaging } from '@/api/cursor';
import type { Intent } from '@/api/idempotency';
import { toAuditRow, type AuditRow } from '@/api/adapters/admin';
import * as api from '@/api/live/admin';
import { companiesKey } from './session';
import { useTenantId } from './team';

export const settingsKey = (companyId: string) => ['settings', companyId] as const;
export const workflowsKey = (companyId: string) => ['workflows', companyId] as const;
export const apiClientsKey = (tenantId: string) => ['api-clients', tenantId] as const;
export const webhooksKey = (tenantId: string) => ['webhooks', tenantId] as const;

export function useSettings(companyId: string) {
  return useQuery({ queryKey: settingsKey(companyId), queryFn: () => api.fetchSettings(companyId), retry: false });
}

export function useWorkflows(companyId: string, enabled = true) {
  return useQuery({ queryKey: workflowsKey(companyId), queryFn: () => api.fetchWorkflows(companyId), enabled, retry: false });
}

export function useApiClients() {
  const tenantId = useTenantId();
  return useQuery({ queryKey: apiClientsKey(tenantId), queryFn: api.fetchApiClients, retry: false });
}

export function useWebhooks() {
  const tenantId = useTenantId();
  return useQuery({ queryKey: webhooksKey(tenantId), queryFn: api.fetchWebhooks, retry: false });
}

export function useDeliveries(webhookId: string, status: string) {
  return useInfiniteQuery({
    queryKey: ['webhook-deliveries', webhookId, status],
    queryFn: ({ pageParam }) => api.fetchDeliveries(webhookId, status, pageParam),
    ...cursorPaging,
    retry: false,
  });
}

export function useAuditEvents(companyId: string, filters: api.AuditFilters) {
  const q = useInfiniteQuery({
    queryKey: ['audit-events', companyId, filters],
    queryFn: ({ pageParam }) => api.fetchAuditPage(companyId, filters, pageParam),
    ...cursorPaging,
    retry: false,
  });
  const rows: AuditRow[] = q.data?.pages.flatMap((p) => p.data.map(toAuditRow)) ?? [];
  return { ...q, rows };
}

/** Writes. Each takes the form's own `intent` so a retry after a failure reuses the Idempotency-Key. */
export function useAdminActions(companyId: string) {
  const qc = useQueryClient();
  const tenantId = useTenantId();
  const refreshSettings = async () => {
    await Promise.all([qc.invalidateQueries({ queryKey: settingsKey(companyId) }), qc.invalidateQueries({ queryKey: companiesKey(tenantId) })]);
  };
  return {
    saveSettings: async (patch: api.SettingsPatch, intent?: Intent) => {
      const s = await api.updateSettings(companyId, patch, intent);
      await refreshSettings();
      return s;
    },
    createWorkflow: async (body: api.WorkflowBody, intent?: Intent) => {
      const w = await api.createWorkflow(companyId, body, intent);
      await qc.invalidateQueries({ queryKey: workflowsKey(companyId) });
      return w;
    },
    updateWorkflow: async (id: string, body: api.WorkflowBody, intent?: Intent) => {
      const w = await api.updateWorkflow(companyId, id, body, intent);
      await qc.invalidateQueries({ queryKey: workflowsKey(companyId) });
      return w;
    },
    deactivateWorkflow: async (id: string, version: number, intent?: Intent) => {
      const w = await api.deactivateWorkflow(companyId, id, version, intent);
      await qc.invalidateQueries({ queryKey: workflowsKey(companyId) });
      return w;
    },
    createApiClient: async (body: api.ApiClientBody, intent?: Intent) => {
      const c = await api.createApiClient(body, intent);
      await qc.invalidateQueries({ queryKey: apiClientsKey(tenantId) });
      return c;
    },
    issueApiToken: async (id: string, body: api.TokenBody, intent?: Intent) => {
      const c = await api.issueApiToken(id, body, intent);
      await qc.invalidateQueries({ queryKey: apiClientsKey(tenantId) });
      return c;
    },
    revokeApiClient: async (id: string, intent?: Intent) => {
      const c = await api.revokeApiClient(id, intent);
      await qc.invalidateQueries({ queryKey: apiClientsKey(tenantId) });
      return c;
    },
    createWebhook: async (body: api.WebhookBody, intent?: Intent) => {
      const w = await api.createWebhook(body, intent);
      await qc.invalidateQueries({ queryKey: webhooksKey(tenantId) });
      return w;
    },
    updateWebhook: async (id: string, body: api.WebhookBody, intent?: Intent) => {
      const w = await api.updateWebhook(id, body, intent);
      await qc.invalidateQueries({ queryKey: webhooksKey(tenantId) });
      return w;
    },
    rotateSecret: async (id: string, intent?: Intent) => {
      const w = await api.rotateWebhookSecret(id, intent);
      await qc.invalidateQueries({ queryKey: webhooksKey(tenantId) });
      return w;
    },
    setWebhookEnabled: async (id: string, enabled: boolean, intent?: Intent) => {
      const w = await api.setWebhookEnabled(id, enabled, intent);
      await qc.invalidateQueries({ queryKey: webhooksKey(tenantId) });
      return w;
    },
    redeliver: async (webhookId: string, deliveryId: string, intent?: Intent) => {
      const d = await api.redeliver(webhookId, deliveryId, intent);
      await qc.invalidateQueries({ queryKey: ['webhook-deliveries', webhookId] });
      return d;
    },
  };
}

export function useVerifyAudit(companyId: string) {
  return useMutation({ mutationFn: ({ full, intent }: { full: boolean; intent?: Intent }) => api.verifyAuditChain(companyId, full, intent) });
}
