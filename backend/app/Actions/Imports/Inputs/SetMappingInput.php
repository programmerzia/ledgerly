<?php

declare(strict_types=1);

namespace App\Actions\Imports\Inputs;

final readonly class SetMappingInput
{
    /**
     * @param  array<string, string>  $columns  field → header
     * @param  array<string, string>  $defaults  field → constant for rows whose cell is empty
     * @param  array<string, mixed>|null  $options  null keeps the current options
     */
    public function __construct(public array $columns, public array $defaults = [], public ?array $options = null) {}
}
