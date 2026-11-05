<?php

declare(strict_types=1);

namespace App\Services\FixedAssets;

use App\Domain\Ledger\ControlType;
use App\Domain\Ledger\JournalStatus;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\InvoiceKind;
use App\Domain\Trade\PostingSupport;
use App\Domain\Workflow\DocumentStatus;
use App\Models\FixedAssets\FixedAsset;
use App\Models\Ledger\Account;
use App\Models\Ledger\Journal;
use App\Models\Ledger\JournalLine;
use App\Models\Trade\Invoice;
use App\Models\Trade\InvoiceLine;

/**
 * Finds the posted line an asset is capitalised from and the facts the register takes from it. Capitalising posts
 * nothing: the bill or journal already put the cost on the fixed asset account.
 */
final class CapitalisationSource
{
    /**
     * @return array{account_id: string, amount: int, date: string, journal_id: string|null, dims: array<int, string|null>, label: string}
     */
    public function resolve(string $companyId, string $type, string $id): array
    {
        $source = match ($type) {
            'bill_line' => $this->billLine($companyId, $id),
            'journal_line' => $this->journalLine($companyId, $id),
            default => throw DomainRuleViolation::single('asset_source_invalid', 'Capitalise from a bill_line or a journal_line.'),
        };
        $account = Account::query()->findOrFail($source['account_id']);
        if ($account->control_type !== ControlType::FixedAsset) {
            throw DomainRuleViolation::single('asset_source_not_fixed_asset', "That line is on {$account->code} {$account->name}, which is not a fixed asset account.");
        }
        if ($source['amount'] <= 0) {
            throw DomainRuleViolation::single('asset_source_not_debit', 'Only a debit line adds to the cost of an asset.');
        }
        if (FixedAsset::query()->where('company_id', $companyId)->where('source_type', $type)->where('source_id', $id)->exists()) {
            throw DomainRuleViolation::single('asset_already_capitalised', 'That line is already capitalised as an asset.');
        }

        return $source;
    }

    /** @return array{account_id: string, amount: int, date: string, journal_id: string|null, dims: array<int, string|null>, label: string} */
    private function billLine(string $companyId, string $id): array
    {
        $line = InvoiceLine::query()->where('company_id', $companyId)->find($id)
            ?? throw DomainRuleViolation::single('not_found', 'The bill line does not exist.');
        $bill = Invoice::query()->findOrFail($line->invoice_id);
        if ($bill->kind !== InvoiceKind::PurchaseBill) {
            throw DomainRuleViolation::single('asset_source_invalid', 'Only a line of a purchase bill can be capitalised.');
        }
        if ($bill->status !== DocumentStatus::Posted) {
            throw DomainRuleViolation::single('asset_source_not_posted', 'The bill is not posted (or has been reversed), so its line cannot be capitalised.');
        }

        return [
            'account_id' => $line->account_id,
            // Net of discount, before tax, at the bill's rate and rounded as the posting rule does; any tax that was not recoverable is not included.
            'amount' => PostingSupport::toBase($line->line_total_fc, (string) $bill->fx_rate),
            'date' => $bill->issue_date->format('Y-m-d'),
            'journal_id' => $bill->journal_id,
            'dims' => $this->dims($line),
            'label' => "{$bill->number} line {$line->line_no}",
        ];
    }

    /** @return array{account_id: string, amount: int, date: string, journal_id: string|null, dims: array<int, string|null>, label: string} */
    private function journalLine(string $companyId, string $id): array
    {
        $line = JournalLine::query()->where('company_id', $companyId)->find($id)
            ?? throw DomainRuleViolation::single('not_found', 'The journal line does not exist.');
        $journal = Journal::query()->findOrFail($line->journal_id);
        if ($journal->status !== JournalStatus::Posted) {
            throw DomainRuleViolation::single('asset_source_not_posted', 'The journal is not posted (or has been reversed), so its line cannot be capitalised.');
        }

        return [
            'account_id' => $line->account_id,
            'amount' => $line->debit,
            'date' => $journal->journal_date->format('Y-m-d'),
            'journal_id' => $journal->id,
            'dims' => $this->dims($line),
            'label' => "{$journal->number} line {$line->line_no}",
        ];
    }

    /** @return array<int, string|null> */
    private function dims(InvoiceLine|JournalLine $line): array
    {
        $dims = [];
        for ($p = 1; $p <= 8; $p++) {
            $v = $line->getAttribute("dim{$p}_value_id");
            $dims[$p] = is_string($v) ? $v : null;
        }

        return $dims;
    }
}
