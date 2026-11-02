<?php

declare(strict_types=1);

namespace App\Actions\Workflow\Inputs;

/** One document's outcome in a bulk approval: approved (`status` is the document's status afterwards; posted when it was the last step) or skipped with a reason. */
final readonly class BulkApprovalResult
{
    private function __construct(
        public DocumentRef $document,
        public bool $ok,
        public ?string $status = null,
        public ?string $number = null,
        public ?string $code = null,
        public ?string $reason = null,
    ) {}

    public static function approved(DocumentRef $ref, string $status, ?string $number): self
    {
        return new self($ref, true, $status, $number);
    }

    public static function failed(DocumentRef $ref, string $code, string $reason): self
    {
        return new self($ref, false, null, null, $code, $reason);
    }
}
