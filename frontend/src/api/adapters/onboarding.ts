/**
 * Where the onboarding wizard resumes (02_AppFlow §3). Derived from what the server holds, not from a
 * stored position: company (step 1) exists by definition here, a chart means accounts exist, tax codes
 * means at least one exists, the team step means someone besides the owner is invited or joined.
 * Opening balances (step 3) leave nothing on their own in this version, so it never blocks.
 * The only thing kept in the browser is which optional steps the person chose to skip.
 */
export type StepId = 1 | 2 | 3 | 4 | 5 | 6;

export interface SetupState {
  hasAccounts: boolean;
  taxCodeCount: number;
  /** Members other than the signed-in person plus open invitations; null when the person cannot see them. */
  teammates: number | null;
}

export const STEP_TITLES: Record<StepId, string> = {
  1: 'Your company',
  2: 'Account list',
  3: 'Opening balances',
  4: 'Tax codes',
  5: 'Your team',
  6: 'All set',
};

export function stepDone(step: StepId, s: SetupState, skipped: readonly StepId[]): boolean {
  if (skipped.includes(step)) return true;
  switch (step) {
    case 1:
      return true;
    case 2:
      return s.hasAccounts;
    case 3:
      return s.hasAccounts || skipped.includes(2);
    case 4:
      return s.taxCodeCount > 0;
    case 5:
      return s.teammates === null || s.teammates > 0;
    case 6:
      return false;
  }
}

/** First step that is not done; 6 when everything is. Step 3 is visited right after the chart, so it never counts as the resume point on its own. */
export function resumeStep(s: SetupState, skipped: readonly StepId[]): StepId {
  for (const step of [2, 4, 5] as const) {
    if (!stepDone(step, s, skipped)) return step;
  }
  return 6;
}

export function isSetupComplete(s: SetupState, skipped: readonly StepId[]): boolean {
  return resumeStep(s, skipped) === 6;
}

const key = (companyId: string) => `ledgerly.onboarding.skipped.${companyId}`;

export function loadSkipped(companyId: string, storage: Pick<Storage, 'getItem'> = localStorage): StepId[] {
  try {
    const raw: unknown = JSON.parse(storage.getItem(key(companyId)) ?? '[]');
    return Array.isArray(raw) ? raw.filter((n): n is StepId => n === 2 || n === 4 || n === 5) : [];
  } catch {
    return [];
  }
}

export function saveSkipped(companyId: string, skipped: readonly StepId[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(key(companyId), JSON.stringify([...new Set(skipped)]));
}

/** First day of the fiscal year that contains `today` (YYYY-MM-DD), for a year starting in `startMonth` (1-12). Same rule as the API's company creation. */
export function fiscalYearStart(startMonth: number, today: string): string {
  const [y, m, d] = today.split('-').map(Number);
  void d;
  const year = m >= startMonth ? y : y - 1;
  return `${String(year).padStart(4, '0')}-${String(startMonth).padStart(2, '0')}-01`;
}

/** Local calendar date as YYYY-MM-DD (not UTC, so late evenings do not roll to tomorrow). */
export function localDateISO(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** Charts to offer first: the ones made for the company's country, then the rest in the order given. */
export function orderTemplates<T extends { country: string | null }>(templates: T[], country: string): T[] {
  const mine = templates.filter((t) => t.country?.toUpperCase() === country.toUpperCase());
  return [...mine, ...templates.filter((t) => !mine.includes(t))];
}
