/** Reference lists the document forms need: items, tax codes, bank accounts. All from the server, read only. */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchAllPages } from '@/api/cursor';
import * as live from '@/api/live/trade';
import { fromApiMoney } from '@/api/adapters/money';
import { useRouteCompany } from './session';

export interface RefItem {
  id: string;
  code: string;
  name: string;
  description: string;
  currency: string;
  sales_account_id: string | null;
  sales_price: number;
  tax_code_id: string | null;
}
export interface RefTaxCode {
  id: string;
  code: string;
  name: string;
  /** The rate in force today, as the server's decimal string (for display only). */
  rate: string | null;
}
export interface RefBankAccount {
  id: string;
  account_id: string;
  name: string;
  currency: string;
  kind: string;
  is_active: boolean;
}

export function useTradeRefs() {
  const company = useRouteCompany();
  const items = useQuery({
    queryKey: ['trade-refs', company.id, 'items'],
    queryFn: () => fetchAllPages((c) => live.listItems(company.id, c)),
  });
  const taxCodes = useQuery({
    queryKey: ['trade-refs', company.id, 'tax-codes'],
    queryFn: () => fetchAllPages((c) => live.listTaxCodes(company.id, c)),
  });
  const banks = useQuery({ queryKey: ['trade-refs', company.id, 'bank-accounts'], queryFn: () => live.listBankAccounts(company.id) });
  const itemList: RefItem[] = useMemo(
    () =>
      (items.data ?? []).map((i) => ({
        id: i.id,
        code: i.code,
        name: i.name,
        description: i.description ?? '',
        currency: i.currency,
        sales_account_id: i.sales_account_id,
        sales_price: fromApiMoney(i.sales_price),
        tax_code_id: i.tax_code_id,
      })),
    [items.data],
  );
  const taxList: RefTaxCode[] = useMemo(() => (taxCodes.data ?? []).map((t) => ({ id: t.id, code: t.code, name: t.name, rate: t.rate ?? null })), [taxCodes.data]);
  const bankList: RefBankAccount[] = useMemo(
    () => (banks.data ?? []).filter((b) => b.is_active).map((b) => ({ id: b.id, account_id: b.account_id, name: b.name, currency: b.currency, kind: b.kind, is_active: b.is_active })),
    [banks.data],
  );
  return {
    items: itemList,
    taxCodes: taxList,
    bankAccounts: bankList,
    isLoading: items.isLoading || taxCodes.isLoading || banks.isLoading,
    error: items.error ?? taxCodes.error ?? banks.error,
    refetch: () => {
      void items.refetch();
      void taxCodes.refetch();
      void banks.refetch();
    },
  };
}
