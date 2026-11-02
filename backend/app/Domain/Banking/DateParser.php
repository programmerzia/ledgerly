<?php

declare(strict_types=1);

namespace App\Domain\Banking;

use DateTimeImmutable;

/** Dates in a declared format only; an impossible date (31 Feb) is an error, never rolled over. */
final class DateParser
{
    /** Accepted formats, as the user declares them. */
    public const array FORMATS = ['Y-m-d', 'd/m/Y', 'm/d/Y', 'd.m.Y', 'd-m-Y', 'Ymd', 'd/m/y', 'm/d/y'];

    public static function parse(string $raw, string $format): string
    {
        $raw = trim($raw);
        $d = DateTimeImmutable::createFromFormat('!'.$format, $raw);
        $errors = DateTimeImmutable::getLastErrors();
        if ($d === false || ($errors !== false && ($errors['warning_count'] > 0 || $errors['error_count'] > 0))) {
            throw new \InvalidArgumentException("'{$raw}' is not a date in the format {$format}.");
        }
        $year = (int) $d->format('Y');
        if ($year < 1990 || $year > 2100) {
            throw new \InvalidArgumentException("'{$raw}' is outside the supported date range.");
        }

        return $d->format('Y-m-d');
    }
}
