<?php

declare(strict_types=1);

namespace App\Http\Requests\Ledger;

use App\Actions\Ledger\Inputs\JournalDraftInput;
use App\Actions\Ledger\Inputs\UpdateJournalDraftInput;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalType;
use App\Http\Requests\CompanyRequest;
use App\Models\Ledger\DimensionValue;
use App\Queries\Ledger\DimensionPositions;
use DateTimeImmutable;
use Illuminate\Contracts\Validation\Validator;
use Illuminate\Validation\Rule;

/**
 * Create (POST) or replace (PUT, with `version`) a draft journal. Shape only: ids exist in this company,
 * amounts are whole minor units, a line is a debit or a credit, a foreign-currency line carries its rate and
 * amount. Whether the journal balances, the period is open or dimension rules hold is the posting
 * validator's call (preview / submit), not the form's.
 *
 * Line dimensions are `{"<dimension id>": "<dimension value id>"}`.
 */
final class JournalRequest extends CompanyRequest
{
    private const int MAX_MONEY = 999_999_999_999_999;

    /** @return array<string, mixed> */
    public function rules(): array
    {
        $update = $this->isMethod('PUT');

        return [
            'journal_type' => [$update ? 'prohibited' : 'nullable', 'string', Rule::in([JournalType::Manual->value, JournalType::Adjustment->value])],
            'journal_date' => ['required', 'date_format:Y-m-d'],
            'fiscal_period_id' => ['nullable', 'uuid', $this->inCompany('fiscal_periods')],
            'reference' => ['nullable', 'string', 'max:255'],
            'memo' => ['nullable', 'string', 'max:5000'],
            'version' => [$update ? 'required' : 'prohibited', 'integer', 'min:0'],
            'lines' => ['required', 'array', 'min:1', 'max:500'],
            'lines.*.account_id' => ['required', 'uuid', $this->inCompany('accounts')->whereNull('deleted_at')],
            'lines.*.debit' => ['nullable', 'integer', 'min:0', 'max:'.self::MAX_MONEY],
            'lines.*.credit' => ['nullable', 'integer', 'min:0', 'max:'.self::MAX_MONEY],
            'lines.*.currency' => ['nullable', 'string', 'size:3', Rule::exists('currencies', 'code')],
            'lines.*.fx_rate' => ['nullable', 'string', 'regex:/^\d{1,12}(\.\d{1,8})?$/'],
            'lines.*.amount_fc' => ['nullable', 'integer', 'min:-'.self::MAX_MONEY, 'max:'.self::MAX_MONEY],
            'lines.*.description' => ['nullable', 'string', 'max:1000'],
            'lines.*.dimensions' => ['nullable', 'array', 'max:8'],
        ];
    }

    /** @return list<callable(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }
            $this->checkLines($validator);
        }];
    }

    public function toInput(): JournalDraftInput
    {
        $v = $this->validated();

        return new JournalDraftInput(
            companyId: $this->company()->id,
            type: JournalType::from((string) ($v['journal_type'] ?? 'manual')),
            date: new DateTimeImmutable((string) $v['journal_date']),
            lines: $this->draftLines(),
            reference: isset($v['reference']) ? (string) $v['reference'] : null,
            memo: isset($v['memo']) ? (string) $v['memo'] : null,
            fiscalPeriodId: isset($v['fiscal_period_id']) ? (string) $v['fiscal_period_id'] : null,
        );
    }

    public function toUpdate(string $journalId): UpdateJournalDraftInput
    {
        $v = $this->validated();

        return new UpdateJournalDraftInput(
            journalId: $journalId,
            lockVersion: (int) $v['version'],
            date: new DateTimeImmutable((string) $v['journal_date']),
            lines: $this->draftLines(),
            reference: isset($v['reference']) ? (string) $v['reference'] : null,
            memo: isset($v['memo']) ? (string) $v['memo'] : null,
            fiscalPeriodId: isset($v['fiscal_period_id']) ? (string) $v['fiscal_period_id'] : null,
        );
    }

    private function checkLines(Validator $validator): void
    {
        $base = $this->company()->base_currency;
        /** @var list<array<string, mixed>> $lines */
        $lines = array_values((array) $this->input('lines'));
        $positions = (new DimensionPositions)($this->company()->id);
        $known = array_flip($positions);

        $valueIds = [];
        foreach ($lines as $i => $line) {
            $debit = (int) ($line['debit'] ?? 0);
            $credit = (int) ($line['credit'] ?? 0);
            if ($debit > 0 && $credit > 0) {
                $validator->errors()->add("lines.{$i}.credit", 'A line is either a debit or a credit, not both.');
            }
            if ($debit === 0 && $credit === 0) {
                $validator->errors()->add("lines.{$i}.debit", 'A line needs a debit or a credit amount.');
            }
            $foreign = isset($line['currency']) && $line['currency'] !== $base;
            if ($foreign && (! isset($line['fx_rate']) || ! isset($line['amount_fc']))) {
                $validator->errors()->add("lines.{$i}.fx_rate", 'A foreign-currency line needs fx_rate and amount_fc.');
            }
            foreach ((array) ($line['dimensions'] ?? []) as $dimensionId => $valueId) {
                if (! isset($known[(string) $dimensionId])) {
                    $validator->errors()->add("lines.{$i}.dimensions", "Dimension {$dimensionId} does not exist in this company.");
                } elseif (! is_string($valueId)) {
                    $validator->errors()->add("lines.{$i}.dimensions.{$dimensionId}", 'Name a dimension value id.');
                } else {
                    $valueIds[$valueId] = (string) $dimensionId;
                }
            }
        }

        // Every named value belongs to its dimension and to this company (RLS alone would let a sibling company's through).
        $found = $valueIds === [] ? [] : DimensionValue::query()->where('company_id', $this->company()->id)->whereIn('id', array_keys($valueIds))->pluck('dimension_id', 'id')->all();
        foreach ($lines as $i => $line) {
            foreach ((array) ($line['dimensions'] ?? []) as $dimensionId => $valueId) {
                if (isset($known[(string) $dimensionId]) && is_string($valueId) && ($found[$valueId] ?? null) !== (string) $dimensionId) {
                    $validator->errors()->add("lines.{$i}.dimensions.{$dimensionId}", 'This value does not belong to the dimension in this company.');
                }
            }
        }
    }

    /** @return list<DraftLine> */
    private function draftLines(): array
    {
        $base = $this->company()->base_currency;
        $slots = array_flip((new DimensionPositions)($this->company()->id));
        /** @var list<array<string, mixed>> $lines */
        $lines = array_values($this->validated()['lines']);

        return array_map(function (array $line) use ($base, $slots): DraftLine {
            $foreign = isset($line['currency']) && $line['currency'] !== $base;
            $dims = [];
            foreach ((array) ($line['dimensions'] ?? []) as $dimensionId => $valueId) {
                $dims[$slots[(string) $dimensionId]] = (string) $valueId;
            }

            return new DraftLine(
                accountId: (string) $line['account_id'],
                debit: (int) ($line['debit'] ?? 0),
                credit: (int) ($line['credit'] ?? 0),
                currency: $foreign ? (string) $line['currency'] : null,
                fxRate: $foreign ? (string) $line['fx_rate'] : null,
                amountFc: $foreign ? (int) $line['amount_fc'] : null,
                dims: $dims,
                description: isset($line['description']) ? (string) $line['description'] : null,
            );
        }, $lines);
    }
}
