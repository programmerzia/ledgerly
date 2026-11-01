<?php

declare(strict_types=1);

namespace App\Models\Trade;

use App\Models\BaseModel;
use DateTimeImmutable;

/**
 * Withholding certificate for a supplier, issued when a payment settles a bill that carries WHT. `status` is
 * `void` when the payment is reversed; the gapless number stays used.
 *
 * @property string $id
 * @property string $company_id
 * @property string $number
 * @property string $payment_id
 * @property string $invoice_id
 * @property string $contact_id
 * @property string $tax_code_id
 * @property int $base_amount
 * @property int $wht_amount
 * @property DateTimeImmutable $issued_on
 * @property string $status
 */
class WhtCertificate extends BaseModel
{
    /** @return array<string, string> */
    protected function casts(): array
    {
        return ['base_amount' => 'integer', 'wht_amount' => 'integer', 'issued_on' => 'immutable_date'];
    }
}
