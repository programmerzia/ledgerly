<?php

declare(strict_types=1);

namespace App\Services\Imports\Kinds;

use App\Actions\Trade\CreateInvoiceDraft;
use App\Actions\Trade\Inputs\InvoiceDraftInput;
use App\Domain\Banking\AmountParser;
use App\Domain\Banking\DateParser;
use App\Domain\Shared\DomainRuleViolation;
use App\Http\Requests\Trade\InvoiceRequest;
use App\Models\Imports\ImportRow;
use App\Services\Imports\FieldSpec;
use App\Services\Imports\ImportContext;
use App\Services\Imports\ImportKind;
use App\Services\Imports\ImportRunner;
use App\Services\Imports\PreparedSet;
use App\Services\Imports\RequestRules;
use App\Services\Imports\RowOutcome;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use Illuminate\Validation\ValidationException;
use InvalidArgumentException;

/**
 * Sales invoices as drafts, never posted: the rows that share an `invoice_ref` are the lines of one invoice, created through
 * `CreateInvoiceDraft` after `InvoiceRequest`'s rules, so the server prices them (a file cannot state totals, tax or base amounts; a
 * price left blank comes from the item). Header cells (customer, dates, currency, rate, memo) are read from the invoice's first row and
 * a later row of the same invoice may repeat them but not change them. A draft goes through the normal submit/approve path afterwards.
 * All rows of an invoice apply together or not at all.
 */
final class InvoicesKind extends ImportKind
{
    private const array HEADER = ['contact', 'issue_date', 'due_date', 'currency', 'fx_rate', 'memo'];

    private const array LINE_FIELDS = ['unit_price_fc' => 'unit_price', 'quantity' => 'quantity', 'discount_pct' => 'discount_pct', 'description' => 'description', 'account_id' => 'account', 'item_id' => 'item', 'tax_code_id' => 'tax_code'];

    public function __construct(private readonly RequestRules $rules, private readonly CreateInvoiceDraft $drafts) {}

    public function key(): string
    {
        return 'invoices';
    }

    public function permission(): string
    {
        return 'invoices.create';
    }

    public function fields(): array
    {
        return [
            new FieldSpec('invoice_ref', 'Invoice reference', true, ['invoice number', 'invoice no', 'invoice', 'reference', 'ref'], 'rows with the same value are the lines of one invoice'),
            new FieldSpec('contact', 'Customer code', true, ['customer', 'customer id', 'customer code', 'cust id']),
            new FieldSpec('issue_date', 'Issue date', true, ['date', 'invoice date']),
            new FieldSpec('due_date', 'Due date', false, ['due']),
            new FieldSpec('currency', 'Currency', false, [], 'the customer\'s currency when not given'),
            new FieldSpec('fx_rate', 'Exchange rate', false, ['rate'], 'the stored rate on the issue date when not given'),
            new FieldSpec('memo', 'Memo', false, ['notes', 'note']),
            new FieldSpec('description', 'Line description', false, ['item description', 'details']),
            new FieldSpec('quantity', 'Quantity', true, ['qty']),
            new FieldSpec('unit_price', 'Unit price', false, ['price', 'rate per unit', 'unit cost'], 'in the invoice currency; the item price when not given'),
            new FieldSpec('discount_pct', 'Discount %', false, ['discount']),
            new FieldSpec('account', 'Revenue account code', false, ['account', 'account code', 'revenue account'], 'an account code of this company'),
            new FieldSpec('item', 'Item code', false, ['item', 'sku', 'product'], 'an item code of this company'),
            new FieldSpec('tax_code', 'Tax code', false, ['tax', 'vat'], 'a tax code of this company; the item default when not given'),
        ];
    }

    public function prepare(ImportContext $ctx, array $rows): PreparedSet
    {
        $set = new PreparedSet;
        foreach ($this->groups($ctx, $rows) as $group) {
            [$outcomes] = $this->build($ctx, $group);
            foreach ($outcomes as $number => $outcome) {
                $set->rows[$number] = $outcome;
            }
        }
        ksort($set->rows);

        return $set;
    }

