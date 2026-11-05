<?php

declare(strict_types=1);

namespace App\Actions\Documents\Inputs;

/** What a person chose on the send dialog; `subject` and `body` null mean the company's template. */
final readonly class SendDocumentInput
{
    /**
     * @param  list<string>  $recipients
     * @param  array<string, string>  $parameters  statement: from, to, side
     */
    public function __construct(
        public string $companyId,
        public array $recipients,
        public ?string $subject = null,
        public ?string $body = null,
        public array $parameters = [],
    ) {}
}
