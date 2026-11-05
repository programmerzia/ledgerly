<?php

declare(strict_types=1);

namespace App\Queries\FixedAssets;

use App\Actions\FixedAssets\Inputs\AssetTransactionInput;
use App\Models\FixedAssets\AssetTransaction;
use App\Models\Ledger\Account;
use App\Services\FixedAssets\AssetJournals;
use App\Services\FixedAssets\AssetTransactionPlanner;

/**
 * What a disposal, impairment, reversal or revaluation would do, per asset, with the journal lines it would post. Writes nothing and
 * takes no lock. Refuses what the draft would refuse (depreciation not current, a missing posting account, a reversal over its cap).
 */
final class PreviewAssetTransaction
{
    public function __construct(private readonly AssetTransactionPlanner $planner, private readonly AssetJournals $journals) {}

    public function __invoke(AssetTransactionInput $in): AssetTransactionPreviewData
    {
        $plan = $this->planner->plan($in->companyId, $in->kind, $in->txDate, $in->categoryId, $in->lines, $in->params);
        $tx = new AssetTransaction;
        $tx->forceFill(['id' => '00000000-0000-7000-8000-000000000000', 'company_id' => $in->companyId, 'kind' => $in->kind, 'tx_date' => $in->txDate, 'reason' => $in->reason, 'params' => $in->params]);
        $accounts = Account::query()->where('company_id', $in->companyId)->get()->keyBy('id');

        $assets = [];
        $total = 0;
        foreach ($plan as $p) {
            $single = $this->journals->transaction($tx, [$p], 'PREVIEW');
            $lines = array_map(fn ($l): AssetPreviewJournalLine => new AssetPreviewJournalLine(
                (string) $accounts->get($l->accountId)?->code, (string) $accounts->get($l->accountId)?->name, $l->debit, $l->credit,
            ), $single->lines);
            $f = $p['outcome']->facts;
            $assets[] = new AssetPreviewLine(
                $p['asset']->id, $p['asset']->number, $p['asset']->name, (int) ($f['carrying_before'] ?? $f['carrying'] ?? 0),
                (int) ($f['carrying_after'] ?? 0), $f['gain_or_loss'] ?? null, $f['to_reserve'] ?? $f['from_reserve'] ?? null,
                $f['to_profit_or_loss'] ?? null, $f['cap'] ?? null, $lines,
            );
            $total += array_sum(array_map(fn ($l): int => $l->debit, $single->lines));
        }

        return new AssetTransactionPreviewData($in->kind, $in->txDate, $total, $assets);
    }
}
