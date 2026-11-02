<?php

declare(strict_types=1);

namespace App\Services\Imports\Kinds;

use App\Actions\Banking\ImportBankStatement;
use App\Actions\Banking\Inputs\ImportStatementInput;
use App\Domain\Banking\AmountParser;
use App\Domain\Banking\DateParser;
use App\Domain\Banking\StatementFormatException;
use App\Domain\Banking\StatementParsers;
use App\Models\Banking\BankAccount;
use App\Models\Organisation\Company;
use App\Services\Imports\FieldSpec;
use App\Services\Imports\ImportContext;
use App\Services\Imports\ImportKind;
use App\Services\Imports\ImportRunner;
use App\Services\Imports\PreparedSet;
use App\Services\Imports\RowOutcome;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use Illuminate\Validation\Rule;
use InvalidArgumentException;

/**
 * Bank statement lines for one bank account (`options.bank_account_id`), applied by the banking importer. Each row is read here with the
 * same exact parsers (`DateParser`, `AmountParser`), rewritten as a canonical CSV and run through the CSV statement parser, so a row
 * the importer would refuse is refused in the preview with its row number. At apply the valid rows go to `ImportBankStatement` as one
 * statement; lines already imported (same date, amount, text) are skipped by its own line hash, so importing a file twice adds nothing.
 * `sign`: signed (negative = money out, the default) or inverted (positive = money out, card statements); with debit and credit
 * columns mapped, debit is money out and credit is money in.
 */
final class BankLinesKind extends ImportKind
{
    private const array MAPPING = ['locale' => 'plain', 'date_format' => 'Y-m-d', 'sign' => 'signed', 'columns' => [
        'date' => 'Date', 'value_date' => 'Value date', 'description' => 'Description', 'reference' => 'Reference', 'counterparty' => 'Counterparty', 'amount' => 'Amount',
    ]];

    public function __construct(private readonly ImportBankStatement $statements, private readonly StatementParsers $parsers) {}

    public function key(): string
    {
        return 'bank_lines';
    }

    public function permission(): string
    {
        return 'banking.reconcile';
    }

    public function fields(): array
    {
        return [
            new FieldSpec('date', 'Date', true, ['transaction date', 'posting date', 'booking date']),
            new FieldSpec('description', 'Description', true, ['details', 'narrative', 'memo', 'transaction details', 'particulars']),
            new FieldSpec('amount', 'Amount', false, ['value', 'transaction amount'], 'signed; or map debit and credit instead'),
            new FieldSpec('debit', 'Money out (debit)', false, ['withdrawal', 'withdrawals', 'paid out', 'dr']),
            new FieldSpec('credit', 'Money in (credit)', false, ['deposit', 'deposits', 'paid in', 'cr']),
            new FieldSpec('value_date', 'Value date', false, ['value dt']),
            new FieldSpec('reference', 'Reference', false, ['ref', 'cheque number', 'check number']),
            new FieldSpec('counterparty', 'Counterparty', false, ['payee', 'payer', 'name', 'beneficiary']),
        ];
    }

    public function optionRules(Company $company): array
    {
        return [
            'bank_account_id' => ['required', 'uuid', Rule::exists('bank_accounts', 'id')->where('company_id', $company->id)],
            'sign' => ['nullable', Rule::in(['signed', 'inverted'])],
            'opening_balance' => ['nullable', 'integer'],
            'closing_balance' => ['nullable', 'integer'],
        ];
    }

    /** @param array<string, mixed> $options @return list<string> */
    public function missingOptions(array $options): array
    {
        return isset($options['bank_account_id']) ? [] : ['bank_account_id'];
    }

    public function mappingProblems(array $columns, array $defaults): array
    {
        $has = fn (string $f): bool => isset($columns[$f]) || isset($defaults[$f]);

        return match (true) {
            $has('amount') && ($has('debit') || $has('credit')) => ['Map either the amount column or the debit and credit columns, not both.'],
            ! $has('amount') && ! $has('debit') && ! $has('credit') => ['Map the amount column, or the debit and credit columns.'],
            default => [],
        };
    }

