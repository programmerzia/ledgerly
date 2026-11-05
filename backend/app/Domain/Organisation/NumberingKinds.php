<?php

declare(strict_types=1);

namespace App\Domain\Organisation;

/**
 * The document kinds whose numbers a company can configure (13 §23 D15 item 6), with the built-in prefix each one uses today. Pure PHP.
 *
 * A number reads `{prefix}-{fiscal year name}-{counter}`: the year stays in the number whatever the prefix is, so a new year's sequence
 * can never repeat a number of an earlier year. The sequence key a kind uses is `doc:<kind>:<year>`, except journals, `journal:<year>`.
 */
final class NumberingKinds
{
    public const int DEFAULT_PADDING = 5;

    public const int MIN_PADDING = 3;

    public const int MAX_PADDING = 10;

    public const int MAX_PREFIX = 8;

    /** @var array<string, array{label: string, prefix: string}> */
    public const array KINDS = [
        'sales_invoice' => ['label' => 'Sales invoice', 'prefix' => 'INV'],
        'credit_note' => ['label' => 'Credit note', 'prefix' => 'CN'],
        'purchase_bill' => ['label' => 'Purchase bill', 'prefix' => 'BILL'],
        'debit_note' => ['label' => 'Debit note', 'prefix' => 'DN'],
        'receipt' => ['label' => 'Customer receipt', 'prefix' => 'RCT'],
        'payment' => ['label' => 'Supplier payment', 'prefix' => 'PAY'],
        'refund' => ['label' => 'Customer refund', 'prefix' => 'CRF'],
        'supplier_refund' => ['label' => 'Supplier refund', 'prefix' => 'SRF'],
        'wht_certificate' => ['label' => 'Withholding tax certificate', 'prefix' => 'WHT'],
        'payment_run' => ['label' => 'Payment run', 'prefix' => 'RUN'],
        'purchase_requisition' => ['label' => 'Purchase requisition', 'prefix' => 'PR'],
        'purchase_order' => ['label' => 'Purchase order', 'prefix' => 'PO'],
        'goods_receipt' => ['label' => 'Goods receipt', 'prefix' => 'GRN'],
        'journal' => ['label' => 'Journal', 'prefix' => 'JV'],
    ];

    /** @return list<string> */
    public static function keys(): array
    {
        return array_keys(self::KINDS);
    }

    public static function defaultPrefix(string $kind): string
    {
        return self::KINDS[$kind]['prefix'] ?? throw new \InvalidArgumentException("Unknown document kind {$kind}.");
    }

    /**
     * The kind and fiscal year name a sequence key belongs to, or null for a key that is not a configurable document sequence.
     *
     * @return array{0: string, 1: string}|null
     */
    public static function parseKey(string $key): ?array
    {
        if (str_starts_with($key, 'journal:')) {
            return ['journal', substr($key, 8)];
        }
        if (preg_match('/^doc:([a-z_]+):(.+)$/', $key, $m) === 1 && isset(self::KINDS[$m[1]])) {
            return [$m[1], $m[2]];
        }

        return null;
    }

    public static function sequenceKey(string $kind, string $yearName): string
    {
        return $kind === 'journal' ? 'journal:'.$yearName : 'doc:'.$kind.':'.$yearName;
    }

    /**
     * Problems with a prefix; empty when it is acceptable. Capital letters and digits only, starting with a letter, up to 8 characters:
     * the dash that follows it can then never be read as part of it, and a prefix cannot imitate a year segment.
     *
     * @return list<string>
     */
    public static function prefixProblems(string $prefix): array
    {
        if ($prefix === '') {
            return ['Enter a prefix.'];
        }
        if (strlen($prefix) > self::MAX_PREFIX) {
            return ['Use at most '.self::MAX_PREFIX.' characters.'];
        }
        if (preg_match('/^[A-Z][A-Z0-9]*$/', $prefix) !== 1) {
            return ['Use capital letters and digits only, starting with a letter. A dash and the fiscal year are added for you.'];
        }

        return [];
    }

    public static function paddingValid(int $padding): bool
    {
        return $padding >= self::MIN_PADDING && $padding <= self::MAX_PADDING;
    }

    /** What the first number of a year reads like. */
    public static function example(string $prefix, int $padding, string $yearName): string
    {
        return $prefix.'-'.$yearName.'-'.str_pad('1', $padding, '0', STR_PAD_LEFT);
    }
}
