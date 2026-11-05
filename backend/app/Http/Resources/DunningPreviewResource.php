<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use App\Models\Trade\Contact;
use App\Models\Trade\DunningStage;
use App\Models\Trade\Invoice;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One overdue reminder a run on the previewed date would send: the invoice, the stage, the amount, and whether it can go.
 * The wrapped value is the array a `DunningCandidates` row is.
 */
final class DunningPreviewResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var array{invoice: Invoice, contact: Contact, stage: DunningStage, days_overdue: int, amount_due_fc: int, email: string|null} $c */
        $c = $this->resource;
        $amount = (int) $c['amount_due_fc'];
        $currency = (string) $c['invoice']->currency;

        return [
            /** @var string */
            'invoice_id' => $c['invoice']->id,
            /** @var string|null */
            'number' => $c['invoice']->number,
            /** @var string */
            'contact_id' => $c['contact']->id,
            /** @var string */
            'contact_name' => $c['contact']->name,
            /** @var string|null */
            'email' => $c['email'],
            /** @var int */
            'stage_days' => $c['stage']->days_after_due,
            /** @var int */
            'days_overdue' => $c['days_overdue'],
            'amount_due' => Json::money($amount, $currency),
            /** False when the contact has no email address: the reminder is skipped and the row is flagged. */
            'will_send' => $c['email'] !== null,
        ];
    }
}
