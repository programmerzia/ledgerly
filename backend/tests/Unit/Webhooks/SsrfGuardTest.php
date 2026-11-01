<?php

declare(strict_types=1);

use App\Domain\Webhooks\IpClassifier;
use App\Domain\Webhooks\RetrySchedule;
use App\Support\Webhooks\SsrfGuard;
use App\Support\Webhooks\UnsafeWebhookTarget;
use App\Support\Webhooks\WebhookSigner;
use Tests\Support\FakeHostResolver;

/*
 * The SSRF core (13 §15): which addresses are refused, how URLs are judged, and that a name is resolved
 * once and the connection pinned to what was checked.
 */

dataset('addresses', [
    // blocked: IPv4
    ['0.0.0.0', 'unspecified'], ['0.1.2.3', 'unspecified'],
    ['127.0.0.1', 'loopback'], ['127.255.255.254', 'loopback'],
    ['169.254.169.254', 'link_local'], ['169.254.0.1', 'link_local'],
    ['10.0.0.1', 'private'], ['10.255.255.255', 'private'],
    ['172.16.0.1', 'private'], ['172.31.255.255', 'private'],
    ['192.168.1.1', 'private'], ['192.168.255.255', 'private'],
    ['100.64.0.1', 'carrier_grade_nat'], ['100.127.255.255', 'carrier_grade_nat'],
    ['224.0.0.1', 'multicast'], ['239.255.255.255', 'multicast'],
    ['240.0.0.1', 'reserved'], ['255.255.255.255', 'reserved'],
    ['192.0.2.1', 'documentation'], ['198.51.100.7', 'documentation'], ['203.0.113.9', 'documentation'],
    ['198.18.0.1', 'benchmarking'], ['192.0.0.8', 'reserved'],
    // blocked: IPv6
    ['::', 'unspecified'], ['::1', 'unspecified'],
    ['fe80::1', 'link_local'], ['febf::1', 'link_local'],
    ['fc00::1', 'unique_local'], ['fd12:3456:789a::1', 'unique_local'],
    ['ff02::1', 'multicast'], ['ff00::', 'multicast'],
    ['2001:db8::1', 'documentation'], ['2002:7f00:1::1', 'six_to_four'], ['64:ff9b::7f00:1', 'nat64'],
    ['fec0::1', 'reserved'],
    // blocked: IPv4-mapped IPv6 carries the IPv4 verdict
    ['::ffff:127.0.0.1', 'loopback'], ['::ffff:7f00:1', 'loopback'], ['::ffff:10.1.2.3', 'private'],
    ['::ffff:169.254.169.254', 'link_local'], ['::ffff:0.0.0.0', 'unspecified'], ['::ffff:100.64.0.1', 'carrier_grade_nat'],
    // malformed
    ['not-an-ip', 'invalid'], ['', 'invalid'], ['1.2.3', 'invalid'], ['fe80::1%eth0', 'invalid'],
    // public
    ['93.184.216.34', null], ['8.8.8.8', null], ['1.1.1.1', null], ['172.15.255.255', null], ['172.32.0.1', null],
    ['100.63.255.255', null], ['100.128.0.1', null], ['169.253.1.1', null], ['11.0.0.1', null], ['223.255.255.255', null],
    ['2606:4700:4700::1111', null], ['2001:4860:4860::8888', null], ['::ffff:8.8.8.8', null], ['2a00:1450:4001::1', null],
]);

it('classifies addresses', function (string $ip, ?string $reason): void {
    expect(IpClassifier::blockedReason($ip))->toBe($reason)
        ->and(IpClassifier::isPublic($ip))->toBe($reason === null);
})->with('addresses');

function guard(FakeHostResolver $resolver, bool $allowHttp = false): SsrfGuard
{
    return new SsrfGuard($resolver, $allowHttp);
}

dataset('bad urls', [
    ['http://hooks.example.test/x', 'scheme_not_allowed'],
    ['ftp://hooks.example.test/x', 'scheme_not_allowed'],
    ['file:///etc/passwd', 'invalid_url'],
    ['gopher://hooks.example.test/', 'scheme_not_allowed'],
    ['https://user:pw@hooks.example.test/x', 'credentials_in_url'],
    ['https://hooks.example.test:0/x', 'invalid_url'],
    ['https://', 'invalid_url'],
    ['/relative/path', 'invalid_url'],
    ['https://localhost/x', 'local_host'],
    ['https://api.localhost/x', 'local_host'],
    ['https://db.internal/x', 'local_host'],
    ['https://printer.local/x', 'local_host'],
    ['https://2130706433/x', 'invalid_host'],
    ['https://0x7f.0.0.1/x', 'invalid_host'],
    ['https://127.1/x', 'invalid_host'],
    ['https://bad_host.example.test/x', 'invalid_host'],
    ['https://127.0.0.1/x', 'blocked_address'],
    ['https://169.254.169.254/latest/meta-data/', 'blocked_address'],
    ['https://[::1]/x', 'blocked_address'],
    ['https://[::ffff:10.0.0.1]/x', 'blocked_address'],
    ['https://[fd00::1]:8443/x', 'blocked_address'],
]);

