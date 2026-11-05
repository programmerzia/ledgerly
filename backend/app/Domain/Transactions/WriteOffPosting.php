<?php

declare(strict_types=1);

namespace App\Domain\Transactions;

use App\Domain\Ledger\JournalType;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\ProposedJournal;
use App\Domain\Trade\ProposedLine;

/**
 * Write-off to journal (IFRS 9, D15 item 2): Dr credit-loss allowance up to the balance available, Dr bad-debt expense for the
 * rest, Cr receivable control with the contact at the invoice's carrying amount. VAT is not touched. Pure.
 */
final class WriteOffPosting
{
    /** @return array{allowance: int, expense: int} how the base amount splits; the allowance never goes below zero */
    public static function split(int $carriedBase, int $allowanceAvailable): array
    {
        if ($carriedBase <= 0) {
            throw DomainRuleViolation::single('amount_out_of_range', 'The write-off must be more than zero in the base currency.');
        }
        $allowance = max(0, min($carriedBase, $allowanceAvailable));

        return ['allowance' => $allowance, 'expense' => $carriedBase - $allowance];
    }

    public static function journal(
        string $id, string $number, string $date, string $invoiceNumber, string $contactId, string $arControl, string $allowanceRef, string $expenseRef,
        string $currency, string $invoiceRate, int $amountFc, int $carriedBase, int $allowanceAvailable, string $baseCurrency, string $reason,
    ): ProposedJournal {
        ['allowance' => $allowance, 'expense' => $expense] = self::split($carriedBase, $allowanceAvailable);
        $lines = [];
        if ($allowance > 0) {
            $lines[] = new ProposedLine($allowanceRef, $allowance, 0, $baseCurrency, '1', $allowance, [], "Allowance used: write-off of {$invoiceNumber}");
        }
        if ($expense > 0) {
            $lines[] = new ProposedLine($expenseRef, $expense, 0, $baseCurrency, '1', $expense, [], "Bad debt expense: write-off of {$invoiceNumber}");
        }
        $foreign = $currency !== $baseCurrency;
        $lines[] = new ProposedLine(
            $arControl, 0, $carriedBase, $currency, $foreign ? $invoiceRate : '1', $foreign ? -$amountFc : -$carriedBase, [],
            "Write-off of {$invoiceNumber}", $contactId,
        );

        return new ProposedJournal(JournalType::Sales, $date, $number, "Write-off {$number} of {$invoiceNumber}: {$reason}", 'write_off', $id, $lines);
    }
}
