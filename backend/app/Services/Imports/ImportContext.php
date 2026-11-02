<?php

declare(strict_types=1);

namespace App\Services\Imports;

use App\Models\Imports\Import;
use App\Models\Ledger\Account;
use App\Models\Organisation\Company;
use App\Models\Tax\TaxCode;
use App\Models\Trade\Contact;
use App\Models\Trade\Item;
use App\Support\Actor;
use Illuminate\Support\Facades\DB;

/**
 * What a kind needs to read rows of one import: the company, the mapping, and natural-key lookups. A row names accounts, contacts, tax
 * codes and items by their code; each lookup is scoped to the import's company (RLS only separates tenants), and a code that is not
 * found is the row's error. Ids never come from the file.
 */
final class ImportContext
{
    /** @var array<string, Account|null> */
    private array $accounts = [];

    /** @var array<string, Contact|null> */
    private array $contacts = [];

    /** @var array<string, string|null> */
    private array $taxIds = [];

    /** @var array<string, string|null> */
    private array $itemIds = [];

    private ?int $scale = null;

    public function __construct(public readonly Company $company, public readonly Import $import, public readonly Actor $actor) {}

    /** @return array<string, string> field → header */
    public function columns(): array
    {
        /** @var array<string, string> */
        return (array) ($this->import->mapping['columns'] ?? []);
    }

    /**
     * The row's value for a field: the mapped cell (trimmed), else the mapping's default, else null.
     *
     * @param  array<string, string>  $cells
     */
    public function value(array $cells, string $field): ?string
    {
        $header = $this->columns()[$field] ?? null;
        if ($header !== null) {
            $cell = trim((string) ($cells[$header] ?? ''));
            if ($cell !== '') {
                return $cell;
            }
        }
        $default = ((array) ($this->import->mapping['defaults'] ?? []))[$field] ?? null;

        return is_scalar($default) && trim((string) $default) !== '' ? trim((string) $default) : null;
    }

    public function option(string $key, mixed $default = null): mixed
    {
        return $this->import->options[$key] ?? $default;
    }

    public function locale(): string
    {
        return (string) $this->option('number_locale', 'plain');
    }

    public function dateFormat(): string
    {
        return (string) $this->option('date_format', 'Y-m-d');
    }

    /** Minor-unit exponent of a currency (2 for USD). */
    public function scale(?string $currency = null): int
    {
        $currency ??= $this->company->base_currency;
        if ($currency === $this->company->base_currency && $this->scale !== null) {
            return $this->scale;
        }
        $scale = (int) (DB::table('currencies')->where('code', $currency)->value('minor_unit') ?? 2);
        if ($currency === $this->company->base_currency) {
            $this->scale = $scale;
        }

        return $scale;
    }

    public function account(string $code): ?Account
    {
        return $this->accounts[$code] ??= Account::query()->where('company_id', $this->company->id)->where('code', $code)->first();
    }

    public function accountId(string $code): ?string
    {
        return $this->account($code)?->id;
    }

    public function contact(string $code): ?Contact
    {
        return $this->contacts[$code] ??= Contact::query()->where('company_id', $this->company->id)->where('code', $code)->first();
    }

    public function taxCodeId(string $code): ?string
    {
        return $this->taxIds[$code] ??= TaxCode::query()->where('company_id', $this->company->id)->where('code', $code)->value('id');
    }

    public function itemId(string $code): ?string
    {
        return $this->itemIds[$code] ??= Item::query()->where('company_id', $this->company->id)->where('code', $code)->value('id');
    }
}
