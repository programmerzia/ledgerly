<?php

declare(strict_types=1);

namespace App\Support\Webhooks;

use App\Contracts\HostResolver;
use App\Domain\Webhooks\IpClassifier;

/**
 * The webhook SSRF guard (13 §15). `assertShape` checks the URL alone (at save time); `resolve` is
 * the delivery-time check: it resolves the host once, requires every returned address to be public
 * and hands back one of them as the pinned connection target, so DNS rebinding between check and
 * connect cannot swap it. Redirects are never followed (WebhookSender), so a redirect cannot reach
 * a second, unchecked address either.
 */
final class SsrfGuard
{
    private const string HOSTNAME = '/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/';

    public function __construct(private readonly HostResolver $resolver, private readonly bool $allowHttp) {}

    /**
     * @return array{scheme: string, host: string, port: int, literal: bool}
     *
     * @throws UnsafeWebhookTarget
     */
    public function assertShape(string $url): array
    {
        $parts = parse_url($url);
        if ($parts === false || ! isset($parts['scheme'], $parts['host'])) {
            throw new UnsafeWebhookTarget('invalid_url', 'The URL is not valid.');
        }
        $scheme = strtolower($parts['scheme']);
        if ($scheme !== 'https' && ! ($scheme === 'http' && $this->allowHttp)) {
            throw new UnsafeWebhookTarget('scheme_not_allowed', 'Webhook URLs must use https.');
        }
        if (isset($parts['user']) || isset($parts['pass'])) {
            throw new UnsafeWebhookTarget('credentials_in_url', 'The URL must not contain a username or password.');
        }
        $port = $parts['port'] ?? ($scheme === 'https' ? 443 : 80);
        if ($port < 1) { // parse_url already refuses anything above 65535
            throw new UnsafeWebhookTarget('invalid_url', 'The port is not valid.');
        }

        $host = strtolower(rtrim(trim($parts['host'], '[]'), '.'));
        if ($host === '') {
            throw new UnsafeWebhookTarget('invalid_url', 'The URL has no host.');
        }
        if (inet_pton($host) !== false) {
            $reason = IpClassifier::blockedReason($host);
            if ($reason !== null) {
                throw new UnsafeWebhookTarget('blocked_address', "The address is a {$reason} address.");
            }

            return ['scheme' => $scheme, 'host' => $host, 'port' => $port, 'literal' => true];
        }
        // Not an IP literal. Forms like 2130706433, 0x7f.1 or 127.1 are IPs to a libc resolver but not to
        // inet_pton, so a host made only of digits, dots and hex is refused rather than looked up.
        if (preg_match('/^[0-9a-fx.]+$/', $host) === 1 && preg_match('/[0-9]/', $host) === 1) {
            throw new UnsafeWebhookTarget('invalid_host', 'The host is not a valid name or address.');
        }
        if (preg_match(self::HOSTNAME, $host) !== 1) {
            throw new UnsafeWebhookTarget('invalid_host', 'The host is not a valid name or address.');
        }
        if ($host === 'localhost' || str_ends_with($host, '.localhost') || str_ends_with($host, '.local') || str_ends_with($host, '.internal')) {
            throw new UnsafeWebhookTarget('local_host', 'The host is a local name.');
        }

        return ['scheme' => $scheme, 'host' => $host, 'port' => $port, 'literal' => false];
    }

    /** @throws UnsafeWebhookTarget */
    public function resolve(string $url): GuardedTarget
    {
        $shape = $this->assertShape($url);
        $addresses = $shape['literal'] ? [$shape['host']] : $this->resolver->resolve($shape['host']);
        if ($addresses === []) {
            throw new UnsafeWebhookTarget('unresolvable', 'The host does not resolve.');
        }
        // One bad answer poisons the lot: a name that also points inside must never be contacted.
        foreach ($addresses as $address) {
            $reason = IpClassifier::blockedReason($address);
            if ($reason !== null) {
                throw new UnsafeWebhookTarget('blocked_address', "The host resolves to a {$reason} address.");
            }
        }

        return new GuardedTarget($url, $shape['scheme'], $shape['host'], $shape['port'], $addresses[0]);
    }
}
