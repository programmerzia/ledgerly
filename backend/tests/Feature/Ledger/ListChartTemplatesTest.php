<?php

declare(strict_types=1);

use App\Models\Platform\ChartTemplate;
use App\Queries\Ledger\ChartTemplateSummary;
use App\Queries\Ledger\ListChartTemplates;
use App\Support\Tenancy\TenantContext;

it('lists the starter templates by name with their size, without a tenant context', function () {
    app(TenantContext::class)->clear();

    $list = app(ListChartTemplates::class)();

    expect(array_map(fn (ChartTemplateSummary $t) => $t->code, $list))
        ->toBe(['ifrs_sme', 'insurance', 'non_profit', 'us_small_business']);

    foreach ($list as $summary) {
        $template = ChartTemplate::query()->where('code', $summary->code)->firstOrFail();
        expect($summary->name)->toBe($template->name)
            ->and($summary->country)->toBe($template->country)
            ->and($summary->standard)->toBe($template->standard)
            ->and($summary->accountCount)->toBe(count($template->lines));
    }
});

it('serialises a summary for the picker', function () {
    $summary = new ChartTemplateSummary('us_small_business', 'US small business', 'US', 'US GAAP', 67);

    expect($summary->toArray())->toBe([
        'code' => 'us_small_business', 'name' => 'US small business', 'country' => 'US',
        'standard' => 'US GAAP', 'account_count' => 67,
    ]);
});
