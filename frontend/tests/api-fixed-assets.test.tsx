import React from 'react';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  asMethod, bpToPercent, categoryToDraft, emptyAssetTx, emptyCategoryDraft, emptyNewAsset, emptyTaxClassDraft, percentToBp, scheduleQuery, toAssetCreateRequest, toAssetSchedule,
  toAssetTxRequest, toAssetUpdateRequest, toCategory, toCategoryRequest, toDepreciationPreview, toFixedAsset, toReconciliation, toTaxClassRequest, toTaxSchedule, toTxPreview, unitsBody,
  unitsQuery, wornDownPercent, blockerText, type ApiAssetCategory, type ApiFixedAsset,
} from '@/api/adapters/fixedAssets';
import { toApprovalItem, journalTypeLabel, type ApiApproval } from '@/api/adapters/journal';
import { checkTitle } from '@/api/adapters/fiscal';
import { toPostingRows } from '@/api/adapters/admin';
import { ReconciliationCard } from '@/pages/Accounting/live/assets/RegisterTab';
import { TxPreviewPanel } from '@/pages/Accounting/live/assets/AdjustmentsTab';
import { ASSET_TABS, tabFromParam } from '@/pages/Accounting/live/FixedAssetsLive';

const m = (amount: number) => ({ amount, currency: 'USD' });

describe('rates in percent and basis points', () => {
  it('turns percent text into whole basis points with integer maths', () => {
    expect(percentToBp('20')).toBe(2000);
    expect(percentToBp('12.5')).toBe(1250);
    expect(percentToBp('12.55')).toBe(1255);
    expect(percentToBp('0.01')).toBe(1);
    expect(percentToBp('33.33%')).toBe(3333);
    expect(percentToBp('100')).toBe(10000);
  });
  it('treats blank as none and refuses anything else', () => {
    expect(percentToBp('')).toBeNull();
    expect(percentToBp('  ')).toBeNull();
    expect(percentToBp('12.555')).toBeUndefined();
    expect(percentToBp('-5')).toBeUndefined();
    expect(percentToBp('1e2')).toBeUndefined();
    expect(percentToBp('abc')).toBeUndefined();
  });
  it('shows basis points as percent and round-trips', () => {
    expect(bpToPercent(2000)).toBe('20');
    expect(bpToPercent(1250)).toBe('12.5');
    expect(bpToPercent(1255)).toBe('12.55');
    expect(bpToPercent(5)).toBe('0.05');
    expect(bpToPercent(null)).toBe('');
    for (const bp of [1, 5, 99, 100, 1250, 3333, 10000]) expect(percentToBp(bpToPercent(bp))).toBe(bp);
  });
});

describe('category request', () => {
  const cat: ApiAssetCategory = {
    id: 'c1', name: 'Vehicles', asset_account_id: 'a', accumulated_account_id: 'b', expense_account_id: 'c', measurement_model: 'revaluation',
    default_method: 'declining_balance', default_life_months: null, default_declining_rate_bp: 2500, is_depreciable: true, is_active: true, version: 3, can: { update: true },
  };
  it('maps the resource and fills the form with the rate in percent', () => {
    const c = toCategory(cat);
    expect(c.measurement_model).toBe('revaluation');
    expect(c.can.update).toBe(true);
    expect(categoryToDraft(c).rate_percent).toBe('25');
  });
  it('sends the rate as basis points and the version only on an update', () => {
    const d = { ...categoryToDraft(toCategory(cat)), rate_percent: '12.5' };
    const r = toCategoryRequest(d, 3);
    expect(r.ok && r.body).toMatchObject({ default_declining_rate_bp: 1250, default_life_months: null, version: 3, measurement_model: 'revaluation' });
    const created = toCategoryRequest({ ...d }, undefined);
    expect(created.ok && 'version' in created.body).toBe(false);
  });
  it('asks for what is missing in plain words', () => {
    expect(toCategoryRequest(emptyCategoryDraft())).toEqual({ ok: false, error: 'Give the category a name.' });
    expect(toCategoryRequest({ ...emptyCategoryDraft(), name: 'X' })).toEqual({ ok: false, error: 'Choose all three accounts.' });
    const base = { ...emptyCategoryDraft(), name: 'X', asset_account_id: 'a', accumulated_account_id: 'b', expense_account_id: 'c' };
    expect(toCategoryRequest({ ...base, default_method: 'declining_balance', rate_percent: '' }).ok).toBe(false);
    expect(toCategoryRequest({ ...base, rate_percent: '1.234' }).ok).toBe(false);
    expect(toCategoryRequest({ ...base, life_months: '5000' }).ok).toBe(false);
  });
});

