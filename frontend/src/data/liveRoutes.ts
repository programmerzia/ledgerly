/**
 * Which company screens read real data in live mode (docs/15_Frontend_Integration.md). A screen joins this
 * list in the step that connects it. Anything else shows a notice instead of mock figures, which someone could
 * mistake for their own books. Paths are relative to /:co.
 */
export const LIVE_ROUTES: readonly RegExp[] = [/^accounts$/, /^dimensions$/, /^periods$/, /^fx-rates$/, /^dashboard$/, /^onboarding$/, /^settings$/, /^settings\/(general|posting|workflows|security|team|api-clients|webhooks)$/, /^audit-log$/, /^journals(\/new|\/[0-9a-f-]{36})?$/, /^approvals$/, /^(accounting\/recurring|recurring-journals)$/, /^(customers|invoices|credit-notes)$/, /^customers\/[0-9a-f-]{36}$/, /^invoices\/(new|[0-9a-f-]{36})$/, /^receipts\/(new|[0-9a-f-]{36})$/, /^credit-notes\/new$/, /^banking(\/rules|\/import|\/[0-9a-f-]{36}\/reconcile)?$/, /^(suppliers|bills|debit-notes|payment-run|wht-certificates|items|sales\/items|invoices\/recurring|bills\/recurring|tax)$/, /^(suppliers|bills|payments|payment-run)\/[0-9a-f-]{36}$/, /^(bills|payments|payment-run)\/new$/, /^debit-notes\/new$/, /^reports\/(trial-balance|profit-and-loss|balance-sheet|cash-flow|aging|general-ledger|tax-return|customer-statement|supplier-statement)$/];

export function isLiveRoute(pathname: string): boolean {
  const relative = pathname.replace(/^\/[^/]+\/?/, '').replace(/\/$/, '');
  return LIVE_ROUTES.some((route) => route.test(relative));
}
