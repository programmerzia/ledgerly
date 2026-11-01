<?php

declare(strict_types=1);

namespace App\Http\Support;

use DateTimeInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * Keyset pagination (13 §16): `?limit=` (default 50, max 200) and an opaque `?cursor=`, answered as
 * `{data, meta: {next_cursor, prev_cursor, limit}}`. Rows are ordered by one sort column (a unique
 * tiebreak on `id` is added) so a cursor stays valid while rows are inserted. A sort column that holds
 * dates is serialised as YYYY-MM-DD and must be declared with `$kind = 'date'` (else 'text' or 'uuid'). A malformed cursor or limit is a 422.
 */
final readonly class CursorPage
{
    public const int DEFAULT_LIMIT = 50;

    public const int MAX_LIMIT = 200;

    /** @param  Collection<int, Model>  $items */
    private function __construct(public Collection $items, public ?string $nextCursor, public ?string $prevCursor, public int $limit) {}

    /** @param  Builder<covariant Model>  $query */
    public static function fetch(Builder $query, Request $request, string $column = 'id', bool $descending = false, string $kind = 'text'): self
    {
        $limit = self::limit($request);
        $cursor = self::decode($request->query('cursor'), $kind);
        $backwards = $cursor !== null && $cursor['d'] === 'p';
        // Walking backwards reads the opposite order and flips the page afterwards.
        $desc = $descending !== $backwards;
        $dir = $desc ? 'desc' : 'asc';

        if ($cursor !== null) {
            $query->whereRowValues([$column, 'id'], $desc ? '<' : '>', [$cursor['k'][0], $cursor['k'][1]]);
        }
        $query->orderBy($column, $dir)->orderBy('id', $dir);

        /** @var Collection<int, Model> $rows */
        $rows = $query->limit($limit + 1)->get();
        $more = $rows->count() > $limit;
        $items = $rows->take($limit)->values();
        if ($backwards) {
            $items = $items->reverse()->values();
        }

        $first = $items->first();
        $last = $items->last();
        // Forwards: more rows means a next page; a cursor means we came from a previous one. Backwards: the mirror.
        $hasNext = $backwards || $more;
        $hasPrev = $backwards ? $more : $cursor !== null;

        return new self(
            $items,
            $hasNext && $last !== null ? self::encode('n', $last, $column) : null,
            $hasPrev && $first !== null ? self::encode('p', $first, $column) : null,
            $limit,
        );
    }

    private static function limit(Request $request): int
    {
        $raw = $request->query('limit');
        if ($raw === null || $raw === '') {
            return self::DEFAULT_LIMIT;
        }
        if (! is_string($raw) || preg_match('/^\d+$/', $raw) !== 1 || (int) $raw < 1 || (int) $raw > self::MAX_LIMIT) {
            throw ValidationException::withMessages(['limit' => ['The limit must be a whole number from 1 to '.self::MAX_LIMIT.'.']]);
        }

        return (int) $raw;
    }

    private static function encode(string $direction, Model $row, string $column): string
    {
        $value = $row->getAttribute($column);
        if ($value instanceof DateTimeInterface) {
            $value = $value->format('Y-m-d');
        }
        $json = json_encode(['d' => $direction, 'k' => [(string) $value, (string) $row->getKey()]], JSON_THROW_ON_ERROR);

        return rtrim(strtr(base64_encode($json), '+/', '-_'), '=');
    }

    /** @return array{d: string, k: array{string, string}}|null */
    private static function decode(mixed $raw, string $kind): ?array
    {
        if ($raw === null || $raw === '') {
            return null;
        }
        $invalid = ValidationException::withMessages(['cursor' => ['The cursor is not valid.']]);
        if (! is_string($raw)) {
            throw $invalid;
        }
        $json = base64_decode(strtr($raw, '-_', '+/'), true);
        $data = $json === false ? null : json_decode($json, true);
        if (! is_array($data) || ! in_array($data['d'] ?? null, ['n', 'p'], true)
            || ! is_array($data['k'] ?? null) || count($data['k']) !== 2
            || ! is_string($data['k'][0] ?? null) || ! is_string($data['k'][1] ?? null)
            || preg_match('/^[0-9a-f-]{36}$/', $data['k'][1]) !== 1) {
            throw $invalid;
        }

        $sort = $data['k'][0];
        $sortOk = match ($kind) {
            'date' => preg_match('/^\d{4}-\d{2}-\d{2}$/', $sort) === 1 && \DateTimeImmutable::createFromFormat('!Y-m-d', $sort) !== false
                && \DateTimeImmutable::createFromFormat('!Y-m-d', $sort)->format('Y-m-d') === $sort,
            'uuid' => preg_match('/^[0-9a-f-]{36}$/', $sort) === 1,
            default => $sort !== '' && strlen($sort) <= 255 && mb_check_encoding($sort, 'UTF-8') && ! str_contains($sort, "\0"),
        };
        if (! $sortOk) {
            throw $invalid;
        }

        return ['d' => $data['d'], 'k' => [$sort, $data['k'][1]]];
    }
}
