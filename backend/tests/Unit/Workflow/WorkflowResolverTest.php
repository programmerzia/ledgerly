<?php

declare(strict_types=1);

use App\Domain\Workflow\ApprovalStep;
use App\Domain\Workflow\DocumentSource;
use App\Domain\Workflow\WorkflowDefinition;
use App\Domain\Workflow\WorkflowResolver;

function wf(string $id, ?DocumentSource $source, int $min, ?int $max, string $type = 'journal'): WorkflowDefinition
{
    return new WorkflowDefinition($id, $type, $source, $min, $max, [new ApprovalStep('Approver')]);
}

it('applies no workflow below every threshold and the matching band above it', function (): void {
    $flows = [wf('small', null, 200_000, 5_000_000), wf('large', null, 5_000_000, null)];

    expect(WorkflowResolver::resolve($flows, 'journal', DocumentSource::User, 150_000))->toBeNull()
        ->and(WorkflowResolver::resolve($flows, 'journal', DocumentSource::User, 200_000)?->id)->toBe('small')
        ->and(WorkflowResolver::resolve($flows, 'journal', DocumentSource::User, 4_999_999)?->id)->toBe('small')
        ->and(WorkflowResolver::resolve($flows, 'journal', DocumentSource::User, 5_000_000)?->id)->toBe('large')
        ->and(WorkflowResolver::resolve($flows, 'invoice', DocumentSource::User, 9_000_000))->toBeNull();
});

it('prefers an exact source over "any", then the narrowest band', function (): void {
    $flows = [wf('any', null, 0, null), wf('api', DocumentSource::Api, 0, null), wf('any-high', null, 1_000_000, null)];

    expect(WorkflowResolver::resolve($flows, 'journal', DocumentSource::Api, 10)?->id)->toBe('api')
        ->and(WorkflowResolver::resolve($flows, 'journal', DocumentSource::User, 10)?->id)->toBe('any')
        ->and(WorkflowResolver::resolve($flows, 'journal', DocumentSource::User, 2_000_000)?->id)->toBe('any-high');
});

it('rejects a step without approvers', function (): void {
    expect(fn () => new ApprovalStep('Approver', 0))->toThrow(InvalidArgumentException::class);
});
