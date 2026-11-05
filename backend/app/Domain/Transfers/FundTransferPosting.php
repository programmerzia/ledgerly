<?php

declare(strict_types=1);

namespace App\Domain\Transfers;

use App\Domain\Ledger\JournalType;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\PostingSupport;
use App\Domain\Trade\ProposedJournal;
use App\Domain\Trade\ProposedLine;

/**
 * Fund transfer to its two journals (13 §23 D15 item 3, IAS 21). Pure: account references and figures in, lines out.
 *
 * Send leg:    Dr funds in transit (send base)  [+ Dr fee expense]   Cr source account (send base + fee), in the source currency.
 * Receive leg: Dr destination (received base)   Cr funds in transit (send base), and the difference between the two bases
 *              to realised FX: a gain (more base received than sent) is a credit, a loss a debit.
 * Each leg converts at its own rate, once, HALF_UP (D1). The fee's base is what is left of the source credit after the
 * transit amount, so the send leg balances exactly with no rounding line.
 */
final class FundTransferPosting
{
    /** @return array{sendBase: int, creditBase: int, feeBase: int} */
    public static function sendAmounts(int $fromAmountFc, int $feeFc, string $sendRate): array
    {
        $sendBase = PostingSupport::toBase($fromAmountFc, $sendRate);
        $creditBase = PostingSupport::toBase($fromAmountFc + $feeFc, $sendRate);
        if ($sendBase <= 0) {
            throw DomainRuleViolation::single('amount_out_of_range', 'The transfer is too small in the base currency.');
        }

        return ['sendBase' => $sendBase, 'creditBase' => $creditBase, 'feeBase' => $creditBase - $sendBase];
    }

    public static function send(FundTransferFigures $t, string $baseCurrency): ProposedJournal
    {
        ['sendBase' => $sendBase, 'creditBase' => $creditBase, 'feeBase' => $feeBase] = self::sendAmounts($t->fromAmountFc, $t->feeFc, $t->sendRate);
        $foreign = $t->fromCurrency !== $baseCurrency;

        $lines = [new ProposedLine($t->inTransitRef, $sendBase, 0, $baseCurrency, '1', $sendBase, [], "Funds in transit: {$t->number}")];
        if ($t->feeFc > 0) {
            $lines[] = new ProposedLine($t->feeAccountRef ?? '', $feeBase, 0, $baseCurrency, '1', $feeBase, [], "Transfer fee: {$t->number}");
        }
        $lines[] = new ProposedLine(
            $t->fromAccountRef, 0, $creditBase, $t->fromCurrency, $foreign ? $t->sendRate : '1',
            $foreign ? -($t->fromAmountFc + $t->feeFc) : -$creditBase, [], "Transfer {$t->number} to {$t->toName}",
        );

        return new ProposedJournal(
            JournalType::Bank, $t->sendDate, $t->number, PostingSupport::orDefault($t->memo, "Fund transfer {$t->number}: sent"),
            'fund_transfer', $t->id, $lines,
        );
    }

    /** @return array{receiveBase: int, difference: int} difference is signed: positive is a gain */
    public static function receiveAmounts(int $toAmountFc, string $receiveRate, int $sendBase): array
    {
        $receiveBase = PostingSupport::toBase($toAmountFc, $receiveRate);
        if ($receiveBase <= 0) {
            throw DomainRuleViolation::single('amount_out_of_range', 'The amount received is too small in the base currency.');
        }

        return ['receiveBase' => $receiveBase, 'difference' => $receiveBase - $sendBase];
    }

    public static function receive(FundTransferFigures $t, string $baseCurrency, string $receiveDate): ProposedJournal
    {
        $sendBase = self::sendAmounts($t->fromAmountFc, $t->feeFc, $t->sendRate)['sendBase'];
        ['receiveBase' => $receiveBase, 'difference' => $diff] = self::receiveAmounts($t->toAmountFc, $t->receiveRate, $sendBase);
        $foreign = $t->toCurrency !== $baseCurrency;

        $lines = [new ProposedLine(
            $t->toAccountRef, $receiveBase, 0, $t->toCurrency, $foreign ? $t->receiveRate : '1',
            $foreign ? $t->toAmountFc : $receiveBase, [], "Transfer {$t->number} from {$t->fromName}",
        )];
        if ($diff < 0) {
            $lines[] = new ProposedLine($t->fxLossRef, -$diff, 0, $baseCurrency, '1', -$diff, [], "Realised FX loss: {$t->number}");
        }
        $lines[] = new ProposedLine($t->inTransitRef, 0, $sendBase, $baseCurrency, '1', -$sendBase, [], "Funds in transit cleared: {$t->number}");
        if ($diff > 0) {
            $lines[] = new ProposedLine($t->fxGainRef, 0, $diff, $baseCurrency, '1', -$diff, [], "Realised FX gain: {$t->number}");
        }

        return new ProposedJournal(
            JournalType::Bank, $receiveDate, $t->number, PostingSupport::orDefault($t->memo, "Fund transfer {$t->number}: received"),
            'fund_transfer', $t->id, $lines,
        );
    }
}
