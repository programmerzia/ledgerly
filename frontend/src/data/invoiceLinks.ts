/** The issuer's online-link panel, live side (3c.7b). Query key: ['invoice-links', companyId, invoiceId]. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as live from '@/api/live/invoiceLinks';
import type { Intent } from '@/api/idempotency';
import { useRouteCompany } from './session';

export const linksKey = (companyId: string, invoiceId: string) => ['invoice-links', companyId, invoiceId] as const;

export function useInvoiceLinks(invoiceId: string, enabled = true) {
  const { id: companyId } = useRouteCompany();
  return useQuery({ queryKey: linksKey(companyId, invoiceId), queryFn: () => live.listLinks(companyId, invoiceId), enabled, retry: false });
}

export function useLinkActions(invoiceId: string) {
  const { id: companyId } = useRouteCompany();
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: linksKey(companyId, invoiceId) });
  const create = useMutation({
    mutationFn: ({ days, intent }: { days: number | null; intent: Intent }) => live.createLink(companyId, invoiceId, days, intent),
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: ({ linkId, intent }: { linkId: string; intent: Intent }) => live.revokeLink(companyId, invoiceId, linkId, intent),
    onSuccess: refresh,
  });
  return { create, revoke };
}
