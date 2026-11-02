<?php

declare(strict_types=1);

namespace App\Queries\Procurement;

use App\Models\Organisation\CompanySettings;

/** The company's procurement settings. A company with no settings row has none of it switched on and no tolerance. */
final readonly class ProcurementSettings
{
    public function __construct(
        public bool $requirePurchaseOrder,
        public string $priceTolerancePct,
        public string $quantityTolerancePct,
        public string $receiptTolerancePct,
    ) {}

    public static function of(string $companyId): self
    {
        $s = CompanySettings::query()->where('company_id', $companyId)->first();

        return new self(
            (bool) ($s?->getAttribute('require_purchase_order') ?? false),
            self::pct($s, 'po_price_tolerance_pct'),
            self::pct($s, 'po_quantity_tolerance_pct'),
            self::pct($s, 'receipt_over_tolerance_pct'),
        );
    }

    private static function pct(?CompanySettings $settings, string $column): string
    {
        $value = $settings?->getAttribute($column);

        return is_scalar($value) ? (string) $value : '0';
    }
}