describe('tax class request', () => {
  it('converts both rates and keeps a blank first year as null', () => {
    const r = toTaxClassRequest({ ...emptyTaxClassDraft(), code: 'A', name: 'Plant', annual_percent: '20', first_year_percent: '' });
    expect(r.ok && r.body).toMatchObject({ annual_rate_bp: 2000, first_year_rate_bp: null });
    const r2 = toTaxClassRequest({ ...emptyTaxClassDraft(), code: 'A', name: 'Plant', annual_percent: '20', first_year_percent: '40' }, 2);
    expect(r2.ok && r2.body).toMatchObject({ first_year_rate_bp: 4000, version: 2 });
    expect(toTaxClassRequest({ ...emptyTaxClassDraft(), code: 'A', name: 'Plant', annual_percent: '' }).ok).toBe(false);
  });
});

const apiAsset = (over: Partial<ApiFixedAsset> = {}): ApiFixedAsset => ({
  id: 'f1', number: 'FA-0001', name: 'Van', description: null, category_id: 'c1', category_name: 'Vehicles', status: 'active', fully_depreciated: false,
  acquired_on: '2026-01-10', available_from: '2026-01-10', disposed_on: null, cost: m(1_200_000), residual: m(200_000), accumulated_depreciation: m(300_000),
  accumulated_impairment: m(50_000), carrying_amount: m(850_000), revaluation_reserve: m(0), method: 'straight_line', useful_life_months: 60, declining_rate_bp: null,
  units_total: null, units_used: 0, months_charged: 6, depreciated_through: '2026-06-30', is_opening: true, opening_accumulated: m(100_000), opening_as_of: '2026-01-01',
  source_type: null, source_id: null, source_journal_id: null, tax_class_id: null, dimensions: { d1: 'v1' }, version: 4, can: { update: true }, ...over,
});

describe('register', () => {
  it('maps money to minor units and adds depreciation and write-downs', () => {
    const a = toFixedAsset(apiAsset());
    expect(a.accumulated).toBe(350_000);
    expect(a.carrying).toBe(850_000);
    expect(a.is_opening).toBe(true);
    expect(a.opening_accumulated).toBe(100_000);
    expect(wornDownPercent(a)).toBe(35);
  });
  it('sends the dimensions back unchanged on an update and always the version', () => {
    const a = toFixedAsset(apiAsset());
    const r = toAssetUpdateRequest(a, { name: ' Van 2 ', description: '', residual: 100_000, method: 'straight_line', life_months: '48', rate_percent: '', units_total: '', tax_class_id: '' });
    expect(r.ok && r.body).toEqual({
      name: 'Van 2', description: null, residual: 100_000, method: 'straight_line', useful_life_months: 48, declining_rate_bp: null, units_total: null,
      dimensions: { d1: 'v1' }, tax_class_id: null, version: 4,
    });
  });
  it('refuses a residual above the cost and a missing rate or units', () => {
    const a = toFixedAsset(apiAsset());
    const base = { name: 'x', description: '', residual: 0, method: 'straight_line' as const, life_months: '12', rate_percent: '', units_total: '', tax_class_id: '' };
    expect(toAssetUpdateRequest(a, { ...base, residual: a.cost + 1 }).ok).toBe(false);
    expect(toAssetUpdateRequest(a, { ...base, method: 'declining_balance' }).ok).toBe(false);
    expect(toAssetUpdateRequest(a, { ...base, method: 'units_of_production' }).ok).toBe(false);
    expect(toAssetUpdateRequest(a, { ...base, method: 'declining_balance', rate_percent: '20' }).ok).toBe(true);
  });
  it('builds a capitalise body from the posted line and an opening body without a source', () => {
    const cap = toAssetCreateRequest({ ...emptyNewAsset(), source_type: 'bill_line', source_id: 's1', category_id: 'c1', name: 'Laptop', cost: 90_000, acquired_on: '2026-03-01', life_months: '36' });
    expect(cap.ok && cap.body).toMatchObject({ source_type: 'bill_line', source_id: 's1', cost: 90_000, category_id: 'c1', useful_life_months: 36 });
    expect(cap.ok && 'opening_accumulated' in cap.body).toBe(false);
    const open = toAssetCreateRequest({ ...emptyNewAsset(), category_id: 'c1', name: 'Old press', cost: 500_000, acquired_on: '2020-01-01', opening_accumulated: 200_000, opening_as_of: '2026-01-01' });
    expect(open.ok && open.body).toMatchObject({ cost: 500_000, opening_accumulated: 200_000, opening_as_of: '2026-01-01' });
    expect(open.ok && 'source_type' in open.body).toBe(false);
  });
  it('does not accept an entry with neither a source nor the opening figures', () => {
    expect(toAssetCreateRequest({ ...emptyNewAsset(), category_id: 'c1', name: 'x' }).ok).toBe(false);
    expect(toAssetCreateRequest({ ...emptyNewAsset(), category_id: 'c1', name: 'x', cost: 100, acquired_on: '2026-01-01', opening_accumulated: 50 }).ok).toBe(false);
  });
  it('knows its methods', () => {
    expect(asMethod('declining_balance')).toBe('declining_balance');
    expect(asMethod('whatever')).toBe('straight_line');
  });
});

