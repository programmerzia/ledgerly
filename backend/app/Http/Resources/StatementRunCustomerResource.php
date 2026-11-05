<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Http\Support\Json;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** One customer in the statement run list. The wrapped value is a `StatementRunCustomers` row. */
final class StatementRunCustomerResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        /** @var array{id: string, code: string, name: string, email: string|null, balance: int, last_sent_at: string|null} $c */
        $c = $this->resource;
        $balance = (int) $c['balance'];

        return [
            /** @var string */
            'contact_id' => $c['id'],
            /** @var string */
            'code' => $c['code'],
            /** @var string */
            'name' => $c['name'],
            /** @var string|null */
            'email' => $c['email'],
            /** False when the customer has no email address: flagged in the list and skipped by the run. */
            'has_email' => $c['email'] !== null,
            /** Receivable balance at the end of the period, in the company's base currency; negative is a credit. */
            'balance' => Json::money($balance, Json::baseCurrency($request)),
            /** @var string|null */
            'last_sent_at' => $c['last_sent_at'] === null ? null : (new \DateTimeImmutable($c['last_sent_at']))->format(DATE_ATOM),
        ];
    }
}
