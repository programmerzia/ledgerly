<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Domain\Fiscal\CheckOutcome;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin CheckOutcome */
final class CloseCheckResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'code' => $this->code,
            'passed' => $this->passed,
            'message' => $this->message,
            /** @var array<string, mixed> */
            'detail' => $this->detail,
        ];
    }
}