describe('register to ledger check', () => {
  const raw = {
    as_of: '2026-10-31', reconciles: false,
    rows: [{ account: { id: 'a1', code: '1500', name: 'Equipment' }, kind: 'cost', categories: 'Equipment', register: m(1000), ledger: m(900), difference: m(100), opening_assets: m(0), reconciles: false, drill: { account_id: 'a1', to: '2026-10-31', exclude_closing: false } }],
  };
  it('maps rows with the drill key', () => {
    const r = toReconciliation(raw);
    expect(r.rows[0]).toMatchObject({ account_code: '1500', difference: 100, reconciles: false, drill: { account_id: 'a1', to: '2026-10-31' } });
  });
  it('renders the differences and a link to the account in the general ledger', () => {
    const html = renderToStaticMarkup(<MemoryRouter><ReconciliationCard rec={toReconciliation(raw)} coSlug="acme" currency="USD" /></MemoryRouter>);
    expect(html).toContain('Differences found');
    expect(html).toContain('1500 Equipment');
    expect(html).toContain('/acme/reports/general-ledger?account=a1&amp;to=2026-10-31');
  });
  it('says so when everything matches', () => {
    const html = renderToStaticMarkup(<MemoryRouter><ReconciliationCard rec={{ as_of: '', reconciles: true, rows: [] }} coSlug="acme" currency="USD" /></MemoryRouter>);
    expect(html).toContain('Matches');
  });
});

describe('depreciation preview', () => {
  const line = { asset_id: 'f1', asset_number: 'FA-1', asset_name: 'Van', category_name: 'Vehicles', method: 'units_of_production', months: 3, catch_up_months: 2, amount: m(5000), units: 10, carrying_before: m(9000), carrying_after: m(4000) };
  it('maps lines, catch-up months, pending units and blockers', () => {
    const p = toDepreciationPreview({ period_id: 'p1', period_name: 'October 2026', as_of: '2026-10-31', total: m(5000), lines: [line], pending_units: [{ ...line, asset_id: 'f2' }], blockers: ['units_required'] });
    expect(p.lines[0]).toMatchObject({ catch_up_months: 2, amount: 5000, method: 'units_of_production' });
    expect(p.pending_units[0].asset_id).toBe('f2');
    expect(p.blockers).toEqual(['units_required']);
    expect(blockerText('period_closed')).toContain('closed');
    expect(blockerText('something_new')).toBe('something new');
  });
  it('sends units as units[assetId] in the query and as an id map in the body, skipping blanks', () => {
    expect(unitsQuery({ a: '12', b: '', c: 'x' })).toEqual({ 'units[a]': '12' });
    expect(unitsBody({ a: '12', b: '', c: '0' })).toEqual({ a: 12, c: 0 });
  });
});

