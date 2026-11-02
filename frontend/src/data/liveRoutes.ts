/**
 * Which company screens read real data in live mode (docs/15_Frontend_Integration.md). A screen joins this
 * list in the step that connects it. Anything else shows a notice instead of mock figures, which someone could
 * mistake for their own books. Paths are relative to /:co.
 */
export const LIVE_ROUTES: readonly RegExp[] = [/^accounts$/, /^dimensions$/, /^periods$/, /^fx-rates$/, /^dashboard$/, /^onboarding$/, /^settings\/(security|team)$/, /^journals(\/new|\/[0-9a-f-]{36})?$/, /^approvals$/, /^(accounting\/recurring|recurring-journals)$/];

export function isLiveRoute(pathname: string): boolean {
  const relative = pathname.replace(/^\/[^/]+\/?/, '').replace(/\/$/, '');
  return LIVE_ROUTES.some((route) => route.test(relative));
}
