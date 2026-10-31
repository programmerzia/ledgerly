<?php

declare(strict_types=1);

namespace App\Models\Casts;

use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;

/**
 * PostgreSQL uuid[] column ⇄ list<string>. Postgres returns '{a,b}' and accepts the same literal.
 *
 * @implements CastsAttributes<list<string>|null, list<string>|null>
 */
final class PgUuidArray implements CastsAttributes
{
    public function get(Model $model, string $key, mixed $value, array $attributes): ?array
    {
        if (! is_string($value)) {
            return null;
        }
        $inner = trim($value, '{}');

        return $inner === '' ? [] : explode(',', $inner);
    }

    public function set(Model $model, string $key, mixed $value, array $attributes): ?string
    {
        if ($value === null) {
            return null;
        }
        /** @var list<string> $value */

        return '{'.implode(',', $value).'}';
    }
}
