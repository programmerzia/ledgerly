<?php

declare(strict_types=1);

namespace App\Services\Banking;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Banking\LineHash;
use App\Domain\Banking\ParsedLine;
use App\Domain\Banking\ParsedStatement;
use App\Domain\Banking\StatementFormatException;
use App\Domain\Banking\StatementParsers;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Banking\BankAccount;
use App\Models\Banking\BankStatement;
use App\Support\Actor;
use Illuminate\Database\DatabaseManager;

/** Parses a statement file and stores what is new: one statement, its lines, idempotent by line hash (the caller holds the account lock). */
final class StatementImporter
{
    public function __construct(
        private readonly StatementParsers $parsers,
        private readonly IdGenerator $ids,
        private readonly Clock $clock,
        private readonly DatabaseManager $db,
    ) {}

    /**
     * @param  array<string, mixed>  $mapping  CSV mapping (the request's, else the account's saved one)
     * @return array{statement: BankStatement|null, inserted: int, skipped: int, warnings: list<string>, already_imported: bool}
     */
    public function import(Actor $actor, BankAccount $account, string $content, ?string $fileName, string $format, array $mapping, ?int $openingOverride, ?int $closingOverride): array
    {
        $conn = $this->db->connection();
        $hash = hash('sha256', $content);
        $same = BankStatement::query()->where('bank_account_id', $account->id)->where('file_hash', $hash)->first();
        if ($same !== null) {
            return ['statement' => $same, 'inserted' => 0, 'skipped' => $same->line_count + $same->duplicates_skipped, 'warnings' => $same->warnings, 'already_imported' => true];
        }

        $scale = (int) ($conn->table('currencies')->where('code', $account->currency)->value('minor_unit') ?? 2);
        if ($format === 'csv' || ($format === 'auto' && StatementParsers::sniff($content) === 'csv')) {
            $mapping = $mapping !== [] ? $mapping : ($account->import_mapping ?? []);
            if ($mapping === []) {
                throw StatementFormatException::at(null, 'mapping_required', 'A CSV statement needs a column mapping (none is saved for this account).');
            }
        }
        $parsed = $this->parsers->parse($content, $format, $mapping, $scale);
        if ($parsed->currency !== null && $parsed->currency !== $account->currency) {
            throw DomainRuleViolation::single('statement_currency_mismatch', "The file is in {$parsed->currency}, the account in {$account->currency}.");
        }

        $opening = $openingOverride ?? $parsed->openingBalance;
        $closing = $closingOverride ?? $parsed->closingBalance;
        $warnings = $parsed->warnings;
        if ($opening === null && $closing !== null) {
            // Not in the file: the previous statement's closing balance is this one's opening.
            $previous = BankStatement::query()->where('bank_account_id', $account->id)->whereNotNull('closing_balance')
                ->where('period_to', '<', $parsed->periodFrom)->orderByDesc('period_to')->first();
            if ($previous !== null) {
                $opening = $previous->closing_balance;
                $warnings[] = 'opening_balance_from_previous_statement';
            }
        }
        $check = new ParsedStatement($parsed->format, $parsed->lines, $opening, $closing, $parsed->periodFrom, $parsed->periodTo, $parsed->currency, $parsed->accountId, []);
        $warnings = array_values(array_unique([...$warnings, ...StatementParsers::balanceWarnings($check)]));

        $hashes = LineHash::all($account->id, $parsed->lines);
        $existing = array_flip($conn->table('bank_statement_lines')->where('bank_account_id', $account->id)->whereIn('dedupe_hash', $hashes)->pluck('dedupe_hash')->all());
        $fresh = [];
        foreach ($parsed->lines as $i => $line) {
            if (! isset($existing[$hashes[$i]])) {
                $fresh[] = [$line, $hashes[$i]];
            }
        }
        $skipped = count($parsed->lines) - count($fresh);
        if ($fresh === []) {
            return ['statement' => null, 'inserted' => 0, 'skipped' => $skipped, 'warnings' => $warnings, 'already_imported' => false];
        }

        $now = $this->clock->now();
        $stamp = $now->format('Y-m-d H:i:s.uP');
        $statement = new BankStatement;
        $statement->forceFill([
            'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $account->company_id, 'bank_account_id' => $account->id,
            'period_from' => $parsed->periodFrom, 'period_to' => $parsed->periodTo, 'opening_balance' => $opening, 'closing_balance' => $closing,
            'currency' => $account->currency, 'source' => $parsed->format, 'file_name' => $fileName === null ? null : mb_substr($fileName, 0, 255),
            'file_hash' => $hash, 'line_count' => count($fresh), 'duplicates_skipped' => $skipped, 'warnings' => $warnings,
            'imported_by' => $actor->id, 'imported_at' => $now,
        ])->save();

        $rows = [];
        foreach ($fresh as $n => [$line, $lineHash]) {
            /** @var ParsedLine $line */
            $rows[] = [
                'id' => $this->ids->next(), 'tenant_id' => $actor->tenantId, 'company_id' => $account->company_id, 'statement_id' => $statement->id,
                'bank_account_id' => $account->id, 'line_no' => $n + 1, 'txn_date' => $line->txnDate, 'value_date' => $line->valueDate,
                'amount' => $line->amount, 'currency' => $account->currency, 'description' => $line->description,
                'reference' => $line->reference === null ? null : mb_substr($line->reference, 0, 255),
                'counterparty' => $line->counterparty === null ? null : mb_substr($line->counterparty, 0, 255), 'balance_after' => $line->balanceAfter,
                'dedupe_hash' => $lineHash, 'status' => 'unmatched', 'lock_version' => 0, 'created_at' => $stamp, 'updated_at' => $stamp,
            ];
        }
        $inserted = 0;
        foreach (array_chunk($rows, 500) as $chunk) {
            $inserted += $conn->table('bank_statement_lines')->insertOrIgnore($chunk);
        }

        if ($closing !== null && ($account->last_statement_date === null || $parsed->periodTo >= $account->last_statement_date->format('Y-m-d'))) {
            $account->forceFill(['last_statement_balance' => $closing, 'last_statement_date' => $parsed->periodTo])->save();
        }

        return ['statement' => $statement, 'inserted' => $inserted, 'skipped' => $skipped + (count($fresh) - $inserted), 'warnings' => $warnings, 'already_imported' => false];
    }
}
