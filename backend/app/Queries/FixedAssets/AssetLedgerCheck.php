<?php

declare(strict_types=1);

namespace App\Queries\FixedAssets;

use App\Http\Support\Json;
use App\Queries\Reports\AccountDirectory;
use App\Queries\Reports\LedgerBalances;
use App\Support\Reports\ReportRunner;

/**
 * Does the register agree with the ledger? For every fixed asset account that a category uses: the register's cost
 * against the account's debit balance; for every accumulated depreciation account: the register's accumulated depreciation
 * and impairment against its credit balance. Both are taken as of the same date, the register from its movement log. A
 * difference means a posting went to the account outside the register (or an opening asset was keyed differently from the
 * opening balances import), and is the thing to fix before the schedule is relied on.
 *
 * For accumulated accounts the amount brought in with opening assets is shown separately, so the opening position is visibly
 * the one the opening balances import carries.
 */
final class AssetLedgerCheck
{
    public function __construct(private readonly ReportRunner $runner, private readonly LedgerBalances $balances, private readonly AccountDirectory $accounts) {}

    /** @return array<string, mixed> */
    public function __invoke(string $companyId, string $currency, string $asOf): array
    {
        $db = $this->runner->db();
        $categories = $db->select('SELECT id, name, asset_account_id, accumulated_account_id FROM asset_categories WHERE company_id = ?', [$companyId]);
        $movement = [];
        foreach ($db->select(
            'SELECT category_id, SUM(cost_delta)::bigint AS cost, SUM(depreciation_delta + impairment_delta)::bigint AS accumulated,
                    COALESCE(SUM(depreciation_delta) FILTER (WHERE kind = \'opening\'), 0)::bigint AS opening
             FROM asset_movements WHERE company_id = ? AND movement_date <= ? GROUP BY category_id',
            [$companyId, $asOf],
        ) as $r) {
            $movement[(string) $r->category_id] = ['cost' => (int) $r->cost, 'accumulated' => (int) $r->accumulated, 'opening' => (int) $r->opening];
        }

        /** @var array<string, array{kind: string, register: int, opening: int, categories: list<string>}> $rows */
        $rows = [];
        foreach ($categories as $c) {
            $m = $movement[(string) $c->id] ?? ['cost' => 0, 'accumulated' => 0, 'opening' => 0];
            foreach ([['asset_account_id', 'cost', $m['cost'], 0], ['accumulated_account_id', 'accumulated', $m['accumulated'], $m['opening']]] as [$col, $kind, $amount, $opening]) {
                $id = (string) $c->{$col};
                $rows[$id] ??= ['kind' => $kind, 'register' => 0, 'opening' => 0, 'categories' => []];
                $rows[$id]['register'] += $amount;
                $rows[$id]['opening'] += $opening;
                $rows[$id]['categories'][] = (string) $c->name;
            }
        }

        $ledger = [];
        foreach ($this->balances->totals($companyId, null, $asOf, false, accountIds: $rows === [] ? [] : array_keys($rows)) as $b) {
            $ledger[$b->accountId] = $b->debit - $b->credit;
        }
        $all = $this->accounts->all($companyId);
        $out = [];
        $reconciles = true;
        foreach ($rows as $accountId => $r) {
            $gl = $r['kind'] === 'cost' ? ($ledger[$accountId] ?? 0) : -($ledger[$accountId] ?? 0);
            $difference = $r['register'] - $gl;
            $reconciles = $reconciles && $difference === 0;
            $out[] = [
                'account' => ($all[$accountId] ?? null)?->ref(),
                'kind' => (string) $r['kind'],
                'categories' => implode(', ', $r['categories']),
                'register' => Json::money((int) $r['register'], $currency),
                'ledger' => Json::money((int) $gl, $currency),
                'difference' => Json::money($difference, $currency),
                'opening_assets' => Json::money((int) $r['opening'], $currency),
                'reconciles' => $difference === 0,
                // Drill: the account's journal lines up to the date.
                'drill' => ['account_id' => (string) $accountId, 'to' => $asOf, 'exclude_closing' => false],
            ];
        }
        usort($out, static fn (array $a, array $b): int => [$a['kind'], (string) ($a['account']['code'] ?? '')] <=> [$b['kind'], (string) ($b['account']['code'] ?? '')]);

        return ['as_of' => $asOf, 'currency' => (string) $currency, 'rows' => $out, 'reconciles' => $reconciles];
    }
}
