<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Http\Support\Json;
use App\Queries\FixedAssets\AssetLedgerCheck;
use App\Support\Reports\ReportRunner;

/**
 * The fixed asset schedule (PRD 4.12, IAS 16.73(e)) for a date range, by category and by asset, read from the register's
 * movement log so every figure is traceable to a movement and, through it, to a journal:
 *
 *  - cost: opening, additions, opening assets brought in at go-live, disposals, revaluation, closing;
 *  - accumulated depreciation and impairment: opening, opening assets, charge, impairment (and its reversal), disposals,
 *    revaluation (accumulated depreciation eliminated against cost), closing;
 *  - carrying amount: cost less accumulated, at the start and at the end.
 *
 * A reversal is shown in the column of the thing it reverses, so a reversed disposal nets out there. `events` lists the movements in
 * the range with their journals, for drill-down; `ties_to_ledger` is the register-to-ledger check at the closing date.
 */
final class AssetSchedule
{
    public function __construct(private readonly ReportRunner $runner, private readonly AssetLedgerCheck $check) {}

    /** @return array<string, mixed> */
    public function __invoke(ReportParams $p): array
    {
        $from = (string) $p->from;
        $to = $p->to;
        $cur = $p->currency;
        $db = $this->runner->db();

        $rows = $db->select(
            "SELECT m.asset_id, m.category_id,
                    CASE WHEN m.kind = 'reversal' THEN COALESCE(m.meta->>'reversed_kind', 'reversal') ELSE m.kind END AS k,
                    (m.movement_date < ?) AS before,
                    SUM(m.cost_delta)::bigint AS cost, SUM(m.depreciation_delta)::bigint AS dep, SUM(m.impairment_delta)::bigint AS imp
               FROM asset_movements m WHERE m.company_id = ? AND m.movement_date <= ?
              GROUP BY m.asset_id, m.category_id, k, before",
            [$from, $p->companyId, $to],
        );

        $blank = static fn (): array => [
            'cost_opening' => 0, 'cost_additions' => 0, 'cost_opening_assets' => 0, 'cost_disposals' => 0, 'cost_revaluation' => 0,
            'acc_opening' => 0, 'acc_opening_assets' => 0, 'acc_charge' => 0, 'acc_impairment' => 0, 'acc_disposals' => 0, 'acc_revaluation' => 0,
        ];
        /** @var array<string, array<string, int>> $byAsset */
        $byAsset = [];
        $categoryOf = [];
        foreach ($rows as $r) {
            $a = (string) $r->asset_id;
            $categoryOf[$a] = (string) $r->category_id;
            $byAsset[$a] ??= $blank();
            $cost = (int) $r->cost;
            $acc = (int) $r->dep + (int) $r->imp;
            if ($r->before) {
                $byAsset[$a]['cost_opening'] += $cost;
                $byAsset[$a]['acc_opening'] += $acc;

                continue;
            }
            match ($r->k) {
                'addition' => $byAsset[$a]['cost_additions'] += $cost,
                'opening' => [$byAsset[$a]['cost_opening_assets'] += $cost, $byAsset[$a]['acc_opening_assets'] += $acc],
                'disposal' => [$byAsset[$a]['cost_disposals'] += $cost, $byAsset[$a]['acc_disposals'] += $acc],
                'revaluation' => [$byAsset[$a]['cost_revaluation'] += $cost, $byAsset[$a]['acc_revaluation'] += $acc],
                'depreciation' => $byAsset[$a]['acc_charge'] += $acc,
                default => $byAsset[$a]['acc_impairment'] += $acc,    // impairment and impairment_reversal
            };
        }

        $assetInfo = [];
        foreach ($db->select('SELECT id, number, name, category_id FROM fixed_assets WHERE company_id = ? ORDER BY number', [$p->companyId]) as $a) {
            $assetInfo[(string) $a->id] = ['number' => (string) $a->number, 'name' => (string) $a->name, 'category_id' => (string) $a->category_id];
        }
        $categories = [];
        foreach ($db->select('SELECT id, name FROM asset_categories WHERE company_id = ? ORDER BY name', [$p->companyId]) as $c) {
            $categories[(string) $c->id] = (string) $c->name;
        }

        $assetRows = [];
        $categoryTotals = [];
        foreach ($assetInfo as $id => $info) {
            if (! isset($byAsset[$id])) {
                continue;
            }
            $figures = $byAsset[$id];
            $assetRows[$info['category_id']][] = ['asset_id' => $id, 'number' => $info['number'], 'name' => $info['name']] + $this->shape($figures, $cur);
            $categoryTotals[$info['category_id']] ??= $blank();
            foreach ($figures as $k => $v) {
                $categoryTotals[$info['category_id']][$k] += $v;
            }
        }

        $out = [];
        $grand = $blank();
        foreach ($categories as $id => $name) {
            if (! isset($categoryTotals[$id])) {
                continue;
            }
            foreach ($categoryTotals[$id] as $k => $v) {
                $grand[$k] += $v;
            }
            $out[] = ['category_id' => (string) $id, 'category_name' => $name] + $this->shape($categoryTotals[$id], $cur) + ['assets' => $assetRows[$id] ?? []];
        }

        $events = [];
        foreach ($db->select(
            "SELECT m.movement_date, m.kind, m.cost_delta, m.depreciation_delta, m.impairment_delta, m.asset_id, m.journal_id, j.number AS journal_number
               FROM asset_movements m LEFT JOIN journals j ON j.id = m.journal_id
              WHERE m.company_id = ? AND m.movement_date BETWEEN ? AND ? AND m.kind <> 'opening'
              ORDER BY m.movement_date, m.id LIMIT 500",
            [$p->companyId, $from, $to],
        ) as $e) {
            $events[] = [
                'date' => substr((string) $e->movement_date, 0, 10), 'kind' => (string) $e->kind, 'asset_number' => $assetInfo[(string) $e->asset_id]['number'] ?? '',
                'cost' => Json::money((int) $e->cost_delta, $cur), 'accumulated' => Json::money((int) $e->depreciation_delta + (int) $e->impairment_delta, $cur),
                'journal_id' => $e->journal_id === null ? null : (string) $e->journal_id, 'journal_number' => $e->journal_number === null ? null : (string) $e->journal_number,
            ];
        }

        return [
            'report' => 'asset_schedule', 'currency' => $cur, 'from' => $from, 'to' => $to,
            'categories' => $out,
            'totals' => $this->shape($grand, $cur),
            'events' => $events,
            'ties_to_ledger' => ($this->check)($p->companyId, $cur, $to)['reconciles'],
        ];
    }

