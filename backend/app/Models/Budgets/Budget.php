<?php

declare(strict_types=1);

namespace App\Models\Budgets;

use App\Models\BaseModel;
use App\Models\Fiscal\FiscalYear;
use DateTimeImmutable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A budget version for a fiscal year (D15 item 5). draft → approved → archived; only a draft can be edited.
 *
 * @property string $id
 * @property string $tenant_id
 * @property string $company_id
 * @property string $fiscal_year_id
 * @property string $name
 * @property int $version
 * @property string $status
 * @property string|null $copied_from_id
 * @property int $lock_version
 * @property string|null $created_by
 * @property string|null $approved_by
 * @property DateTimeImmutable|null $approved_at
 * @property DateTimeImmutable|null $archived_at
 */
class Budget extends BaseModel
{
    public const string DRAFT = 'draft';

    public const string APPROVED = 'approved';

    public const string ARCHIVED = 'archived';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['version' => 'integer', 'lock_version' => 'integer', 'approved_at' => 'immutable_datetime', 'archived_at' => 'immutable_datetime'];
    }

    /** @return BelongsTo<FiscalYear, $this> */
    public function fiscalYear(): BelongsTo
    {
        return $this->belongsTo(FiscalYear::class);
    }

    /** @return HasMany<BudgetLine, $this> */
    public function lines(): HasMany
    {
        return $this->hasMany(BudgetLine::class);
    }
}
