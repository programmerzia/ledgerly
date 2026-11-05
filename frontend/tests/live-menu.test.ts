import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const HIDDEN: string[] = [];
const labels = (sections: { items: { label: string }[] }[]) => sections.flatMap((s) => s.items.map((i) => i.label));

async function menus(mode: 'live' | 'mock') {
  vi.stubEnv('VITE_API_MODE', mode);
  vi.resetModules();
  const { buildNavSections } = await import('../src/layouts/shell/nav');
  return buildNavSections('acme', 0);
}

describe('menu in live mode', () => {
  it('lists procurement and leaves out screens that are not connected', async () => {
    const live = labels(await menus('live'));
    for (const l of ['Requisitions', 'Purchase orders', 'Receipts', 'Procurement reports', 'Bills', 'Import data', 'Fixed assets', 'Budgets']) expect(live).toContain(l);
  });

  it('hides exactly the unconnected items', async () => {
    // Compare by route: the settings item is only renamed in live mode, not hidden.
    const flat = (sections: { items: { label: string; to: string }[] }[]) => sections.flatMap((s) => s.items);
    const mock = flat(await menus('mock'));
    const live = new Set(flat(await menus('live')).map((i) => i.to));
    const hidden = mock.filter((i) => !live.has(i.to)).map((i) => i.label);
    expect(hidden).toEqual(HIDDEN);
  });

  it('keeps the whole menu in mock mode', async () => {
    const mock = labels(await menus('mock'));
    for (const l of ['Fixed assets', 'Budgets', 'Import data']) expect(mock).toContain(l);
  });
});

describe('command palette destinations', () => {
  const dest = [
    { path: '/dashboard' }, { path: '/banking/bnk-1/reconcile' }, { path: '/periods/close-pack' }, { path: '/settings/import' }, { path: '/bills' },
  ];
  it('live mode keeps only connected screens', async () => {
    const { reachableDestinations } = await import('../src/components/domain/commandVerbs');
    expect(reachableDestinations(dest, 'acme', true).map((d) => d.path)).toEqual(['/dashboard', '/periods/close-pack', '/settings/import', '/bills']);
  });
  it('mock mode keeps all of them', async () => {
    const { reachableDestinations } = await import('../src/components/domain/commandVerbs');
    expect(reachableDestinations(dest, 'acme', false)).toEqual(dest);
  });
});
