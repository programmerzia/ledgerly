<?php

declare(strict_types=1);

namespace App\Queries\Trade;

use App\Models\Trade\Settlement;
use Illuminate\Database\Eloquent\Builder;

/** The company's settlements, filtered; the caller paginates (settlement date, newest first). */
final class ListSettlements
{
    /**
     * @param  array{kind?: string|null, status?: string|null, contact_id?: string|null, from?: string|null, to?: string|null, search?: string|null}  $f
     * @return Builder<Settlement>
     */
    public function __invoke(string $companyId, array $f): Builder
    {
        $q = Settlement::query()->where('company_id', $companyId);
        foreach (['kind', 'status', 'contact_id'] as $column) {
            if (isset($f[$column])) {
                $q->where($column, $f[$column]);
            }
        }
        if (isset($f['from'])) {
            $q->where('settlement_date', '>=', $f['from']);
        }
        if (isset($f['to'])) {
            $q->where('settlement_date', '<=', $f['to']);
        }
        if (isset($f['search']) && trim($f['search']) !== '') {
            $like = '%'.addcslashes(trim($f['search']), '\\%_').'%';
            $q->where(fn (Builder $w) => $w->where('number', 'ilike', $like)->orWhere('reference', 'ilike', $like)->orWhere('memo', 'ilike', $like));
        }

        return $q;
    }
}