    public function apply(ImportContext $ctx, Actor $actor, ImportRunner $run): void
    {
        $pending = $run->pending()->mapWithKeys(fn (ImportRow $r) => [$r->row_number => $r])->all();
        $cells = array_map(fn (ImportRow $r) => $r->cells, $pending);
        foreach ($this->groups($ctx, $cells) as $group) {
            [$outcomes, $input] = $this->build($ctx, $group);
            $ids = array_map(fn (int $n) => $pending[$n]->id, array_keys($group));
            $errors = [];
            foreach ($outcomes as $outcome) {
                array_push($errors, ...$outcome->errors);
            }
            if ($errors !== [] || $input === null) {
                $run->fail($ids, $errors);

                continue;
            }
            $run->unit($ids, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $input): array {
                $invoice = $this->drafts->handle($actor, $input);

                return ['invoice_id' => $invoice->id, 'reference' => $invoice->reference];
            });
        }
    }

    /**
     * Rows grouped by invoice reference, in order of first appearance. A row with no reference is a group of its own (and an error).
     *
     * @param  array<int, array<string, string>>  $rows
     * @return list<array<int, array<string, string>>>
     */
    private function groups(ImportContext $ctx, array $rows): array
    {
        $groups = [];
        foreach ($rows as $number => $cells) {
            $ref = $ctx->value($cells, 'invoice_ref');
            $key = $ref === null ? "\0row{$number}" : "ref:{$ref}";
            $groups[$key][$number] = $cells;
        }

        return array_values($groups);
    }

    /**
     * @param  array<int, array<string, string>>  $group  row number → cells
     * @return array{0: array<int, RowOutcome>, 1: InvoiceDraftInput|null}
     */
    private function build(ImportContext $ctx, array $group): array
    {
        $numbers = array_keys($group);
        $first = $numbers[0];
        $outcomes = array_fill_keys($numbers, null);
        foreach ($numbers as $n) {
            $outcomes[$n] = new RowOutcome;
        }
        /** @var array<int, RowOutcome> $outcomes */
        $ref = $ctx->value($group[$first], 'invoice_ref');
        if ($ref === null) {
            $outcomes[$first]->add('invoice_ref', 'required', 'The invoice reference is empty; rows of one invoice share it.');

            return [$outcomes, null];
        }

        // Header cells come from the first row; later rows may repeat them but not contradict them.
        $header = [];
        foreach (self::HEADER as $field) {
            $header[$field] = $ctx->value($group[$first], $field);
            foreach ($numbers as $n) {
                $v = $ctx->value($group[$n], $field);
                if ($v !== null && $header[$field] !== null && $v !== $header[$field]) {
                    $outcomes[$n]->add($field, 'invoice_header_mismatch', "Invoice {$ref} has {$header[$field]} on row {$first} but {$v} here.");
                } elseif ($header[$field] === null && $v !== null && $n !== $first) {
                    $header[$field] = $v;
                }
            }
        }

        $payload = ['reference' => $ref];
        $contact = $header['contact'] === null ? null : $ctx->contact($header['contact']);
        if ($header['contact'] !== null) {
            $contact === null
                ? $outcomes[$first]->add('contact', 'code_not_found', "There is no contact with code {$header['contact']} in this company.")
                : $payload['contact_id'] = $contact->id;
        }
        $currency = strtoupper($header['currency'] ?? $contact->default_currency ?? $ctx->company->base_currency);
        if ($header['currency'] !== null) {
            $payload['currency'] = $currency;
        }
        foreach (['issue_date', 'due_date'] as $field) {
            if ($header[$field] !== null) {
                try {
                    $payload[$field] = DateParser::parse($header[$field], $ctx->dateFormat());
                } catch (InvalidArgumentException $e) {
                    $outcomes[$first]->add($field, 'invalid_date', $e->getMessage());
                }
            }
        }
        if ($header['fx_rate'] !== null) {
            $payload['fx_rate'] = self::decimal($header['fx_rate'], $ctx->locale());
        }
        if ($header['memo'] !== null) {
            $payload['memo'] = $header['memo'];
        }

        $lines = [];
        $lineRows = [];
        foreach ($numbers as $n) {
            $line = [];
            $cells = $group[$n];
            foreach (['description', 'quantity', 'discount_pct'] as $field) {
                $v = $ctx->value($cells, $field);
                if ($v !== null) {
                    $line[$field] = $field === 'description' ? $v : self::decimal($v, $ctx->locale());
                }
            }
            if (($price = $ctx->value($cells, 'unit_price')) !== null) {
                try {
                    $line['unit_price_fc'] = AmountParser::parse($price, $ctx->locale(), $ctx->scale($currency));
                } catch (InvalidArgumentException $e) {
                    $outcomes[$n]->add('unit_price', 'invalid_amount', $e->getMessage());
                }
            }
            foreach ([['account', 'account_id', fn (string $c) => $ctx->accountId($c)], ['item', 'item_id', fn (string $c) => $ctx->itemId($c)], ['tax_code', 'tax_code_id', fn (string $c) => $ctx->taxCodeId($c)]] as [$field, $key, $find]) {
                $code = $ctx->value($cells, $field);
                if ($code === null) {
                    continue;
                }
                $id = $find($code);
                $id === null ? $outcomes[$n]->add($field, 'code_not_found', "There is no {$field} with code {$code} in this company.") : $line[$key] = $id;
            }
            $lines[] = $line;
            $lineRows[] = $n;
        }
        $payload['lines'] = $lines;

        $broken = false;
        foreach ($outcomes as $o) {
            $broken = $broken || ! $o->ok();
        }
        if ($broken) {
            return [$this->spread($outcomes, $ref, $first), null];
        }

        try {
            $request = $this->rules->validate(InvoiceRequest::class, $ctx->company, $payload, 'invoices.store');
        } catch (ValidationException $e) {
            foreach ($e->errors() as $key => $messages) {
                foreach ($messages as $message) {
                    if (preg_match('/^lines\.(\d+)\.(\w+)/', $key, $m) === 1) {
                        $outcomes[$lineRows[(int) $m[1]]]->add(self::LINE_FIELDS[$m[2]] ?? $m[2], 'invalid', (string) preg_replace('/lines\.\d+\./', '', $message));
                    } else {
                        $outcomes[$first]->add(['contact_id' => 'contact'][$key] ?? $key, 'invalid', $message);
                    }
                }
            }

            return [$this->spread($outcomes, $ref, $first), null];
        }

        $input = $request->toInput();
        try {
            $this->drafts->check($input);
        } catch (DomainRuleViolation $e) {
            $outcomes[$first]->add(null, $e->errorCode, $e->getMessage());

            return [$this->spread($outcomes, $ref, $first), null];
        }
        $outcomes[$first]->prepared = $input;

        return [$outcomes, $input];
    }

    /**
     * When any row of an invoice is wrong, the others cannot apply either; say so on them.
     *
     * @param  array<int, RowOutcome>  $outcomes
     * @return array<int, RowOutcome>
     */
    private function spread(array $outcomes, string $ref, int $first): array
    {
        $bad = array_keys(array_filter($outcomes, fn (RowOutcome $o) => ! $o->ok()));
        foreach ($outcomes as $n => $o) {
            if ($o->ok() && $bad !== []) {
                $o->add('invoice_ref', 'invoice_has_errors', "Invoice {$ref} cannot be created: fix row ".implode(', ', $bad).'.');
            }
        }

        return $outcomes;
    }

    /** A quantity, rate or percentage in the file's number format as the plain decimal text the API takes. */
    private static function decimal(string $raw, string $locale): string
    {
        $s = str_replace([' ', "\u{00A0}"], '', $raw);

        return match ($locale) {
            'us' => str_replace(',', '', $s),
            'eu' => str_replace(',', '.', str_replace('.', '', $s)),
            default => str_replace(',', '.', $s),
        };
    }
}