    public function prepare(ImportContext $ctx, array $rows): PreparedSet
    {
        $set = new PreparedSet;
        $account = BankAccount::query()->where('company_id', $ctx->company->id)->find((string) $ctx->option('bank_account_id'));
        if ($account === null || ! $account->is_active) {
            $set->fileErrors[] = ['code' => $account === null ? 'not_found' : 'bank_account_inactive', 'message' => $account === null ? 'The bank account does not exist.' : 'The bank account is inactive.'];

            return $set;
        }

        $lines = $this->lines($ctx, $account, $rows, $set);
        if ($lines === []) {
            return $set;
        }
        // The importer's own CSV parser, over exactly what would be imported.
        try {
            $this->parsers->parse($this->csv($lines, $ctx->scale($account->currency)), 'csv', self::MAPPING, $ctx->scale($account->currency));
        } catch (StatementFormatException $e) {
            $numbers = array_keys($lines);
            foreach ($e->errors as $error) {
                $number = $error['line'] === null ? null : ($numbers[$error['line'] - 2] ?? null);
                if ($number === null) {
                    $set->fileErrors[] = ['code' => $error['code'], 'message' => $error['message']];
                } else {
                    $set->rows[$number]->add(null, $error['code'], $error['message']);
                }
            }
        }
        $in = array_sum(array_filter(array_column($lines, 'amount'), fn (int $a) => $a > 0));
        $out = array_sum(array_filter(array_column($lines, 'amount'), fn (int $a) => $a < 0));
        $set->summary = ['bank_account_id' => $account->id, 'currency' => $account->currency, 'lines' => count($lines), 'money_in' => $in, 'money_out' => $out];

        return $set;
    }

    public function apply(ImportContext $ctx, Actor $actor, ImportRunner $run): void
    {
        $pending = $run->pending();
        if ($pending->isEmpty()) {
            return;
        }
        $account = BankAccount::query()->where('company_id', $ctx->company->id)->find((string) $ctx->option('bank_account_id'));
        $ids = ImportRunner::ids($pending);
        if ($account === null) {
            $run->fail($ids, [['field' => null, 'code' => 'not_found', 'message' => 'The bank account does not exist.']]);

            return;
        }
        $rows = $pending->mapWithKeys(fn ($r) => [$r->row_number => $r->cells])->all();
        $scratch = new PreparedSet;
        $lines = $this->lines($ctx, $account, $rows, $scratch);
        $bad = array_keys(array_filter($scratch->rows, fn (RowOutcome $o) => ! $o->ok()));
        if ($bad !== []) {
            $badIds = ImportRunner::ids($pending->filter(fn ($r) => in_array($r->row_number, $bad, true)));
            $run->fail($badIds, $scratch->rows[$bad[0]]->errors);
            $ids = array_values(array_diff($ids, $badIds));
            $lines = array_diff_key($lines, array_flip($bad));
        }
        if ($ids === [] || $lines === []) {
            return;
        }

        $run->unit($ids, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($ctx, $actor, $account, $lines): array {
            $result = $this->statements->handle($actor, new ImportStatementInput(
                $ctx->company->id, $account->id, $this->csv($lines, $ctx->scale($account->currency)), $ctx->import->source_name, 'csv', self::MAPPING, false,
                $ctx->option('opening_balance') === null ? null : (int) $ctx->option('opening_balance'),
                $ctx->option('closing_balance') === null ? null : (int) $ctx->option('closing_balance'),
            ));

            return [
                'statement_id' => $result['statement']?->id, 'lines_imported' => $result['inserted'], 'duplicate_lines_skipped' => $result['skipped'],
                'already_imported' => $result['already_imported'], 'warnings' => $result['warnings'],
            ];
        });
    }

