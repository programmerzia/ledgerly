<?php

declare(strict_types=1);

namespace App\Models\Fx;

use App\Models\BaseModel;
use DateTimeImmutable;

/**
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $fiscal_period_id
 * @property DateTimeImmutable $as_of
 * @property string $status posted|void|reversed
 * @property string|null $journal_id
 * @property string|null $reversal_journal_id null while the automatic reversal is pending
 * @property string $base_currency
 * @property int $total_unrealised
 * @property array<string, mixed> $detail
 * @property string|null $created_by
 */
class FxRevaluation extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['as_of' => 'immutable_date', 'total_unrealised' => 'integer', 'detail' => 'array'];
    }

    /** A posted run whose journal still waits for its automatic reversal. */
    public function isReversalPending(): bool
    {
        return $this->status === 'posted' && $this->journal_id !== null && $this->reversal_journal_id === null;
    }
}
