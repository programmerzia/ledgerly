<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Http\Support\Json;
use App\Support\Reports\ReportRunner;
use Illuminate\Validation\ValidationException;

/**
 * 3c.19: one dimension's values as report columns. The columns are the values that carry an amount in the report,
 * ordered by value code, followed by an "untagged" column for lines with no value of that dimension, which is always
 * there. Because a line has exactly one value (or none) for a dimension, every amount lands in exactly one column and
 * the columns add up to the same figure the report shows without the breakdown.
 *
 * At most MAX_COLUMNS values become columns; more is refused with a message instead of being cut or merged, since an
 * "other" column would hide which values it holds.
 */
final class DimensionBreakdown
{
    public const int MAX_COLUMNS = 12;

    public function __construct(private readonly ReportRunner $runner) {}

    /** @return array{id: string, code: string, name: string} */
    public function dimension(ReportParams $p): array
    {
        $row = $this->runner->db()->selectOne('SELECT id, code, name FROM dimensions WHERE company_id = ? AND id = ?', [$p->companyId, (string) $p->breakdownId]);
        if ($row === null) {
            throw ValidationException::withMessages(['breakdown' => ['The dimension does not exist.']]);
        }

        return ['id' => (string) $row->id, 'code' => (string) $row->code, 'name' => (string) $row->name];
    }

    /**
     * @param  list<string|null>  $activeValues  value ids that carry an amount (null = untagged is ignored here)
     * @return array{dimension: array{id: string, code: string, name: string}, columns: list<array{value: array{id: string, code: string, name: string}|null}>, keys: list<string>}
     *                                                                                                                                                                              `keys` are the column keys in order, '' for untagged
     */
    public function columns(ReportParams $p, array $activeValues): array
    {
        $dimension = $this->dimension($p);
        $ids = array_values(array_unique(array_filter($activeValues, fn (?string $v): bool => $v !== null)));
        if (count($ids) > self::MAX_COLUMNS) {
            throw ValidationException::withMessages(['breakdown' => [sprintf(
                '%s has %d values with amounts in this report. A breakdown shows at most %d columns: filter %s to some of its values, or choose a shorter range.',
                $dimension['name'], count($ids), self::MAX_COLUMNS, $dimension['name'],
            )]]);
        }

        $values = [];
        if ($ids !== []) {
            $rows = $this->runner->db()->select(
                'SELECT id, code, name FROM dimension_values WHERE company_id = ? AND dimension_id = ? AND id IN ('.implode(', ', array_fill(0, count($ids), '?')).') ORDER BY code, id',
                [$p->companyId, $dimension['id'], ...$ids],
            );
            foreach ($rows as $r) {
                $values[] = ['id' => (string) $r->id, 'code' => (string) $r->code, 'name' => (string) $r->name];
            }
        }

        $columns = array_map(fn (array $v): array => ['value' => $v], $values);
        $columns[] = ['value' => null];

        return ['dimension' => $dimension, 'columns' => $columns, 'keys' => [...array_column($values, 'id'), '']];
    }

    /**
     * A figure per column from amounts keyed by column key ('' = untagged).
     *
     * @param  list<string>  $keys
     * @param  array<string, int>  $byKey
     * @return list<array{amount: int, currency: string}>
     */
    public static function cells(array $keys, array $byKey, string $currency): array
    {
        return array_map(fn (string $k): array => Json::money($byKey[$k] ?? 0, $currency), $keys);
    }
}
