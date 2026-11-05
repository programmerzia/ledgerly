<?php

declare(strict_types=1);

namespace App\Services\Documents;

use App\Models\BaseModel;
use App\Models\Trade\Contact;

/**
 * A document that can be emailed, resolved to what the mail needs: the template family, the contact, the PDF type and the
 * values the placeholders stand for.
 */
final readonly class EmailTarget
{
    /**
     * @param  array<string, string>  $parameters  statement period and side
     * @param  array<string, string>  $values  placeholder name → text
     */
    public function __construct(
        public string $family,
        public string $pdfType,
        public BaseModel $document,
        public Contact $contact,
        public array $parameters,
        public array $values,
    ) {}
}
