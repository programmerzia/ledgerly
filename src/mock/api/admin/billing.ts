import { simulatedCall } from '../client';
import { useAdminStore } from '@/mock/store/adminStore';
import { StripeInvoiceMirrored, AdminApproval } from '@/types/admin';

export const adminBillingApi = {
  async listInvoices(): Promise<StripeInvoiceMirrored[]> {
    return simulatedCall(() => useAdminStore.getState().invoices);
  },

  async requestRefund(
    invoiceId: string,
    amount: number,
    reason: string
  ): Promise<AdminApproval> {
    return simulatedCall(() => {
      return useAdminStore.getState().requestRefundApproval(invoiceId, amount, reason);
    });
  },

  async exportRevenueScheduleCsv(): Promise<string> {
    return simulatedCall(() => {
      const invoices = useAdminStore.getState().invoices;
      const headers = ['Invoice Number', 'Tenant ID', 'Paid Date', 'Total (Minor)', 'Currency', 'Status', 'Recognized Period'];
      const rows = invoices.map((inv) => [
        inv.number,
        inv.tenantId,
        inv.paidAt || 'N/A',
        inv.total,
        inv.currency,
        inv.status,
        inv.paidAt ? inv.paidAt.slice(0, 7) : 'Unearned',
      ]);
      return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    });
  },
};
