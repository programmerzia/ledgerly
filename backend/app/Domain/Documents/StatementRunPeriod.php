<?php

declare(strict_types=1);

namespace App\Domain\Documents;

use App\Domain\Shared\DomainRuleViolation;
use DateTimeImmutable;

/**
 * The dates a statement run covers (plan 3c.7a). A run is either "as of a date" or an explicit period. As of a date means the
 * statement of the three calendar months that end on that date (the month of the date and the two before it), closing on the date,
 * so the balance on the statement is the balance as of the date and the lines explain the recent movement.
 */
final readonly class StatementRunPeriod
{
    private function __construct(public string $from, public string $to, public string $basis) {}

    public static function asOf(string $asOf): self
    {
        $date = self::parse($asOf);

        return new self($date->modify('first day of this month')->modify('-2 months')->format('Y-m-d'), $date->format('Y-m-d'), 'as_of');
    }

    public static function period(string $from, string $to): self
    {
        $a = self::parse($from);
        $b = self::parse($to);
        if ($b < $a) {
            throw DomainRuleViolation::single('statement_period_invalid', 'The end of the period must not be before its start.');
        }

        return new self($a->format('Y-m-d'), $b->format('Y-m-d'), 'period');
    }

    private static function parse(string $date): DateTimeImmutable
    {
        $parsed = DateTimeImmutable::createFromFormat('!Y-m-d', $date);

        return $parsed !== false && $parsed->format('Y-m-d') === $date ? $parsed : throw DomainRuleViolation::single('statement_period_invalid', 'Give dates as YYYY-MM-DD.');
    }
}
