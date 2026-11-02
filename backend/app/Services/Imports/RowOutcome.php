<?php

declare(strict_types=1);

namespace App\Services\Imports;

/** What checking one row (or one group of rows) found: errors by field, and the prepared Action input when there are none. */
final class RowOutcome
{
    /** @param list<array{field: string|null, code: string, message: string}> $errors */
    public function __construct(public array $errors = [], public mixed $prepared = null) {}

    public function ok(): bool
    {
        return $this->errors === [];
    }

    public function add(?string $field, string $code, string $message): void
    {
        $this->errors[] = ['field' => $field, 'code' => $code, 'message' => $message];
    }
}
