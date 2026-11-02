<?php

declare(strict_types=1);

namespace App\Services\Imports;

use App\Domain\Shared\DomainRuleViolation;
use App\Services\Imports\Kinds\AccountsKind;
use App\Services\Imports\Kinds\BankLinesKind;
use App\Services\Imports\Kinds\ContactsKind;
use App\Services\Imports\Kinds\InvoicesKind;
use App\Services\Imports\Kinds\OpeningBalancesKind;

/** The import kinds by key; the key is the `kind` of an import. */
final class ImportKinds
{
    private const array MAP = [
        'contacts' => ContactsKind::class,
        'accounts' => AccountsKind::class,
        'opening_balances' => OpeningBalancesKind::class,
        'invoices' => InvoicesKind::class,
        'bank_lines' => BankLinesKind::class,
    ];

    public function get(string $key): ImportKind
    {
        $class = self::MAP[$key] ?? throw DomainRuleViolation::single('import_kind_unknown', "Unknown import kind {$key}.");

        return app($class);
    }

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::MAP);
    }

    /** @return array<string, string> kind → company permission, for the policy */
    public static function permissions(): array
    {
        $out = [];
        foreach (self::MAP as $key => $class) {
            $out[$key] = app($class)->permission();
        }

        return $out;
    }
}
