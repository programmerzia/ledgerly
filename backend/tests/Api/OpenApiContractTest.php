<?php

declare(strict_types=1);

use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\File;

/*
 * `make types` and the contract workflow run `scramble:export --fail-on-unknown`. A route whose
 * request or response Scramble cannot type fails here first, with the offending route in the output.
 */
it('exports the OpenAPI document without unknown types', function (): void {
    $path = sys_get_temp_dir().'/openapi-contract-'.getmypid().'.json';

    try {
        $exit = Artisan::call('scramble:export', ['--path' => $path, '--fail-on-unknown' => true]);
        $output = Artisan::output();
        $document = json_decode((string) file_get_contents($path), true, flags: JSON_THROW_ON_ERROR);
    } finally {
        File::delete($path);
    }

    expect($exit)->toBe(0, $output)
        ->and($output)->not->toContain('UnknownType')
        ->and($document)->toHaveKey('paths');

    // The two Fortify endpoints are documented by hand: login states both outcomes.
    expect($document['paths']['/v1/auth/login']['post']['responses']['200']['content']['application/json']['schema']['properties'])
        ->toHaveKey('two_factor');
});
