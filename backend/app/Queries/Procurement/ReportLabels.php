<?php

declare(strict_types=1);

namespace App\Queries\Procurement;

use App\Models\Ledger\Account;

final class ReportLabels
{
    /** @return array<string, array{code: string, name: string}> */
    public static function accounts(string $companyId): array
    {
        $labels = [];
        foreach (Account::query()->where('company_id', $companyId)->get(['id', 'code', 'name']) as $account) {
            $labels[$account->id] = ['code' => $account->code, 'name' => $account->name];
        }

        return $labels;
    }
}
