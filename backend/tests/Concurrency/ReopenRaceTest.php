<?php

declare(strict_types=1);

use App\Actions\Fiscal\ClosePeriod;
use App\Actions\Fiscal\DecidePeriodReopen;
use App\Actions\Fiscal\Inputs\ClosePeriodInput;
use App\Actions\Fiscal\RequestPeriodReopen;
use App\Contracts\PermissionChecker;
use App\Support\Actor;
use App\Support\ActorType;
use App\Support\Testing\GrantedPermissions;
use Illuminate\Support\Facades\DB;
use Tests\Support\LedgerChecks;
use Tests\Support\LedgerFixture;
use Tests\Support\Race;

/*
 * Reopen (PRD §4, 13 §10): two distinct signed approvers, neither the requester. The period row
 * lock (level 1) serialises the signatures, so a period is reopened once and reopened_count moves
 * by exactly one.
 */

/** A closed March with a pending reopen request from the fixture's user. @return array{LedgerFixture, string, string} */
function raceClosedMarch(): array
{
    app()->instance(PermissionChecker::class, new GrantedPermissions(['periods.close', 'periods.reopen.request', 'periods.reopen.approve']));
    $f = LedgerFixture::create();
    $signer = new Actor(ActorType::User, $f->userId, $f->tenantId, $f->companyId, hasSigningGrant: true);
    $march = $f->period('2026-03-15')->id;
    app(ClosePeriod::class)->handle($signer, new ClosePeriodInput($march));
    $request = app(RequestPeriodReopen::class)->handle($signer, $march, 'Missed supplier invoice');

    return [$f, $march, $request->id];
}

it('reopens once when two approvers race the second signature', function (): void {
    [$f, $march, $requestId] = raceClosedMarch();
    [$amina, $kenneth, $farah] = [Race::user($f, 'Amina'), Race::user($f, 'Kenneth'), Race::user($f, 'Farah')];
    app(DecidePeriodReopen::class)->approve(new Actor(ActorType::User, $amina, $f->tenantId, $f->companyId, hasSigningGrant: true), $requestId);

    $flat = Race::flatten(Race::run($f, [
        [['op' => 'reopen_approve', 'id' => $requestId, 'user' => $kenneth]],
        [['op' => 'reopen_approve', 'id' => $requestId, 'user' => $farah]],
        [['op' => 'reopen_approve', 'id' => $requestId, 'user' => $amina]],
    ]));

    $request = DB::table('period_reopen_requests')->where('id', $requestId)->first();
    $period = DB::table('fiscal_periods')->where('id', $march)->first();
    expect(Race::errors($flat))->toBe([], 'a raw error (e.g. a deadlock) surfaced to the caller')
        ->and(Race::ok($flat))->toHaveCount(1)
        ->and(Race::refusals($flat))->each->toBeIn(['reopen_not_pending', 'approver_already_signed'])
        ->and($request->status)->toBe('approved')
        ->and($request->first_approver)->toBe($amina)
        ->and($request->second_approver)->toBeIn([$kenneth, $farah])
        ->and($period->status)->toBe('open')
        ->and($period->reopened_count)->toBe(1)
        ->and(DB::table('audit_events')->where('action', 'period.reopened')->count())->toBe(1)
        ->and(DB::table('audit_events')->where('action', 'period.reopen_approved')->count())->toBe(2)
        ->and(LedgerChecks::problems())->toBe([]);
})->group('concurrency');

it('takes two signatures and one reopen from three approvers racing both signatures', function (): void {
    [$f, $march, $requestId] = raceClosedMarch();
    $approvers = [Race::user($f, 'Amina'), Race::user($f, 'Kenneth'), Race::user($f, 'Farah')];

    $flat = Race::flatten(Race::run($f, array_map(fn (string $id) => [['op' => 'reopen_approve', 'id' => $requestId, 'user' => $id]], $approvers)));

    $request = DB::table('period_reopen_requests')->where('id', $requestId)->first();
    expect(Race::errors($flat))->toBe([], 'a raw error (e.g. a deadlock) surfaced to the caller')
        ->and(Race::ok($flat))->toHaveCount(2)
        ->and(Race::refusals($flat))->toBe(['reopen_not_pending'])
        ->and($request->status)->toBe('approved')
        ->and($request->first_approver)->not->toBe($request->second_approver)
        ->and(DB::table('fiscal_periods')->where('id', $march)->value('reopened_count'))->toBe(1)
        ->and(LedgerChecks::problems())->toBe([]);
})->group('concurrency');

it('lets one approver sign only once when they race themselves', function (): void {
    [$f, $march, $requestId] = raceClosedMarch();
    $amina = Race::user($f, 'Amina');

    $flat = Race::flatten(Race::run($f, array_fill(0, 3, [['op' => 'reopen_approve', 'id' => $requestId, 'user' => $amina]])));

    $request = DB::table('period_reopen_requests')->where('id', $requestId)->first();
    expect(Race::errors($flat))->toBe([])
        ->and(Race::ok($flat))->toHaveCount(1)
        ->and(Race::refusals($flat))->toBe(['approver_already_signed', 'approver_already_signed'])
        ->and($request->status)->toBe('pending')
        ->and($request->second_approver)->toBeNull()
        ->and(DB::table('fiscal_periods')->where('id', $march)->value('reopened_count'))->toBe(0)
        ->and(DB::table('fiscal_periods')->where('id', $march)->value('status'))->toBe('closed')
        ->and(LedgerChecks::problems())->toBe([]);
})->group('concurrency');
