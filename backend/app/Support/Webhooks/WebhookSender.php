<?php

declare(strict_types=1);

namespace App\Support\Webhooks;

use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Throwable;

/**
 * The one HTTP call of a delivery (13 §15). It connects only to the address the guard validated (curl
 * CURLOPT_RESOLVE pin), follows no redirects, ignores proxy environment variables, speaks only http(s), has
 * short timeouts, and reads at most `snippet_bytes` of the response. Never called inside a transaction.
 */
final class WebhookSender
{
    /** @param array<string, string> $headers */
    public function send(GuardedTarget $target, string $body, array $headers): SendResult
    {
        $curl = [
            CURLOPT_PROTOCOLS => CURLPROTO_HTTPS | CURLPROTO_HTTP,
            CURLOPT_REDIR_PROTOCOLS => 0,
            CURLOPT_PROXY => '',
        ];
        if (! $target->isLiteral()) {
            $curl[CURLOPT_RESOLVE] = [$target->curlResolve()];
        }

        try {
            $response = Http::withOptions([
                'allow_redirects' => false,
                'stream' => true,
                'proxy' => '',
                'curl' => $curl,
            ])
                ->connectTimeout((int) config('webhooks.connect_timeout'))
                ->timeout((int) config('webhooks.timeout'))
                ->withHeaders($headers)
                ->withBody($body, 'application/json')
                ->post($target->url);
            $status = $response->status();
            $snippet = $this->snippet($response->toPsrResponse()->getBody()->read((int) config('webhooks.snippet_bytes')));
        } catch (ConnectionException $e) {
            return SendResult::failed(str_contains(strtolower($e->getMessage()), 'timed out') ? 'timeout' : 'connection_failed');
        } catch (Throwable) {
            return SendResult::failed('send_failed');
        }

        return new SendResult($status, $snippet, null);
    }

    private function snippet(string $raw): ?string
    {
        $clean = trim(str_replace("\0", '', mb_scrub($raw, 'UTF-8')));

        return $clean === '' ? null : $clean;
    }
}
