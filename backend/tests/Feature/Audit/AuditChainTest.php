<?php

declare(strict_types=1);

use App\Actions\Fiscal\CreateFiscalYear;
use App\Actions\Fiscal\Inputs\CreateFiscalYearInput;
use App\Domain\Audit\Jcs;
use App\Queries\Audit\AuditChainReport;
use App\Queries\Audit\VerifyAuditChain;
use App\Support\Actor;
use App\Support\Audit\AuditSealer;
use App\Support\Audit\DetachedAudit;
use App\Support\Tenancy\TenantContext;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerFixture;
use Tests\Support\TamperAudit;

/*
 * Audit chain (13 §14): detached events survive rollbacks; seals pin the tip; the verifier finds
 * every kind of tampering an owner-level attacker could attempt.
 */

/** A tenant with a few chained events (fixture setup + two more fiscal years). */
function auditedTenant(string $slug = 'acme'): LedgerFixture
{
    $f = LedgerFixture::create(slug: $slug);
    foreach (['2027', '2028'] as $year) {
        app(CreateFiscalYear::class)->handle(Actor::system($f->tenantId, $f->companyId), new CreateFiscalYearInput($f->companyId, new DateTimeImmutable("{$year}-01-01"), "FY{$year}"));
    }

    return $f;
}

function verify(bool $fromSeal = false): AuditChainReport
{
    return app(VerifyAuditChain::class)($fromSeal);
}

/** @return list<int> event ids in chain order */
function eventIds(): array
{
    return DB::table('audit_events')->orderBy('id')->pluck('id')->map(fn ($id) => (int) $id)->all();
}

it('verifies an untouched chain, including the head', function (): void {
    auditedTenant();

    $report = verify();
    expect($report->intact)->toBeTrue()->and($report->eventsChecked)->toBe(count(eventIds()))->and($report->eventsChecked)->toBeGreaterThanOrEqual(3);
});

it('detects an edited column, an edited canonical text, a removed event and a truncated tail', function (string $attack, string $problem): void {
    $f = auditedTenant();
    [$first, $middle] = eventIds();
    $last = eventIds()[count(eventIds()) - 1];

    TamperAudit::as($f->tenantId, fn (Connection $db) => match ($attack) {
        'column' => $db->update("UPDATE audit_events SET action = 'fiscal_year.deleted' WHERE id = ?", [$middle]),
        'canonical' => $db->update("UPDATE audit_events SET canonical = replace(canonical, 'FY2027', 'FY1999') WHERE id = ?", [$middle]),
        'remove' => $db->delete('DELETE FROM audit_events WHERE id = ?', [$middle]),
        'truncate' => $db->delete('DELETE FROM audit_events WHERE id = ?', [$last]),
    });

    $report = verify();
    expect($report->intact)->toBeFalse()->and($report->problem)->toBe($problem);
    expect($first)->toBeLessThan($middle);
})->with([
    'edited column' => ['column', 'canonical_mismatch'],
    'edited canonical text' => ['canonical', 'hash_mismatch'],
    'removed event' => ['remove', 'chain_link'],
    'truncated tail' => ['truncate', 'head_mismatch'],
]);

it('catches a rewrite with recomputed hashes through the seal', function (): void {
    $f = auditedTenant();
    expect(app(AuditSealer::class)->seal())->not->toBeNull();

    // Rewrite the first event and recompute every hash after it, head included: a perfect forgery
    // of the chain itself, which only the seal can reveal.
    TamperAudit::as($f->tenantId, function (Connection $db) use ($f): void {
        $prev = null;
        foreach ($db->table('audit_events')->orderBy('id')->get() as $i => $e) {
            $canonical = $i === 0 ? str_replace('"FY2026"', '"FY1999"', $e->canonical) : $e->canonical;
            $fields = json_decode($canonical, true);
            $fields['prev_hash'] = $prev;
            $canonical = Jcs::encode($fields);
            $hash = hash('sha256', ($prev ?? '').$canonical);
            $db->update('UPDATE audit_events SET canonical = ?, prev_hash = ?, hash = ?, after = ?::jsonb WHERE id = ?', [
                $canonical, $prev, $hash, $fields['after'] === null ? null : Jcs::encode($fields['after']), $e->id,
            ]);
            $prev = $hash;
        }
        $db->update('UPDATE audit_chain_heads SET last_hash = ? WHERE tenant_id = ?', [$prev, $f->tenantId]);
    });

    $report = verify();
    expect($report->intact)->toBeFalse()->and($report->problem)->toBe('seal_mismatch');
    // No seal still matches, so a "from seal" run falls back to a full one and finds the same.
    expect(verify(fromSeal: true)->problem)->toBe('seal_mismatch');
});

it('seals only when the chain moved, and checks only newer events from the newest seal', function (): void {
    $f = auditedTenant();
    $sealer = app(AuditSealer::class);

    $seal = $sealer->seal();
    expect($seal['sealed_through_id'])->toBe(max(eventIds()))
        ->and($sealer->seal())->toBeNull();

    app(CreateFiscalYear::class)->handle(Actor::system($f->tenantId, $f->companyId), new CreateFiscalYearInput($f->companyId, new DateTimeImmutable('2029-01-01'), 'FY2029'));

    $report = verify(fromSeal: true);
    expect($report->intact)->toBeTrue()
        ->and($report->startedAfterId)->toBe($seal['sealed_through_id'])
        ->and($report->eventsChecked)->toBe(1)
        ->and($sealer->seal()['sealed_through_id'])->toBe(max(eventIds()));
});

it('keeps detached events when the business transaction rolls back, chained like the rest', function (): void {
    $f = auditedTenant();
    $before = count(eventIds());

    try {
        app(UnitOfWork::class)->run($f->actor, function (LockSet $l, AuditBuffer $audit, Outbox $o): void {
            $audit->add('journal.approve_attempted', null);

            throw new RuntimeException('signing failed');
        });
    } catch (RuntimeException) {
        app(DetachedAudit::class)->record($f->actor, 'signing.failed', context: ['reason' => 'wrong_pin']);
    }

    expect(DB::table('audit_events')->orderByDesc('id')->value('action'))->toBe('signing.failed')
        ->and(count(eventIds()))->toBe($before + 1)
        ->and(verify()->intact)->toBeTrue();
});

it('refuses a detached write while the main transaction is open', function (): void {
    $f = auditedTenant();

    expect(fn () => DB::transaction(fn () => app(DetachedAudit::class)->record($f->actor, 'x')))
        ->toThrow(LogicException::class);
});

it('runs the nightly seal for every live tenant and verifies from the command line', function (): void {
    $a = auditedTenant('alpha');
    $b = auditedTenant('beta');
    app(TenantContext::class)->clear();

    $this->artisan('audit:seal')->assertSuccessful();
    foreach ([$a, $b] as $f) {
        expect(app(TenantContext::class)->run($f->tenantId, fn () => DB::table('audit_seals')->count()))->toBe(1);
    }

    $this->artisan('audit:verify', ['tenant' => $a->tenantId])->assertSuccessful();
    TamperAudit::as($a->tenantId, fn (Connection $db) => $db->update("UPDATE audit_events SET request_id = 'forged' WHERE id = (SELECT min(id) FROM audit_events)"));
    $this->artisan('audit:verify', ['tenant' => $a->tenantId])->assertFailed();
    $this->artisan('audit:verify', ['tenant' => $b->tenantId])->assertSuccessful();
    expect(app(TenantContext::class)->id())->toBeNull();
});