it('refuses unsafe URLs before any lookup', function (string $url, string $reason): void {
    $resolver = new FakeHostResolver;
    try {
        guard($resolver)->resolve($url);
        $this->fail('expected the URL to be refused');
    } catch (UnsafeWebhookTarget $e) {
        expect($e->reason)->toBe($reason);
    }
    expect($resolver->lookups)->toBe([]);
})->with('bad urls');

it('allows plain http only when the configuration says so', function (): void {
    $resolver = (new FakeHostResolver)->script('hooks.example.test', [['93.184.216.34']]);

    expect(guard($resolver, allowHttp: true)->resolve('http://hooks.example.test/x')->port)->toBe(80);
    expect(fn () => guard($resolver, allowHttp: false)->resolve('http://hooks.example.test/x'))->toThrow(UnsafeWebhookTarget::class);
});

it('resolves once and pins the connection to the validated address', function (): void {
    $resolver = (new FakeHostResolver)->script('hooks.example.test', [['93.184.216.34', '2606:2800:220:1::1']]);
    $target = guard($resolver)->resolve('https://Hooks.Example.Test.:8443/in?x=1');

    expect($target->host)->toBe('hooks.example.test')
        ->and($target->port)->toBe(8443)
        ->and($target->ip)->toBe('93.184.216.34')
        ->and($target->curlResolve())->toBe('hooks.example.test:8443:93.184.216.34')
        ->and($resolver->lookups['hooks.example.test'])->toBe(1);
});

it('refuses a name when any of its addresses is internal, or when it does not resolve', function (): void {
    $resolver = (new FakeHostResolver)
        ->script('mixed.example.test', [['93.184.216.34', '10.0.0.7']])
        ->script('mapped.example.test', [['::ffff:169.254.169.254']])
        ->script('v6.example.test', [['2606:4700:4700::1111', 'fd00::5']]);

    foreach (['mixed', 'mapped', 'v6'] as $name) {
        expect(fn () => guard($resolver)->resolve("https://{$name}.example.test/"))->toThrow(UnsafeWebhookTarget::class, 'resolves to');
    }
    expect(fn () => guard($resolver)->resolve('https://nowhere.example.test/'))->toThrow(UnsafeWebhookTarget::class, 'does not resolve');
});

it('signs "t.body" with HMAC-SHA256 and verifies, rejecting tampering, wrong secrets and stale timestamps', function (): void {
    $body = '{"event_id":"e1"}';
    $header = WebhookSigner::header('whsec_abc', 1_700_000_000, $body);

    expect($header)->toBe('t=1700000000,v1='.hash_hmac('sha256', '1700000000.'.$body, 'whsec_abc'))
        ->and(WebhookSigner::verify($header, $body, 'whsec_abc', 1_700_000_100))->toBeTrue()
        ->and(WebhookSigner::verify($header, $body.' ', 'whsec_abc', 1_700_000_100))->toBeFalse()
        ->and(WebhookSigner::verify($header, $body, 'whsec_other', 1_700_000_100))->toBeFalse()
        ->and(WebhookSigner::verify($header, $body, 'whsec_abc', 1_700_000_000 + 301))->toBeFalse()
        ->and(WebhookSigner::verify('t=1700000000,v1=00', $body, 'whsec_abc', 1_700_000_000))->toBeFalse()
        ->and(WebhookSigner::verify('v1='.substr($header, -64), $body, 'whsec_abc', 1_700_000_000))->toBeFalse()
        ->and(WebhookSigner::verify('garbage', $body, 'whsec_abc', 1_700_000_000))->toBeFalse();
    // A replay under a fresh timestamp does not verify: t is part of the signed text.
    $replayed = 't=1700000200,v1='.substr($header, -64);
    expect(WebhookSigner::verify($replayed, $body, 'whsec_abc', 1_700_000_200))->toBeFalse();
});

it('backs off exponentially with jitter, caps each wait, and lands the last attempt on the window end', function (): void {
    $start = new DateTimeImmutable('2026-03-15 10:00:00');
    $window = 86_400;

    expect(array_map(RetrySchedule::baseDelay(...), [1, 2, 3, 4, 8, 9, 30]))->toBe([60, 120, 240, 480, 7_680, 14_400, 14_400]);

    $at = fn (int $attempts, float $jitter, string $now = '2026-03-15 10:00:00') => RetrySchedule::nextAttempt($start, new DateTimeImmutable($now), $attempts, $window, $jitter);
    expect($at(1, 0.5)->format('H:i:s'))->toBe('10:01:00')
        ->and($at(1, 0.0)->format('H:i:s'))->toBe('10:00:48')
        ->and($at(1, 0.999)->format('H:i:s'))->toBe('10:01:12')
        ->and($at(3, 0.5)->format('H:i:s'))->toBe('10:04:00');

    // Close to the end the wait is cut to the deadline; at or after it there is no further attempt.
    expect($at(9, 0.5, '2026-03-16 08:00:00')->format('Y-m-d H:i:s'))->toBe('2026-03-16 10:00:00')
        ->and($at(9, 0.5, '2026-03-16 10:00:00'))->toBeNull()
        ->and($at(9, 0.5, '2026-03-17 00:00:00'))->toBeNull();
});
