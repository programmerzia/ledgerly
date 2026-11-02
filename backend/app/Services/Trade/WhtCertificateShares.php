<?php

declare(strict_types=1);

namespace App\Services\Trade;

use App\Models\Trade\Invoice;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use Illuminate\Database\DatabaseManager;

/**
 * How much of a bill's withheld tax a payment to the supplier covers, for its certificate. Debit notes against the bill
 * reversed their share of the withholding, so a certificate counts only what is left. The payment that clears the bill
 * takes the remainder, so the certificates add up exactly.
 */
final class WhtCertificateShares
{
    public function __construct(private readonly DatabaseManager $db) {}

    /** @return array{invoice_id: string, tax_code_id: string, base: int, wht: int}|null */
    public function of(Invoice $bill, int $amountFc, int $amountBase): ?array
    {
        if ($bill->wht_amount <= 0 || $bill->wht_code_id === null) {
            return null;
        }
        $conn = $this->db->connection();
        $notes = $conn->table('invoices')->where('related_invoice_id', $bill->id)->where('status', 'posted')
            ->selectRaw('COALESCE(SUM(wht_amount), 0) AS wht, COALESCE(SUM(subtotal), 0) AS base, COALESCE(SUM(total - wht_amount), 0) AS net')
            ->first() ?? (object) ['wht' => 0, 'base' => 0, 'net' => 0];
        $done = $conn->table('wht_certificates')->where('invoice_id', $bill->id)->where('status', 'issued')
            ->selectRaw('COALESCE(SUM(wht_amount), 0) AS wht, COALESCE(SUM(base_amount), 0) AS base')
            ->first() ?? (object) ['wht' => 0, 'base' => 0];

        $withheld = $bill->wht_amount - (int) $notes->wht;
        $base = $bill->subtotal - (int) $notes->base;
        $net = $bill->total - $bill->wht_amount - (int) $notes->net;

        if ($bill->settled_fc + $amountFc >= $bill->total_fc - $bill->wht_amount_fc) {
            $wht = $withheld - (int) $done->wht;
            $certified = $base - (int) $done->base;
        } else {
            $wht = self::part($withheld, $amountBase, $net);
            $certified = self::part($base, $amountBase, $net);
        }

        return $wht > 0 ? ['invoice_id' => $bill->id, 'tax_code_id' => $bill->wht_code_id, 'base' => max(0, $certified), 'wht' => $wht] : null;
    }

    private static function part(int $total, int $part, int $whole): int
    {
        return $whole <= 0 ? 0 : BigDecimal::of($total)->multipliedBy($part)->dividedBy($whole, 0, RoundingMode::HalfUp)->toInt();
    }
}
