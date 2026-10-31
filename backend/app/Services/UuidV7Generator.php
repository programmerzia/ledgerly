<?php

declare(strict_types=1);

namespace App\Services;

use App\Contracts\IdGenerator;
use Illuminate\Support\Str;

final class UuidV7Generator implements IdGenerator
{
    public function next(): string
    {
        return (string) Str::uuid7();
    }
}