describe('sales, write-downs and revaluations', () => {
  const base = emptyAssetTx('disposal');
  it('needs a receiving account when there are proceeds, and none when scrapped', () => {
    expect(toAssetTxRequest({ ...base, tx_date: '2026-10-01', asset_id: 'f1', proceeds: 100 }).ok).toBe(false);
    const sold = toAssetTxRequest({ ...base, tx_date: '2026-10-01', asset_id: 'f1', proceeds: 100, proceeds_account_id: 'bank', transfer_reserve: true });
    expect(sold.ok && sold.body).toMatchObject({ kind: 'disposal', proceeds: 100, proceeds_account_id: 'bank', transfer_reserve: true });
    const scrapped = toAssetTxRequest({ ...base, tx_date: '2026-10-01', asset_id: 'f1', proceeds_account_id: 'bank' });
    expect(scrapped.ok && scrapped.body).toMatchObject({ proceeds: 0, proceeds_account_id: null });
  });
  it('wants an amount and a reason for write-downs and their reversal', () => {
    const imp = { ...emptyAssetTx('impairment'), tx_date: '2026-10-01', asset_id: 'f1', amount: 500 };
    expect(toAssetTxRequest(imp).ok).toBe(false);
    const ok = toAssetTxRequest({ ...imp, reason: 'Flood damage' });
    expect(ok.ok && ok.body).toMatchObject({ kind: 'impairment', amount: 500, reason: 'Flood damage' });
    expect(toAssetTxRequest({ ...imp, kind: 'impairment_reversal', reason: 'Repaired', amount: 0 }).ok).toBe(false);
  });
  it('wants a value for every asset in the category when revaluing', () => {
    const rev = { ...emptyAssetTx('revaluation'), tx_date: '2026-12-31', category_id: 'c1', values: { f1: 100, f2: null } };
    expect(toAssetTxRequest(rev).ok).toBe(false);
    const ok = toAssetTxRequest({ ...rev, values: { f1: 100, f2: 250 } });
    expect(ok.ok && ok.body).toMatchObject({ kind: 'revaluation', category_id: 'c1', values: [{ asset_id: 'f1', value: 100 }, { asset_id: 'f2', value: 250 }] });
    expect(toAssetTxRequest({ ...rev, values: {} }).ok).toBe(false);
  });
  const rawPreview = {
    kind: 'impairment_reversal', tx_date: '2026-10-01', total: m(300),
    assets: [{
      asset_id: 'f1', asset_number: 'FA-1', asset_name: 'Van', carrying_before: m(1000), carrying_after: m(1300), gain_or_loss: null, to_reserve: null, to_profit_or_loss: m(300), cap: m(400),
      journal_lines: [{ account_code: '1510', account_name: 'Accumulated depreciation', debit: m(300), credit: m(0) }, { account_code: '4900', account_name: 'Impairment reversal', debit: m(0), credit: m(300) }],
    }],
  };
  it('maps the preview with the cap and the journal lines', () => {
    const p = toTxPreview(rawPreview);
    expect(p.assets[0]).toMatchObject({ cap: 400, to_profit_or_loss: 300, gain_or_loss: null });
    expect(p.assets[0].journal_lines).toHaveLength(2);
  });
  it('renders the journal lines and the cap before anything is created', () => {
    const html = renderToStaticMarkup(<TxPreviewPanel preview={toTxPreview(rawPreview)} currency="USD" />);
    expect(html).toContain('Most that can be reversed');
    expect(html).toContain('1510 Accumulated depreciation');
    expect(html).toContain('4900 Impairment reversal');
  });
});

