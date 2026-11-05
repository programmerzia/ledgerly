<?php

declare(strict_types=1);

/*
 * A custom role is only a set of rights to try. It never overrides maker ≠ checker or the period rules, which the Policies and Actions
 * check at the moment of the act (13 §7, plan 3c.25).
 */

beforeEach(function (): void {
    $this->setUpTrade();
    $this->boss = $this->person('Bea Boss', ['Owner'], org: 'admin');
    $this->superRole = $this->asPerson($this->boss)->postJson($this->api('roles'), [
        'name' => 'Everything journals',
        'permissions' => [
            'journals.view', 'journals.create', 'journals.submit', 'journals.approve', 'journals.reverse',
            'periods.view', 'periods.close', 'periods.reopen.approve', 'periods.post_soft_closed', 'periods.post_adjustment', 'settings.manage',
        ],
    ], $this->key())->assertCreated()->json('data');
    $this->maker = $this->person('Max Maker', []);
    $this->putJson($this->api("members/{$this->maker->id}/roles/{$this->superRole['id']}"), [], $this->key())->assertOk();
});

it('does not let a role with every journal right approve the journal its holder made', function (): void {
    $this->asPerson($this->owner)->postJson($this->api('approval-workflows'), [
        'document_type' => 'journal', 'name' => 'All', 'source' => 'any', 'min_amount' => 0, 'steps' => [['role' => 'Everything journals']],
    ], $this->key())->assertCreated();

    $id = $this->asPerson($this->maker, signing: true)->postJson($this->api('journals'), $this->journalBody(), $this->key())->assertCreated()->json('data.id');
    $this->postJson($this->api("journals/{$id}/submit"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'pending_approval');
    $this->postJson($this->api("journals/{$id}/approve"), [], $this->key())->assertForbidden();
    $this->getJson($this->api("journals/{$id}"))->assertJsonPath('data.can.approve', false)->assertJsonPath('data.status', 'pending_approval');

    // A second holder of the same role can: the rule is about who made it, not about the role.
    $other = $this->person('Olly Other', []);
    $this->asPerson($this->boss)->putJson($this->api("members/{$other->id}/roles/{$this->superRole['id']}"), [], $this->key())->assertOk();
    $this->asPerson($other, signing: true)->postJson($this->api("journals/{$id}/approve"), [], $this->key())->assertOk()->assertJsonPath('data.status', 'posted');
});

it('does not let a role with every period right post into a closed period', function (): void {
    $jan = $this->inTenant(fn () => $this->f->period('2026-01-15')->id);
    // The role may close the period (periods.close); once closed, nobody posts into it, whatever the role holds.
    $this->asPerson($this->maker, signing: true)->postJson($this->api("fiscal-periods/{$jan}/close"), ['waivers' => ['DRAFTS' => 'none open']], $this->key())
        ->assertOk()->assertJsonPath('data.status', 'closed');

    $id = $this->asPerson($this->maker, signing: true)->postJson($this->api('journals'), $this->journalBody(1000, '2026-01-21'), $this->key())->assertCreated()->json('data.id');
    $this->postJson($this->api("journals/{$id}/submit"), [], $this->key())->assertStatus(422)->assertJson(['code' => 'period_closed']);
});
