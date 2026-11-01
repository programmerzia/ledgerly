<?php

declare(strict_types=1);

namespace App\Http\Requests\Ledger;

use App\Http\Requests\CompanyRequest;

final class ApplyChartTemplateRequest extends CompanyRequest
{
    /** @return array<string, mixed> */
    public function rules(): array
    {
        return ['template_code' => ['required', 'string', 'max:64']];
    }

    public function templateCode(): string
    {
        return (string) $this->validated()['template_code'];
    }
}