describe('tax and asset schedule', () => {
  it('maps the tax schedule', () => {
    const t = toTaxSchedule({ assets: [{ asset_id: 'f1', number: 'FA-1', name: 'Van', class_name: 'Plant', cost: m(1000), annual_rate_bp: 2000, first_year_rate_bp: null, stopped_after_year: null, years: [{ year: 2026, label: '2026', allowance: m(200), written_down: m(800) }] }], by_year: [{ year: 2026, label: '2026', allowance: m(200), written_down: m(800) }] });
    expect(t.assets[0].years[0]).toMatchObject({ allowance: 200, written_down: 800 });
    expect(t.assets[0].annual_rate_bp).toBe(2000);
  });
  it('maps the schedule figures, events and the tie to the ledger', () => {
    const fig = { cost: { opening: m(1), additions: m(2), opening_assets: m(3), disposals: m(4), revaluation: m(5), closing: m(6) }, accumulated: { opening: m(1), opening_assets: m(2), charge: m(3), impairment: m(4), disposals: m(5), revaluation: m(6), closing: m(7) }, carrying_opening: m(10), carrying_closing: m(11) };
    const r = toAssetSchedule({ from: '2026-01-01', to: '2026-12-31', categories: [{ category_id: 'c1', category_name: 'Vehicles', ...fig, assets: [{ asset_id: 'f1', number: 'FA-1', name: 'Van', ...fig }] }], totals: fig, events: [{ date: '2026-02-01', kind: 'depreciation', asset_number: 'FA-1', cost: m(0), accumulated: m(3), journal_id: 'j1', journal_number: 'JE-1' }, { date: '2026-02-02', kind: 'opening', asset_number: 'FA-2', cost: m(5), accumulated: m(1), journal_id: null, journal_number: null }], ties_to_ledger: true });
    expect(r.categories[0].accumulated.charge).toBe(3);
    expect(r.categories[0].assets[0].carrying_closing).toBe(11);
    expect(r.events[0].journal_id).toBe('j1');
    expect(r.events[1].journal_id).toBeNull();
    expect(r.ties_to_ledger).toBe(true);
  });
  it('asks by period or by range', () => {
    expect(scheduleQuery({ periodId: 'p1', from: 'x' })).toEqual({ period_id: 'p1' });
    expect(scheduleQuery({ from: '2026-01-01', to: '2026-12-31' })).toEqual({ from: '2026-01-01', to: '2026-12-31' });
  });
});

describe('wiring for other screens', () => {
  const approval = (t: string, doc: Record<string, unknown>) => ({ id: 'r1', document_type: t, document_id: 'd1', step: 1, slot: 0, role: 'accountant', requested_by: 'u1', requested_by_name: 'Sam', requested_at: '2026-10-31T10:00:00Z', document: { id: 'd1', amount: m(1234), version: 2, ...doc } }) as unknown as ApiApproval;
  it('labels depreciation runs and asset adjustments in the approvals inbox and links them to the assets screen', () => {
    const run = toApprovalItem(approval('depreciation_run', { number: 'DEP-1', memo: 'October' }));
    expect(run).toMatchObject({ document_type: 'depreciation_run', api_type: 'depreciation_run', title: 'Depreciation run: October', amount: 1234, version: 2, link: { path: 'assets', id: 'd1', tab: 'depreciation' } });
    const tx = toApprovalItem(approval('asset_transaction', { kind: 'disposal' }));
    expect(tx).toMatchObject({ document_type: 'asset_transaction', api_type: 'asset_transaction', title: 'Sale or scrapping', link: { path: 'assets', tab: 'adjustments' } });
  });
  it('names the new close check, journal type and posting accounts', () => {
    expect(checkTitle('DEPR_RUN')).toBe('Depreciation run done or nothing to depreciate');
    expect(journalTypeLabel('asset')).toBe('Fixed asset');
    expect(journalTypeLabel('manual')).toBe('manual');
    const rows = toPostingRows({ posting_accounts: { asset_disposal_gain: null, asset_disposal_loss: null, impairment_loss: null, impairment_reversal: null, revaluation_reserve: null } } as never);
    expect(rows.map((r) => r.label)).toEqual(['Gain on selling an asset', 'Loss on selling an asset', 'Asset write-down expense', 'Asset write-down reversed', 'Revaluation reserve']);
    expect(rows.every((r) => r.needs === null)).toBe(true);
  });
  it('picks the tab from the address and falls back to the asset list', () => {
    expect(ASSET_TABS.map((t) => t.id)).toEqual(['register', 'depreciation', 'adjustments', 'schedule', 'tax', 'categories']);
    expect(tabFromParam('depreciation')).toBe('depreciation');
    expect(tabFromParam('nope')).toBe('register');
    expect(tabFromParam(null)).toBe('register');
  });
});