    /**
     * @param  array<int, array<string, string>>  $rows
     * @return array<int, array{date: string, value_date: string|null, description: string, reference: string|null, counterparty: string|null, amount: int}> valid rows by number
     */
    private function lines(ImportContext $ctx, BankAccount $account, array $rows, PreparedSet $set): array
    {
        $scale = $ctx->scale($account->currency);
        $inverted = $ctx->option('sign', 'signed') === 'inverted';
        $columns = isset($ctx->columns()['debit']) || isset($ctx->columns()['credit']);
        $lines = [];
        foreach ($rows as $number => $cells) {
            $o = $set->rows[$number] = new RowOutcome;
            $date = $valueDate = null;
            try {
                $raw = $ctx->value($cells, 'date');
                $date = $raw === null ? null : DateParser::parse($raw, $ctx->dateFormat());
                if ($date === null) {
                    $o->add('date', 'required', 'The date is empty.');
                }
                $raw = $ctx->value($cells, 'value_date');
                $valueDate = $raw === null ? null : DateParser::parse($raw, $ctx->dateFormat());
            } catch (InvalidArgumentException $e) {
                $o->add('date', 'invalid_date', $e->getMessage());
            }
            $description = $ctx->value($cells, 'description');
            if ($description === null) {
                $o->add('description', 'required', 'The description is empty.');
            }

            $amount = null;
            try {
                if ($columns) {
                    $debit = $ctx->value($cells, 'debit');
                    $credit = $ctx->value($cells, 'credit');
                    if (($debit === null) === ($credit === null)) {
                        $o->add('debit', 'amount_required', 'A line needs either a debit or a credit amount.');
                    } else {
                        $amount = $debit !== null ? -abs(AmountParser::parse($debit, $ctx->locale(), $scale)) : abs(AmountParser::parse((string) $credit, $ctx->locale(), $scale));
                    }
                } else {
                    $raw = $ctx->value($cells, 'amount');
                    if ($raw === null) {
                        $o->add('amount', 'required', 'The amount is empty.');
                    } else {
                        $amount = AmountParser::parse($raw, $ctx->locale(), $scale);
                        $amount = $inverted ? -$amount : $amount;
                    }
                }
                if ($amount === 0) {
                    $o->add('amount', 'amount_zero', 'The amount is zero.');
                }
            } catch (InvalidArgumentException $e) {
                $o->add($columns ? 'debit' : 'amount', 'invalid_amount', $e->getMessage());
            }

            if ($o->ok() && $date !== null && $description !== null && $amount !== null) {
                $lines[$number] = [
                    'date' => $date, 'value_date' => $valueDate, 'description' => $description,
                    'reference' => $ctx->value($cells, 'reference'), 'counterparty' => $ctx->value($cells, 'counterparty'), 'amount' => $amount,
                ];
            }
        }

        return $lines;
    }

    /**
     * The canonical CSV the importer reads: one line per row, in row order, ISO dates and a plain signed decimal amount.
     *
     * @param  array<int, array{date: string, value_date: string|null, description: string, reference: string|null, counterparty: string|null, amount: int}>  $lines
     */
    private function csv(array $lines, int $scale): string
    {
        $out = fopen('php://memory', 'w+');
        assert($out !== false);
        fputcsv($out, ['Date', 'Value date', 'Description', 'Reference', 'Counterparty', 'Amount'], escape: '');
        foreach ($lines as $l) {
            // A newline inside a cell would move the physical line numbers the parser reports.
            $flat = fn (?string $s): string => $s === null ? '' : trim((string) preg_replace('/\s+/', ' ', $s));
            fputcsv($out, [$l['date'], $l['value_date'] ?? '', $flat($l['description']), $flat($l['reference']), $flat($l['counterparty']), $this->decimal($l['amount'], $scale)], escape: '');
        }
        rewind($out);

        return (string) stream_get_contents($out);
    }

    private function decimal(int $minor, int $scale): string
    {
        $abs = (string) abs($minor);
        if ($scale === 0) {
            return ($minor < 0 ? '-' : '').$abs;
        }
        $abs = str_pad($abs, $scale + 1, '0', STR_PAD_LEFT);

        return ($minor < 0 ? '-' : '').substr($abs, 0, -$scale).'.'.substr($abs, -$scale);
    }
}
