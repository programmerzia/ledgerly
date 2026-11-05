import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ApiMenuSection } from '../src/api/live/menu';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const menu: ApiMenuSection[] = [
  { key: 'main', title: null, collapsed: false, items: [
    { key: 'dashboard', label: 'Dashboard', icon: 'layout-dashboard', route: 'dashboard', module: null },
    { key: 'approvals', label: 'Approvals', icon: 'check-square', route: 'approvals', module: null },
  ] },
  { key: 'accounting', title: 'Accounting', collapsed: true, items: [
    { key: 'fixed_assets', label: 'Fixed assets', icon: 'package', route: 'assets', module: 'fixed_assets' },
    { key: 'budgets', label: 'Budgets', icon: 'brand-new-icon', route: 'budgets', module: null },
  ] },
  { key: 'later', title: 'Later', collapsed: false, items: [{ key: 'x', label: 'Not connected', icon: 'package', route: 'not-a-screen', module: null }] },
];

async function load() {
  vi.stubEnv('VITE_API_MODE', 'live');
  vi.resetModules();
  return import('../src/layouts/shell/nav');
}

describe('menu from the server (plan 3c.24)', () => {
  it('renders the sections in the order sent, under the company path', async () => {
    const { navSectionsFromMenu } = await load();
    const out = navSectionsFromMenu('acme', menu);
    expect(out[0]).toMatchObject({ id: 'main', title: undefined });
    expect(out[0].items.map((i) => i.to)).toEqual(['/acme/dashboard', '/acme/approvals']);
    expect(out[1]).toMatchObject({ id: 'accounting', title: 'Accounting', defaultCollapsed: true });
  });

  it('keeps isLiveRoute as the guard: unconnected screens and empty sections drop out', async () => {
    const { navSectionsFromMenu } = await load();
    const out = navSectionsFromMenu('acme', menu);
    expect(out.flatMap((s) => s.items.map((i) => i.label))).toEqual(['Dashboard', 'Approvals', 'Fixed assets', 'Budgets']);
    expect(out.map((s) => s.id)).not.toContain('later');
  });

  it('draws a fallback icon for a key the SPA does not know yet', async () => {
    const { navSectionsFromMenu } = await load();
    const budgets = navSectionsFromMenu('acme', menu)[1].items[1];
    const { navIcon } = await import('../src/layouts/shell/navIcons');
    expect(budgets.icon).toBe(navIcon('brand-new-icon'));
    expect(navIcon('brand-new-icon')).not.toBe(navIcon('package'));
    expect(navIcon('package')).toBeDefined();
  });
});
