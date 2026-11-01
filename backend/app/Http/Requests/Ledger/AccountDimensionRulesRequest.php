<?php

declare(strict_types=1);

namespace App\Http\Requests\Ledger;

use App\Domain\Ledger\DimensionRule;
use App\Http\Requests\CompanyRequest;
use Illuminate\Validation\Rule;

/** `{"rules": [{"dimension_id": "...", "rule": "required|optional|forbidden"}]}`: the complete set for the account. */
final class AccountDimensionRulesRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'rules' => ['present', 'array', 'max:8'],
            'rules.*.dimension_id' => ['required', 'uuid', 'distinct', $this->inCompany('dimensions')],
            'rules.*.rule' => ['required', Rule::enum(DimensionRule::class)],
        ];
    }

    /** @return array<string, DimensionRule> dimension id → rule */
    public function dimensionRules(): array
    {
        $out = [];
        /** @var list<array{dimension_id: string, rule: string}> $rows */
        $rows = $this->validated()['rules'];
        foreach ($rows as $row) {
            $out[$row['dimension_id']] = DimensionRule::from($row['rule']);
        }

        return $out;
    }
}
