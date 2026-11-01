<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Models\Platform\User;

/** HTTP helpers for the sales and purchase tests; used with MakesApiCalls (the world, people, tokens). */
trait TradeApi
{
    public TradeFixture $t;

    public User $accountant;

    public User $approver;

    public User $owner;

    public User $assistant;

    /** The world plus the trade fixture and one person per role that matters. */
    protected function setUpTrade(): void
    {
        $this->setUpWorld();
        $this->t = TradeFixture::prepare($this->f);
        $this->accountant = $this->person('Ann Accountant', ['Accountant']);
        $this->approver = $this->person('Abe Approver', ['Approver']);
        $this->owner = $this->person('Olga Owner', ['Owner']);
        $this->assistant = $this->person('Sam Sales', ['Sales Assistant']);
    }

    /** Creates a draft as $by (the accountant) and answers its JSON.
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    protected function draftDoc(string $path, array $body, ?User $by = null): array
    {
        return $this->asPerson($by ?? $this->accountant)->postJson($this->api($path), $body, $this->key())->assertCreated()->json('data');
    }

    /**
     * Submits as $by with a signing grant; with no workflow the document posts.
     *
     * @return array<string, mixed>
     */
    protected function submitDoc(string $path, string $id, ?User $by = null): array
    {
        return $this->asPerson($by ?? $this->accountant, signing: true)->postJson($this->api("{$path}/{$id}/submit"), [], $this->key())->assertOk()->json('data');
    }

    /**
     * Draft and post in one go.
     *
     * @param  array<string, mixed>  $body
     * @return array<string, mixed>
     */
    protected function postedDoc(string $path, array $body, ?User $by = null): array
    {
        $doc = $this->draftDoc($path, $body, $by);

        return $this->submitDoc($path, $doc['id'], $by);
    }

    /** One approver step for every document of $type. */
    protected function workflow(string $type): void
    {
        $this->asPerson($this->owner)->postJson($this->api('approval-workflows'), [
            'document_type' => $type, 'name' => "All {$type}s", 'source' => 'any', 'min_amount' => 0, 'steps' => [['role' => 'Approver']],
        ], $this->key())->assertCreated();
    }
}
