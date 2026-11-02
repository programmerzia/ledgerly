<?php

declare(strict_types=1);

namespace App\Domain\Banking;

use RuntimeException;

/** A statement file that cannot be read. `errors` carry the line (or record) number where there is one. */
final class StatementFormatException extends RuntimeException
{
    /** @param list<array{line: int|null, code: string, message: string}> $errors */
    public function __construct(public readonly string $errorCode, string $message, public readonly array $errors = [])
    {
        parent::__construct($message);
    }

    public static function at(?int $line, string $code, string $message): self
    {
        return new self($code, $line === null ? $message : "Line {$line}: {$message}", [['line' => $line, 'code' => $code, 'message' => $message]]);
    }

    /** @param list<array{line: int|null, code: string, message: string}> $errors */
    public static function many(array $errors): self
    {
        $first = $errors[0];

        return new self('statement_malformed', ($first['line'] === null ? '' : "Line {$first['line']}: ").$first['message'].(count($errors) > 1 ? ' (and '.(count($errors) - 1).' more)' : ''), $errors);
    }
}
