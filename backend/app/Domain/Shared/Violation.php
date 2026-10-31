<?php

declare(strict_types=1);

namespace App\Domain\Shared;

/** One broken rule, with a stable machine code (13 §16 `violations[]`). */
final readonly class Violation
{
    public function __construct(
        public string $code,
        public string $message,
        public ?int $lineNo = null,
    ) {}

    /** @return array{code: string, message: string, line_no?: int} */
    public function toArray(): array
    {
        return array_filter(
            ['code' => $this->code, 'message' => $this->message, 'line_no' => $this->lineNo],
            fn ($v) => $v !== null,
        );
    }
}
