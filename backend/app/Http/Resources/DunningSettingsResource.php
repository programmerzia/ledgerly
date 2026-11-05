<?php

declare(strict_types=1);

namespace App\Http\Resources;

use App\Domain\Documents\MessageTemplate;
use App\Models\Organisation\Company;
use App\Models\Organisation\CompanySettings;
use App\Models\Trade\DunningStage;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;

/**
 * A company's overdue-invoice reminder settings (plan 3c.7).
 *
 * @mixin Company
 */
final class DunningSettingsResource extends JsonResource
{
    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        $settings = CompanySettings::query()->where('company_id', $this->id)->first();
        $used = DB::table('dunning_sends')->where('company_id', $this->id)->selectRaw('stage_id, count(*) AS n')->groupBy('stage_id')->pluck('n', 'stage_id');
        $stages = DunningStage::query()->where('company_id', $this->id)->orderBy('days_after_due')->get();

        return [
            'enabled' => $settings !== null && (bool) $settings->getAttribute('dunning_enabled'),
            /** @var list<array{id: string, days_after_due: int, subject: string, body: string, sent_count: int}> */
            'stages' => $stages->map(fn (DunningStage $s): array => [
                'id' => $s->id,
                'days_after_due' => $s->days_after_due,
                'subject' => $s->subject,
                'body' => $s->body,
                /** Invoices this stage has reminded; a used stage cannot be removed. */
                'sent_count' => (int) ($used[$s->id] ?? 0),
            ])->values()->all(),
            /** The only `{{ placeholders }}` the wording may use, with what each stands for. */
            'placeholders' => MessageTemplate::PLACEHOLDERS,
            'version' => $settings === null ? 0 : (int) $settings->getAttribute('lock_version'),
            'can' => ['update' => (bool) $request->user()?->can('update', $this->resource)],
        ];
    }
}
