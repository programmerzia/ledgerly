<?php

declare(strict_types=1);

namespace App\Http\Requests\Transactions;

use App\Domain\Transactions\ProvisionMatrix;
use App\Http\Requests\CompanyRequest;

/** The provisioning rates: a percentage (0 to 100, up to four decimals, as a string) for each of the five aging buckets. */
final class ProvisionRatesRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        $rules = ['rates' => ['required', 'array']];
        foreach (ProvisionMatrix::BUCKETS as $bucket) {
            $rules["rates.{$bucket}"] = ['required', 'string', 'regex:/^\d{1,3}(\.\d{1,4})?$/'];
        }

        return $rules;
    }

    /** @return array<string, string> */
    public function rates(): array
    {
        /** @var array<string, string> $rates */
        $rates = $this->validated()['rates'];

        return $rates;
    }
}
