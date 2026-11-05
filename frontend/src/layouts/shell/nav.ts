import type React from 'react';
import { IS_LIVE } from '@/api/config';
import { isLiveRoute } from '@/data/liveRoutes';
import {
  LayoutDashboard, FileSpreadsheet, CreditCard, BookMarked, BarChart3, CheckSquare, Settings,
  Building, ShieldCheck, Package, Layers, Coins, FileText, Calendar, History, RefreshCw, Upload, ClipboardList,
  Repeat,
  Wand2,
  Percent,
  ShoppingCart,
  PackageCheck,
} from 'lucide-react';

export type NavIcon = React.ComponentType<{ className?: string }>;
export interface NavItem { label: string; to: string; icon: NavIcon; badge?: number }
export interface NavSection { id: string; title?: string; defaultCollapsed?: boolean; items: NavItem[] }

const allNavSections = (coSlug: string, pendingApprovalsCount: number): NavSection[] => [
  {
    id: 'main',
    items: [
      { label: 'Dashboard', to: `/${coSlug}/dashboard`, icon: LayoutDashboard },
      { label: 'Approvals', to: `/${coSlug}/approvals`, icon: CheckSquare, badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined },
    ],
  },
  {
    id: 'sales', title: 'Sales',
    items: [
      { label: 'Invoices', to: `/${coSlug}/invoices`, icon: FileSpreadsheet },
      { label: 'Recurring invoices', to: `/${coSlug}/invoices/recurring`, icon: Repeat },
      { label: 'Customers', to: `/${coSlug}/customers`, icon: Building },
      { label: 'Products & services', to: `/${coSlug}/items`, icon: Package },
    ],
  },
  {
    id: 'purchases', title: 'Purchases',
    items: [
      ...(IS_LIVE ? [
        { label: 'Requisitions', to: `/${coSlug}/requisitions`, icon: ClipboardList },
        { label: 'Purchase orders', to: `/${coSlug}/purchase-orders`, icon: ShoppingCart },
        { label: 'Receipts', to: `/${coSlug}/goods-receipts`, icon: PackageCheck },
      ] : []),
      { label: 'Bills', to: `/${coSlug}/bills`, icon: FileText },
      { label: 'Suppliers', to: `/${coSlug}/suppliers`, icon: Building },
      { label: 'Pay bills', to: `/${coSlug}/payment-run`, icon: Coins },
      { label: 'WHT certificates', to: `/${coSlug}/wht-certificates`, icon: ShieldCheck },
      ...(IS_LIVE ? [
        { label: 'Debit notes', to: `/${coSlug}/debit-notes`, icon: FileText },
        { label: 'Recurring bills', to: `/${coSlug}/bills/recurring`, icon: Repeat },
        { label: 'Procurement reports', to: `/${coSlug}/procurement/reports`, icon: BarChart3 },
      ] : []),
    ],
  },
  { id: 'banking', title: 'Banking', items: [
    { label: 'Bank accounts', to: `/${coSlug}/banking`, icon: CreditCard },
    { label: 'Bank rules', to: `/${coSlug}/banking/rules`, icon: Wand2 },
  ] },
  {
    id: 'reports', title: 'Reports',
    items: [
      { label: 'Profit & loss', to: `/${coSlug}/reports/profit-and-loss`, icon: BarChart3 },
      { label: 'Balance sheet', to: `/${coSlug}/reports/balance-sheet`, icon: BarChart3 },
      { label: 'Cash flow', to: `/${coSlug}/reports/cash-flow`, icon: BarChart3 },
      { label: 'Aged receivables & payables', to: `/${coSlug}/reports/aging`, icon: BarChart3 },
      { label: 'Trial balance', to: `/${coSlug}/reports/trial-balance`, icon: BarChart3 },
      ...(IS_LIVE ? [
        { label: 'Customer statement', to: `/${coSlug}/reports/customer-statement`, icon: FileSpreadsheet },
        { label: 'Supplier statement', to: `/${coSlug}/reports/supplier-statement`, icon: FileSpreadsheet },
        { label: 'Journal list', to: `/${coSlug}/reports/journal-list`, icon: BookMarked },
        { label: 'Period close checklist', to: `/${coSlug}/reports/period-close`, icon: Calendar },
      ] : []),
      { label: 'General ledger', to: `/${coSlug}/reports/general-ledger`, icon: BookMarked },
      { label: 'VAT return', to: `/${coSlug}/reports/tax-return`, icon: FileSpreadsheet },
    ],
  },
  {
    id: 'accounting', title: 'Accounting', defaultCollapsed: true,
    items: [
      { label: 'Journals', to: `/${coSlug}/journals`, icon: BookMarked },
      { label: 'Recurring journals', to: `/${coSlug}/accounting/recurring`, icon: RefreshCw },
      { label: 'Chart of accounts', to: `/${coSlug}/accounts`, icon: Layers },
      { label: 'Fixed assets', to: `/${coSlug}/assets`, icon: Package },
      { label: 'Budgets', to: `/${coSlug}/budgets`, icon: BarChart3 },
      { label: 'Exchange rates', to: `/${coSlug}/fx-rates`, icon: Coins },
      { label: 'Periods & close', to: `/${coSlug}/periods`, icon: Calendar },
      ...(IS_LIVE ? [{ label: 'Tax codes', to: `/${coSlug}/tax`, icon: Percent }] : []),
    ],
  },
  {
    id: 'settings', title: 'Settings', defaultCollapsed: true,
    items: [
      { label: IS_LIVE ? 'Settings' : 'Company settings', to: `/${coSlug}/settings`, icon: Settings },
      { label: 'Import data', to: `/${coSlug}/settings/import`, icon: Upload },
      { label: 'Audit log', to: `/${coSlug}/audit-log`, icon: History },
      { label: 'Company setup', to: `/${coSlug}/onboarding`, icon: ClipboardList },
    ],
  },
];

/** In live mode the menu lists only screens connected to real data, so nobody lands on the not-connected notice. */
export const buildNavSections = (coSlug: string, pendingApprovalsCount: number): NavSection[] => {
  const sections = allNavSections(coSlug, pendingApprovalsCount);
  if (!IS_LIVE) return sections;
  return sections
    .map((section) => ({ ...section, items: section.items.filter((item) => isLiveRoute(item.to)) }))
    .filter((section) => section.items.length > 0);
};
