<?php

declare(strict_types=1);

namespace App\Support\Webhooks;

use App\Contracts\HostResolver;

/** The system resolver: A and AAAA records, nothing cached here. */
final class DnsHostResolver implements HostResolver
{
    public function resolve(string $host): array
    {
        $records = @dns_get_record($host.'.', DNS_A | DNS_AAAA);
        if ($records === false) {
            return [];
        }
        $ips = [];
        foreach ($records as $record) {
            $ip = $record['ip'] ?? $record['ipv6'] ?? null;
            if (is_string($ip)) {
                $ips[] = $ip;
            }
        }

        return array_values(array_unique($ips));
    }
}
