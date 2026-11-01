<?php

declare(strict_types=1);

namespace App\Services\Trade;

use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalDraft;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\ProposedJournal;
use DateTimeImmutable;

/**
 * Maps a Domain\Trade journal to the posting engine's draft. The domain draws residue lines in the document currency
 * with no foreign amount; here they become base lines (D12). Dimension keys `dim<position>` become slots.
 */
final class DraftMapper
{
    public function toDraft(string $companyId, ProposedJournal $proposed, string $base): JournalDraft
    {
        $lines = [];
        $fcSum = 0;
        foreach ($proposed->lines as $l) {
            $dims = [];
            foreach ($l->dimensions as $key => $valueId) {
                $dims[(int) substr($key, 3)] = $valueId;
            }
            $foreign = $l->currency !== $base && $l->amountFc !== 0;
            if ($foreign) {
                $fcSum += $l->amountFc;
            }
            $lines[] = new DraftLine(
                accountId: $l->accountRef, debit: $l->debit, credit: $l->credit,
                currency: $foreign ? $l->currency : null, fxRate: $foreign ? $l->fxRate : null, amountFc: $foreign ? $l->amountFc : null,
                dims: $dims, description: $l->description, contactId: $l->contactRef, taxCodeId: $l->taxCodeRef,
            );
        }
        if ($fcSum !== 0) {
            throw DomainRuleViolation::single('document_totals_inconsistent', "The foreign-currency amounts do not balance (difference {$fcSum}).");
        }

        return new JournalDraft(
            $companyId, $proposed->journalType, new DateTimeImmutable($proposed->journalDate), $lines,
            $proposed->reference, $proposed->memo, $proposed->sourceType, $proposed->sourceId,
        );
    }
}
