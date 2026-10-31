<?php

declare(strict_types=1);

use App\Domain\Audit\Jcs;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;

it('chains every event: hash = sha256(prev_hash || canonical), head points at the tip', function () {
    $f = LedgerFixture::create();
    cashSale($f);
    cashSale($f, 300);

    $events = DB::table('audit_events')->orderBy('id')->get();
    expect($events)->toHaveCount(5);

    $prev = null;
    foreach ($events as $e) {
        expect($e->prev_hash)->toBe($prev)
            ->and($e->hash)->toBe(hash('sha256', ($prev ?? '').$e->canonical));

        $decoded = json_decode($e->canonical, true, flags: JSON_THROW_ON_ERROR);
        expect(Jcs::encode($decoded))->toBe($e->canonical)
            ->and($decoded['action'])->toBe($e->action)
            ->and($decoded['tenant_id'])->toBe($f->tenantId);
        $prev = $e->hash;
    }

    $head = DB::table('audit_chain_heads')->where('tenant_id', $f->tenantId)->first();
    expect($head->last_hash)->toBe($prev)->and((int) $head->last_id)->toBe((int) $events->last()->id);
});
