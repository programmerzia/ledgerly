<?php

declare(strict_types=1);

use Illuminate\Support\Facades\DB;

beforeEach(function (): void {
    $this->setUpTrade();
    $this->admin = $this->person('Ada Admin', [], org: 'admin');
});

it('shows the profile and only the companies the person can open', function (): void {
    $beta = $this->secondCompany();
    $org = $this->asPerson($this->admin)->getJson('/api/v1/organisation')->assertOk()->json('data');
    expect($org['slug'])->toBe('acme')->and($org['members'])->toBeGreaterThanOrEqual(5)->and($org['can']['update'])->toBeTrue()
        ->and(collect($org['companies'])->pluck('id')->all())->toContain($this->f->companyId, $beta->id);

    // An accountant of company A alone sees company A and cannot rename.
    $mine = $this->asPerson($this->accountant)->getJson('/api/v1/organisation')->assertOk()->json('data');
    expect($mine['can']['update'])->toBeFalse()->and(collect($mine['companies'])->pluck('id')->all())->toBe([$this->f->companyId]);
});

it('renames the organisation, audited, for owners and admins only', function (): void {
    $this->asPerson($this->accountant)->putJson('/api/v1/organisation', ['name' => 'Hacked'], $this->key())->assertForbidden();
    $this->asToken($this->newToken(['contacts:read']))->putJson('/api/v1/organisation', ['name' => 'Hacked'], $this->key())->assertForbidden();

    $this->asPerson($this->admin)->putJson('/api/v1/organisation', ['name' => '  Acme   Holdings '], $this->key())
        ->assertOk()->assertJsonPath('data.name', 'Acme Holdings')->assertJsonPath('data.slug', 'acme');
    $this->putJson('/api/v1/organisation', ['name' => ''], $this->key())->assertStatus(422);
    $this->putJson('/api/v1/organisation', ['name' => str_repeat('x', 121)], $this->key())->assertStatus(422);

    $event = $this->inTenant(fn () => DB::table('audit_events')->where('action', 'organisation.renamed')->first());
    expect(json_decode((string) $event->after, true))->toBe(['name' => 'Acme Holdings'])->and(json_decode((string) $event->before, true)['name'])->not->toBe('Acme Holdings');
});
