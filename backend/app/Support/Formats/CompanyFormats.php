<?php

declare(strict_types=1);

namespace App\Support\Formats;

use App\Domain\Shared\FormatPreferences;
use App\Models\Organisation\Company;
use Illuminate\Support\Facades\DB;

/** Reads a company's date and number format choice (company_settings) and fills what it did not choose from its country (plan 3c.26b). */
final class CompanyFormats
{
    public static function for(Company $company): FormatPreferences
    {
        $row = DB::table('company_settings')->where('company_id', $company->id)->first(['date_format', 'number_format']);

        return FormatPreferences::resolve(
            $row === null ? null : ($row->date_format === null ? null : (string) $row->date_format),
            $row === null ? null : ($row->number_format === null ? null : (string) $row->number_format),
            (string) $company->country,
        );
    }
}