    /**
     * @param  array<string, int>  $f
     * @return array<string, mixed>
     */
    private function shape(array $f, string $cur): array
    {
        $m = static fn (int $v): array => Json::money($v, $cur);
        $costClosing = $f['cost_opening'] + $f['cost_additions'] + $f['cost_opening_assets'] + $f['cost_disposals'] + $f['cost_revaluation'];
        $accClosing = $f['acc_opening'] + $f['acc_opening_assets'] + $f['acc_charge'] + $f['acc_impairment'] + $f['acc_disposals'] + $f['acc_revaluation'];

        return [
            'cost' => [
                'opening' => $m($f['cost_opening']), 'additions' => $m($f['cost_additions']), 'opening_assets' => $m($f['cost_opening_assets']),
                'disposals' => $m($f['cost_disposals']), 'revaluation' => $m($f['cost_revaluation']), 'closing' => $m($costClosing),
            ],
            'accumulated' => [
                'opening' => $m($f['acc_opening']), 'opening_assets' => $m($f['acc_opening_assets']), 'charge' => $m($f['acc_charge']),
                'impairment' => $m($f['acc_impairment']), 'disposals' => $m($f['acc_disposals']), 'revaluation' => $m($f['acc_revaluation']), 'closing' => $m($accClosing),
            ],
            'carrying_opening' => $m($f['cost_opening'] - $f['acc_opening']),
            'carrying_closing' => $m($costClosing - $accClosing),
        ];
    }
}
