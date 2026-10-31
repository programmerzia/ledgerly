<?php

declare(strict_types=1);

namespace App\Support\Database;

use Illuminate\Database\Connection;
use RuntimeException;

/** Runs a reviewed SQL file from database/sql (functions, triggers, views; 13 §2). */
final class SqlFile
{
    public static function run(Connection $connection, string $name): void
    {
        $path = database_path('sql/'.$name);
        $sql = file_get_contents($path);
        if ($sql === false) {
            throw new RuntimeException("Cannot read {$path}");
        }
        $connection->getPdo()->exec($sql);
    }
}
