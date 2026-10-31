<?php

declare(strict_types=1);

namespace App\Contracts;

/** Generates primary keys (UUIDv7 strings, 13 §8). */
interface IdGenerator
{
    public function next(): string;
}
