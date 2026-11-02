<?php

declare(strict_types=1);

namespace App\Services\Imports;

/** A target field of an import kind: what the mapping can point a column at. */
final readonly class FieldSpec
{
    /** @param list<string> $synonyms lower-case header names that suggest this field */
    public function __construct(
        public string $key,
        public string $label,
        public bool $required = false,
        public array $synonyms = [],
        public ?string $note = null,
    ) {}

    /** @return array{key: string, label: string, required: bool, note: string|null} */
    public function toArray(): array
    {
        return ['key' => $this->key, 'label' => $this->label, 'required' => $this->required, 'note' => $this->note];
    }
}
