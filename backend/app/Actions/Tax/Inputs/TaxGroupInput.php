<?php

declare(strict_types=1);

namespace App\Actions\Tax\Inputs;

final readonly class TaxGroupInput
{
    /** @param  list<array{tax_code_id: string, compound: bool}>  $items  in sequence */
    public function __construct(public string $companyId, public string $code, public string $name, public array $items) {}
}
