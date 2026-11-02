<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Actions\Organisation\UpdateCompanySettings;
use App\Models\Ledger\Account;
use App\Models\Organisation\Company;
use App\Models\Organisation\CompanySettings;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The company profile with its settings. Posting accounts are returned for every key (null when not set) with the
 * account's code and name. Approval limits are the company's approval workflows (`/approval-workflows`).
 *
 * @mixin Company
 */
final class CompanySettingsResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $settings = CompanySettings::query()->where('company_id', $this->id)->first();
        $stored = $settings === null ? [] : $settings->posting_accounts;
        $accounts = Account::query()->where('company_id', $this->id)
            ->where(fn ($q) => $q->whereIn('id', array_filter($stored, fn ($v) => preg_match('/^[0-9a-f-]{36}$/', (string) $v) === 1))->orWhereIn('code', array_values($stored)))->get();

        $posting = $this->postingAccounts($stored, $accounts);

        return [
            'company_id' => $this->id,
            'name' => $this->name,
            'legal_name' => $this->legal_name,
            'tax_id' => $this->tax_id,
            'country' => $this->country,
            'base_currency' => $this->base_currency,
            'timezone' => $this->timezone,
            'locale' => $this->locale,
            'fiscal_year_start_month' => $this->fiscal_year_start_month,
            'tax_rounding' => $settings === null ? 'document_per_code' : $settings->tax_rounding,
            'posting_accounts' => $posting,
            'can' => ['update' => (bool) $request->user()?->can('update', $this->resource)],
        ];
    }

    /**
     * @param  array<string, string>  $stored
     * @param  Collection<int, Account>  $accounts
     * @return array<string, array{account_id: string, code: string, name: string}|null>
     */
    private function postingAccounts(array $stored, Collection $accounts): array
    {
        $posting = [];
        foreach (array_keys(UpdateCompanySettings::POSTING_KEYS) as $key) {
            $ref = $stored[$key] ?? null;
            $account = $ref === null ? null : $accounts->first(fn (Account $a) => $a->id === $ref || $a->code === $ref);
            $posting[$key] = $account === null ? null : ['account_id' => $account->id, 'code' => $account->code, 'name' => $account->name];
        }

        return $posting;
    }
}
