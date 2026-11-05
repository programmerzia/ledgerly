<?php

declare(strict_types=1);

namespace App\Services\FixedAssets;

use Illuminate\Support\Facades\DB;

/** Questions about the movement log that reversals depend on. */
final class AssetActivity
{
    /**
     * Whether an asset the document moved has been moved again since by a document that is still in force. A document is
     * reversed in reverse order: undoing an earlier charge or impairment under a later one would leave the register wrong.
     * Movement ids are time-ordered (UUIDv7), so "later" is id order.
     */
    public function hasLaterActivity(string $documentType, string $documentId): bool
    {
        return DB::selectOne(
            "SELECT 1 AS later FROM asset_movements m
              JOIN (SELECT asset_id, MAX(id::text) AS last_id FROM asset_movements WHERE document_type = ? AND document_id = ? AND kind <> 'reversal' GROUP BY asset_id) own ON own.asset_id = m.asset_id
             WHERE m.kind <> 'reversal' AND m.id::text > own.last_id
               AND NOT (m.document_type IS NOT DISTINCT FROM ? AND m.document_id IS NOT DISTINCT FROM ?::uuid)
               AND NOT EXISTS (SELECT 1 FROM asset_movements r WHERE r.kind = 'reversal' AND r.meta->>'reverses' = m.id::text)
             LIMIT 1",
            [$documentType, $documentId, $documentType, $documentId],
        ) !== null;
    }
}
