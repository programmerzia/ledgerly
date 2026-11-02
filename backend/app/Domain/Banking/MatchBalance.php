<?php

declare(strict_types=1);

namespace App\Domain\Banking;

use App\Domain\Shared\DomainRuleViolation;

/** A match pairs statement lines with book lines; the two sides must add up to exactly the same amount (many-to-one and one-to-many included). */
final class MatchBalance
{
    /**
     * @param  list<int>  $statementAmounts  signed
     * @param  list<int>  $bookAmounts  signed
     */
    public static function assertEqual(array $statementAmounts, array $bookAmounts): int
    {
        if ($statementAmounts === [] || $bookAmounts === []) {
            throw DomainRuleViolation::single('match_empty', 'A match needs at least one statement line and one book line.');
        }
        $s = array_sum($statementAmounts);
        $b = array_sum($bookAmounts);
        if ($s !== $b) {
            throw DomainRuleViolation::single('match_amount_mismatch', "The statement side adds up to {$s} and the book side to {$b}; they must be equal.");
        }

        return $s;
    }
}
