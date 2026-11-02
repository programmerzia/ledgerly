<?php

declare(strict_types=1);

namespace App\Services\Imports\Kinds;

use App\Actions\Trade\Inputs\ContactInput;
use App\Actions\Trade\ManageContact;
use App\Domain\Shared\DomainRuleViolation;
use App\Http\Requests\Trade\ContactRequest;
use App\Services\Imports\FieldSpec;
use App\Services\Imports\ImportContext;
use App\Services\Imports\RequestRules;
use App\Services\Imports\RowByRowKind;
use App\Services\Imports\RowOutcome;
use App\Support\Actor;
use Illuminate\Validation\ValidationException;

/**
 * Customers and suppliers, one per row, created through `ManageContact` after `ContactRequest`'s rules. A row that names an account or
 * tax code gives its code; the code is looked up in the company. Existing contacts are never changed: a code already in use is the
 * row's error. `kind` defaults to customer (the mock's "Customers" import) and the currency to the company's base currency.
 */
final class ContactsKind extends RowByRowKind
{
    private const array PLAIN = ['code' => 'code', 'name' => 'name', 'legal_name' => 'legal_name', 'tax_id' => 'tax_id', 'email' => 'email', 'phone' => 'phone', 'payment_terms_days' => 'payment_terms_days', 'notes' => 'notes'];

    /** import field → [request key, resolver] for fields that name another record by code */
    private const array LOOKUPS = ['ar_account' => 'ar_account_id', 'ap_account' => 'ap_account_id', 'default_account' => 'default_account_id'];

    public function __construct(private readonly RequestRules $rules, private readonly ManageContact $contacts) {}

    public function key(): string
    {
        return 'contacts';
    }

    public function permission(): string
    {
        return 'contacts.manage';
    }

    public function fields(): array
    {
        return [
            new FieldSpec('code', 'Code', true, ['customer code', 'supplier code', 'cust id', 'id', 'customer id', 'supplier id', 'account number']),
            new FieldSpec('name', 'Name', true, ['customer name', 'supplier name', 'company name', 'company', 'customer', 'supplier']),
            new FieldSpec('kind', 'Kind', false, ['type'], 'customer, supplier or both; customer when not given'),
            new FieldSpec('legal_name', 'Legal name'),
            new FieldSpec('tax_id', 'Tax ID', false, ['tax number', 'vat number', 'tin', 'tax id number']),
            new FieldSpec('email', 'Email', false, ['billing email', 'e mail']),
            new FieldSpec('phone', 'Phone', false, ['telephone', 'mobile']),
            new FieldSpec('default_currency', 'Currency', false, ['currency code'], 'the company base currency when not given'),
            new FieldSpec('payment_terms_days', 'Payment terms (days)', false, ['terms', 'payment terms']),
            new FieldSpec('ar_account', 'Receivable account code', false, ['ar account'], 'an account code of this company'),
            new FieldSpec('ap_account', 'Payable account code', false, ['ap account'], 'an account code of this company'),
            new FieldSpec('default_account', 'Default account code', false, [], 'an account code of this company'),
            new FieldSpec('wht_code', 'Withholding tax code', false, [], 'a tax code of this company'),
            new FieldSpec('default_tax_code', 'Default tax code', false, [], 'a tax code of this company'),
            new FieldSpec('notes', 'Notes', false, ['note', 'comments']),
        ];
    }

    protected function prepareRow(ImportContext $ctx, array $cells): RowOutcome
    {
        $outcome = new RowOutcome;
        $payload = [];
        foreach (self::PLAIN as $field => $key) {
            $value = $ctx->value($cells, $field);
            if ($value !== null) {
                $payload[$key] = $value;
            }
        }
        $payload['kind'] = strtolower($ctx->value($cells, 'kind') ?? 'customer');
        $payload['default_currency'] = strtoupper($ctx->value($cells, 'default_currency') ?? $ctx->company->base_currency);

        foreach (self::LOOKUPS as $field => $key) {
            $code = $ctx->value($cells, $field);
            if ($code === null) {
                continue;
            }
            $id = $ctx->accountId($code);
            $id === null ? $outcome->add($field, 'code_not_found', "There is no account with code {$code} in this company.") : $payload[$key] = $id;
        }
        foreach (['wht_code' => 'wht_code_id', 'default_tax_code' => 'default_tax_code_id'] as $field => $key) {
            $code = $ctx->value($cells, $field);
            if ($code === null) {
                continue;
            }
            $id = $ctx->taxCodeId($code);
            $id === null ? $outcome->add($field, 'code_not_found', "There is no tax code {$code} in this company.") : $payload[$key] = $id;
        }
        if (! $outcome->ok()) {
            return $outcome;
        }

        try {
            $request = $this->rules->validate(ContactRequest::class, $ctx->company, $payload, 'contacts.store');
        } catch (ValidationException $e) {
            $outcome->errors = RequestRules::errors($e->errors(), [
                'ar_account_id' => 'ar_account', 'ap_account_id' => 'ap_account', 'default_account_id' => 'default_account',
                'wht_code_id' => 'wht_code', 'default_tax_code_id' => 'default_tax_code',
            ]);

            return $outcome;
        }

        $input = $request->toInput();
        try {
            $this->contacts->check($input);
        } catch (DomainRuleViolation $e) {
            $outcome->add(null, $e->errorCode, $e->getMessage());

            return $outcome;
        }
        $outcome->prepared = $input;

        return $outcome;
    }

    protected function keyOf(RowOutcome $outcome): ?string
    {
        return $outcome->prepared instanceof ContactInput ? 'Contact code '.$outcome->prepared->code : null;
    }

    protected function create(Actor $actor, ImportContext $ctx, RowOutcome $outcome): array
    {
        assert($outcome->prepared instanceof ContactInput);
        $contact = $this->contacts->create($actor, $outcome->prepared);

        return ['contact_id' => $contact->id, 'code' => $contact->code];
    }
}
