<?php

declare(strict_types=1);

namespace App\Services\FixedAssets;

use App\Domain\Fiscal\PeriodStatus;
use App\Domain\FixedAssets\AssetOutcome;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\FixedAssets\AssetCategory;
use App\Models\FixedAssets\AssetTransaction;
use App\Models\FixedAssets\FixedAsset;

/** What would stop an asset transaction from posting now: submit asks early, posting asks again under locks. */
final class AssetTransactionReadiness
{
    public function __construct(private readonly AssetTransactionPlanner $planner, private readonly AssetJournals $journals) {}

    /** @return list<Violation> */
    public function of(AssetTransaction $tx): array
    {
        $date = $tx->tx_date->format('Y-m-d');
        $period = FiscalPeriod::query()->where('company_id', $tx->company_id)->where('kind', 'regular')->where('starts_on', '<=', $date)->where('ends_on', '>=', $date)->first();
        if ($period === null) {
            return [new Violation('period_missing', 'No fiscal period covers the date.')];
        }
        if (! in_array($period->status, [PeriodStatus::Open, PeriodStatus::SoftClosed], true)) {
            return [new Violation('period_closed', 'The period is closed; this cannot post into it.')];
        }
        try {
            $this->assertCurrent($tx);
        } catch (DomainRuleViolation $e) {
            return $e->violations !== [] ? $e->violations : [new Violation($e->errorCode, $e->getMessage())];
        }

        return [];
    }

    /**
     * Recomputes the document from the register as it is now and checks it against the stored figures; builds the journal draft so a
     * missing posting account shows. Throws what the planner or the journal builder refuses, or `asset_transaction_stale`.
     *
     * @return list<array{asset: FixedAsset, category: AssetCategory, input: int, outcome: AssetOutcome}>
     */
    public function assertCurrent(AssetTransaction $tx): array
    {
        $lines = $tx->lines()->get();
        $inputs = [];
        foreach ($lines as $l) {
            $inputs[$l->asset_id] = $l->input_amount;
        }
        $plan = $this->planner->plan($tx->company_id, $tx->kind, $tx->tx_date->format('Y-m-d'), $tx->category_id, $inputs, $tx->params);
        $now = [];
        foreach ($plan as $p) {
            $now[$p['asset']->id] = self::canonical($p['outcome']->toArray());
        }
        $stored = [];
        foreach ($lines as $l) {
            $stored[$l->asset_id] = self::canonical($l->figures);
        }
        ksort($now);
        ksort($stored);
        if ($now !== $stored) {
            throw DomainRuleViolation::single('asset_transaction_stale', 'The assets changed since this was drafted, so its figures are out of date. Void it and draft it again.');
        }
        $this->journals->transaction($tx, $plan, 'CHECK');

        return $plan;
    }

    /**
     * @param  array<string, mixed>  $figures
     * @return array<string, mixed>
     */
    private static function canonical(array $figures): array
    {
        ksort($figures);
        foreach ($figures as $k => $v) {
            if (is_array($v) && ! array_is_list($v)) {
                $figures[$k] = self::canonical($v);
            }
        }

        return $figures;
    }
}
