<?php

declare(strict_types=1);

namespace App\Http\Requests;

use App\Models\Organisation\Company;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Exists;

/**
 * Base of the requests under /companies/{company}. Authorization is the route's policy
 * (`#[Authorize]`, which runs before validation); existence rules are scoped to the company,
 * because RLS only separates tenants (13 §6).
 */
abstract class CompanyRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    protected function company(): Company
    {
        $company = $this->route('company');

        return $company instanceof Company ? $company : throw new \LogicException('Not a company route.');
    }

    /** An id that must exist in $table for this company (soft-deleted rows excluded where the table has them). */
    protected function inCompany(string $table, string $column = 'id'): Exists
    {
        return Rule::exists($table, $column)->where('company_id', $this->company()->id);
    }
}
