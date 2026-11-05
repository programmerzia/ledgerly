<?php

declare(strict_types=1);

namespace App\Services\FixedAssets;

use App\Contracts\IdGenerator;
use App\Models\FixedAssets\AssetMovement;
use App\Models\FixedAssets\FixedAsset;

/**
 * The only writer of an asset's running figures and of `asset_movements`. The caller holds the asset's row lock (13 §8).
 * A movement changes the register and appends one log row in the same transaction, so the figures always equal the
 * sum of the log.
 */
final class AssetLedger
{
    /** Columns a movement may replace with an absolute value. */
    private const array SETTABLE = ['status', 'disposed_on', 'depreciated_through', 'counterfactual_carrying'];

    public function __construct(private readonly IdGenerator $ids) {}

    public function record(FixedAsset $asset, MovementSpec $m): AssetMovement
    {
        $before = [];
        foreach ($m->set as $column => $value) {
            if (! in_array($column, self::SETTABLE, true)) {
                throw new \LogicException("{$column} cannot be set by a movement.");
            }
            $before[$column] = $this->plain($asset->getAttribute($column));
        }

        $asset->forceFill([
            'cost' => $asset->cost + $m->cost,
            'accumulated_depreciation' => $asset->accumulated_depreciation + $m->depreciation,
            'accumulated_impairment' => $asset->accumulated_impairment + $m->impairment,
            'revaluation_reserve' => $asset->revaluation_reserve + $m->reserve,
            'revaluation_deficit' => $asset->revaluation_deficit + $m->deficit,
            'months_charged' => $asset->months_charged + $m->months,
            'units_used' => $asset->units_used + $m->units,
            'lock_version' => $asset->lock_version + 1,
            ...$m->set,
        ])->save();

        return $this->log($asset, $m, $before);
    }

    /**
     * Undoes every movement of a document: appends the opposite of each, restores the non-additive figures it replaced,
     * and returns the new rows. The caller has locked the assets.
     *
     * @return list<AssetMovement>
     */
    public function reverseDocument(string $documentType, string $documentId, string $date, ?string $journalId): array
    {
        $out = [];
        $rows = AssetMovement::query()->where('document_type', $documentType)->where('document_id', $documentId)
            ->where('kind', '<>', 'reversal')->orderBy('created_at')->orderBy('id')->get();
        foreach ($rows as $row) {
            $asset = FixedAsset::query()->whereKey($row->asset_id)->firstOrFail();
            /** @var array<string, mixed> $before */
            $before = is_array($row->meta['before'] ?? null) ? $row->meta['before'] : [];
            $out[] = $this->record($asset, new MovementSpec(
                $date, 'reversal', -$row->cost_delta, -$row->depreciation_delta, -$row->impairment_delta, -$row->reserve_delta,
                -$row->deficit_delta, -$row->months_delta, -$row->units_delta, $journalId, $documentType, $documentId,
                $before, ['reverses' => $row->id, 'reversed_kind' => $row->kind],
            ));
        }

        return $out;
    }

    /** @param array<string, mixed> $before */
    public function log(FixedAsset $asset, MovementSpec $m, array $before = []): AssetMovement
    {
        $row = new AssetMovement;
        $row->forceFill([
            'id' => $this->ids->next(), 'tenant_id' => $asset->tenant_id, 'company_id' => $asset->company_id,
            'asset_id' => $asset->id, 'category_id' => $asset->category_id, 'movement_date' => $m->date, 'kind' => $m->kind,
            'cost_delta' => $m->cost, 'depreciation_delta' => $m->depreciation, 'impairment_delta' => $m->impairment,
            'reserve_delta' => $m->reserve, 'deficit_delta' => $m->deficit, 'months_delta' => $m->months, 'units_delta' => $m->units,
            'journal_id' => $m->journalId, 'document_type' => $m->documentType, 'document_id' => $m->documentId,
            'meta' => ['before' => $before] + $m->meta,
        ])->save();

        return $row;
    }

    private function plain(mixed $value): mixed
    {
        return $value instanceof \DateTimeInterface ? $value->format('Y-m-d') : $value;
    }
}
