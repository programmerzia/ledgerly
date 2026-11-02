<?php

declare(strict_types=1);

namespace App\Services\Imports\Kinds;

use App\Actions\Ledger\Inputs\AccountInput;
use App\Actions\Ledger\ManageAccount;
use App\Domain\Shared\DomainRuleViolation;
use App\Http\Requests\Ledger\AccountRequest;
use App\Services\Imports\FieldSpec;
use App\Services\Imports\ImportContext;
use App\Services\Imports\PreparedSet;
use App\Services\Imports\RequestRules;
use App\Services\Imports\RowByRowKind;
use App\Services\Imports\RowOutcome;
use App\Support\Actor;
use Illuminate\Validation\ValidationException;

/**
 * Chart of accounts, one account per row, created through `ManageAccount` after `AccountRequest`'s rules. A parent is named by its code
 * and must exist already or appear on an earlier row. When the file has no normal balance column it follows the type: debit for
 * assets and expenses, credit for liabilities, equity and income (the standard convention, IAS 1 presentation).
 */
final class AccountsKind extends RowByRowKind
{
    private const array BOOLEANS = ['allow_manual_journals', 'is_postable'];

    public function __construct(private readonly RequestRules $rules, private readonly ManageAccount $accounts) {}

    public function key(): string
    {
        return 'accounts';
    }

    public function permission(): string
    {
        return 'accounts.manage';
    }

    public function fields(): array
    {
        return [
            new FieldSpec('code', 'Code', true, ['account code', 'account number', 'acct', 'number']),
            new FieldSpec('name', 'Name', true, ['account name', 'description of account', 'title']),
            new FieldSpec('account_type', 'Type', true, ['account type', 'class'], 'asset, liability, equity, income or expense'),
            new FieldSpec('normal_balance', 'Normal balance', false, ['balance side', 'side'], 'debit or credit; follows the type when not given'),
            new FieldSpec('parent', 'Parent account code', false, ['parent code', 'parent account', 'parent'], 'a code that exists or is on an earlier row'),
            new FieldSpec('account_subtype', 'Subtype', false, ['subtype', 'sub type', 'group']),
            new FieldSpec('currency_policy', 'Currency policy', false, [], 'base_only, fixed or any'),
            new FieldSpec('fixed_currency', 'Fixed currency', false, [], 'for the fixed policy'),
            new FieldSpec('control_type', 'Control type', false, ['control'], 'none, ar, ap, bank, cash, tax, retained_earnings, suspense, fixed_asset, accum_depr'),
            new FieldSpec('allow_manual_journals', 'Allow manual journals', false, [], 'yes or no'),
            new FieldSpec('is_postable', 'Postable', false, ['postable'], 'yes or no; a header account is not postable'),
            new FieldSpec('description', 'Description'),
        ];
    }

    protected function prepareRow(ImportContext $ctx, array $cells): RowOutcome
    {
        $outcome = new RowOutcome;
        $payload = [];
        foreach (['code', 'name', 'account_subtype', 'description'] as $field) {
            $value = $ctx->value($cells, $field);
            if ($value !== null) {
                $payload[$field] = $value;
            }
        }
        foreach (['account_type', 'normal_balance', 'currency_policy', 'control_type'] as $field) {
            $value = $ctx->value($cells, $field);
            if ($value !== null) {
                $payload[$field] = strtolower($value);
            }
        }
        if (($fixed = $ctx->value($cells, 'fixed_currency')) !== null) {
            $payload['fixed_currency'] = strtoupper($fixed);
        }
        if (! isset($payload['normal_balance']) && isset($payload['account_type'])) {
            $payload['normal_balance'] = in_array($payload['account_type'], ['asset', 'expense'], true) ? 'debit' : 'credit';
        }
        foreach (self::BOOLEANS as $field) {
            $value = $ctx->value($cells, $field);
            if ($value !== null) {
                $payload[$field] = match (strtolower($value)) {
                    'yes', 'y', 'true', '1' => true,
                    'no', 'n', 'false', '0' => false,
                    default => $value,
                };
            }
        }

        $parentCode = $ctx->value($cells, 'parent');
        $parentId = null;
        if ($parentCode !== null) {
            $parentId = $ctx->accountId($parentCode);
            if ($parentId === null) {
                // Not in the chart yet: fine when an earlier row of this file creates it (checked in prepare()); the Action resolves it at apply.
                $outcome->prepared = ['pending_parent' => $parentCode];
            } else {
                $payload['parent_id'] = $parentId;
            }
        }

        try {
            $request = $this->rules->validate(AccountRequest::class, $ctx->company, $payload, 'accounts.store');
        } catch (ValidationException $e) {
            $outcome->errors = RequestRules::errors($e->errors(), ['parent_id' => 'parent']);

            return $outcome;
        }
        $input = $request->toInput();
        if (! isset($outcome->prepared['pending_parent'])) {
            try {
                $this->accounts->check($input);
            } catch (DomainRuleViolation $e) {
                $outcome->add(null, $e->errorCode, $e->getMessage());

                return $outcome;
            }
        }
        $outcome->prepared = ['input' => $input, 'pending_parent' => $outcome->prepared['pending_parent'] ?? null];

        return $outcome;
    }

    public function prepare(ImportContext $ctx, array $rows): PreparedSet
    {
        $set = parent::prepare($ctx, $rows);
        // A parent that is not in the chart must be created by an earlier valid row of the same file.
        $created = [];
        foreach ($set->rows as $number => $outcome) {
            $pending = is_array($outcome->prepared) ? ($outcome->prepared['pending_parent'] ?? null) : null;
            if ($outcome->ok() && $pending !== null) {
                if (! isset($created[$pending])) {
                    $outcome->add('parent', 'code_not_found', "There is no account with code {$pending}, and no earlier row creates it.");
                } else {
                    try {
                        $this->accounts->check($outcome->prepared['input']);
                    } catch (DomainRuleViolation $e) {
                        // The parent id is unknown until it exists; only the code and shape rules can be judged now.
                        if ($e->errorCode !== 'account_parent_invalid') {
                            $outcome->add(null, $e->errorCode, $e->getMessage());
                        }
                    }
                }
            }
            if ($outcome->ok() && is_array($outcome->prepared)) {
                $created[$outcome->prepared['input']->code] = $number;
            }
        }

        return $set;
    }

    protected function keyOf(RowOutcome $outcome): ?string
    {
        return is_array($outcome->prepared) ? 'Account code '.$outcome->prepared['input']->code : null;
    }

    protected function create(Actor $actor, ImportContext $ctx, RowOutcome $outcome): array
    {
        assert(is_array($outcome->prepared) && $outcome->prepared['input'] instanceof AccountInput);
        $input = $outcome->prepared['input'];
        $pending = $outcome->prepared['pending_parent'];
        if ($pending !== null) {
            $parentId = $ctx->accountId($pending) ?? throw DomainRuleViolation::single('code_not_found', "There is no account with code {$pending}.");
            $input = new AccountInput(
                $input->companyId, $input->code, $input->name, $input->accountType, $input->normalBalance, $parentId, $input->currencyPolicy,
                $input->fixedCurrency, $input->controlType, $input->allowManualJournals, $input->isPostable, $input->accountSubtype, $input->description,
            );
        }
        $account = $this->accounts->create($actor, $input);

        return ['account_id' => $account->id, 'code' => $account->code];
    }
}
