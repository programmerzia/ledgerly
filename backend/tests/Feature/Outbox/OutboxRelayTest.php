<?php

declare(strict_types=1);

use App\Contracts\OutboxEvent;
use App\Support\Outbox\OutboxRelay;
use App\Support\Tenancy\TenantContext;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;
use Tests\Support\RecordingOutboxHandler;

/*
 * Outbox relay (13 §15): messages are delivered right after commit inside their tenant, failures
 * are retried by the sweep after the claim expires, and nothing is delivered for a rollback.
 */

beforeEach(function (): void {
    RecordingOutboxHandler::$delivered = [];
    RecordingOutboxHandler::$fail = false;
    config(['outbox.handlers' => ['test.happened' => [RecordingOutboxHandler::class]]]);
});

function emit(LedgerFixture $f, string $type = 'test.happened', bool $rollback = false): void
{
    app(TenantContext::class)->run($f->tenantId, fn () => app(UnitOfWork::class)->run($f->actor, function (LockSet $l, AuditBuffer $a, Outbox $outbox) use ($type, $rollback): void {
        $outbox->add(new class($type) implements OutboxEvent
        {
            public function __construct(private string $t) {}

            public function type(): string
            {
                return $this->t;
            }

            public function payload(): array
            {
                return ['n' => 1];
            }
        });
        if ($rollback) {
            throw new RuntimeException('rolled back');
        }
    }));
}

/** @return list<object> */
function messages(LedgerFixture $f): array
{
    return app(TenantContext::class)->run($f->tenantId, fn () => DB::table('outbox_messages')->orderBy('occurred_at')->get()->all());
}

it('delivers a transaction\'s messages right after commit, inside its tenant', function (): void {
    $f = LedgerFixture::create();
    app(TenantContext::class)->clear();

    emit($f);

    expect(RecordingOutboxHandler::$delivered)->toHaveCount(1)
        ->and(RecordingOutboxHandler::$delivered[0]['tenant'])->toBe($f->tenantId)
        ->and(messages($f)[0]->dispatched_at)->not->toBeNull()
        ->and(app(TenantContext::class)->id())->toBeNull();
});

it('marks messages without handlers as dispatched and writes nothing for a rollback', function (): void {
    $f = LedgerFixture::create();
    app(TenantContext::class)->clear();

    emit($f, 'nobody.listens');
    expect(fn () => emit($f, rollback: true))->toThrow(RuntimeException::class);

    expect(messages($f))->toHaveCount(1)
        ->and(messages($f)[0]->dispatched_at)->not->toBeNull()
        ->and(RecordingOutboxHandler::$delivered)->toBe([]);
});

it('retries a failed delivery from the sweep once the claim has expired', function (): void {
    $a = LedgerFixture::create(slug: 'alpha');
    $b = LedgerFixture::create(slug: 'beta');
    app(TenantContext::class)->clear();

    RecordingOutboxHandler::$fail = true;
    emit($a);
    emit($b);
    expect(messages($a)[0]->dispatched_at)->toBeNull()->and((int) messages($a)[0]->attempts)->toBe(1);

    RecordingOutboxHandler::$fail = false;
    expect(app(OutboxRelay::class)->sweep())->toBe(0); // still claimed by the failed kick

    foreach ([$a, $b] as $f) {
        app(TenantContext::class)->run($f->tenantId, fn () => DB::table('outbox_messages')->update(['claimed_at' => now()->subMinutes(2)]));
    }
    $this->artisan('outbox:sweep')->assertSuccessful();

    expect(collect(RecordingOutboxHandler::$delivered)->pluck('tenant')->sort()->values()->all())->toBe(collect([$a->tenantId, $b->tenantId])->sort()->values()->all())
        ->and(messages($a)[0]->dispatched_at)->not->toBeNull()
        ->and((int) messages($a)[0]->attempts)->toBe(2)
        ->and(app(TenantContext::class)->id())->toBeNull();
});

it('gives up on a message after 20 attempts and refuses to sweep inside a tenant', function (): void {
    $f = LedgerFixture::create();
    app(TenantContext::class)->clear();
    RecordingOutboxHandler::$fail = true;
    emit($f);
    app(TenantContext::class)->run($f->tenantId, fn () => DB::table('outbox_messages')->update(['claimed_at' => null, 'attempts' => 20]));
    RecordingOutboxHandler::$fail = false;

    expect(app(OutboxRelay::class)->sweep())->toBe(0)->and(RecordingOutboxHandler::$delivered)->toBe([]);

    app(TenantContext::class)->set($f->tenantId);
    expect(fn () => app(OutboxRelay::class)->sweep())->toThrow(LogicException::class);
});
