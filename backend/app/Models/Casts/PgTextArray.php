<?php

declare(strict_types=1);

namespace App\Models\Casts;

use Illuminate\Contracts\Database\Eloquent\CastsAttributes;
use Illuminate\Database\Eloquent\Model;
use InvalidArgumentException;

/**
 * PostgreSQL text[] column ⇄ list<string>, for simple values only (no commas, quotes, braces or spaces),
 * such as event type names. Anything else is refused rather than escaped.
 *
 * @implements CastsAttributes<list<string>|null, list<string>|null>
 */
final class PgTextArray implements CastsAttributes
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
        foreach ($value as $item) {
            if (preg_match('/^[A-Za-z0-9_.*-]+$/', $item) !== 1) {
                throw new InvalidArgumentException('Unsupported text[] element.');
            }
        }

        return '{'.implode(',', $value).'}';
    }
}
