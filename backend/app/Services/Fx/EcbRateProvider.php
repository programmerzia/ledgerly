<?php

declare(strict_types=1);

namespace App\Services\Fx;

use App\Contracts\ExchangeRateProvider;
use App\Domain\Fx\ProviderRates;
use App\Support\Fx\RateProviderFailed;
use Brick\Math\BigDecimal;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Factory as Http;
use Illuminate\Http\Client\RequestException;
use SimpleXMLElement;

/**
 * ECB euro foreign exchange reference rates (daily XML, EUR-based: units of currency per 1 EUR). Rates stay
 * exact decimal strings; cross rates are derived from them by Domain\Fx\CrossRates.
 */
final class EcbRateProvider implements ExchangeRateProvider
{
    private const string NAMESPACE = 'http://www.ecb.int/vocabulary/2002-08-01/eurofxref';

    public function __construct(private readonly Http $http) {}

    public function name(): string
    {
        return 'ecb';
    }

    public function latest(): ProviderRates
    {
        try {
            $body = $this->http->timeout(10)->retry(2, 250, throw: false)->get((string) config('services.ecb.url'))->throw()->body();
        } catch (ConnectionException|RequestException $e) {
            throw new RateProviderFailed('The ECB feed could not be fetched: '.$e->getMessage(), 0, $e);
        }

        return self::parse($body);
    }

    /** @throws RateProviderFailed */
    public static function parse(string $xml): ProviderRates
    {
        $previous = libxml_use_internal_errors(true);
        try {
            $doc = simplexml_load_string($xml, SimpleXMLElement::class, LIBXML_NONET | LIBXML_NOERROR | LIBXML_NOWARNING);
        } finally {
            libxml_clear_errors();
            libxml_use_internal_errors($previous);
        }
        if ($doc === false) {
            throw new RateProviderFailed('The ECB feed is not valid XML.');
        }

        $doc->registerXPathNamespace('e', self::NAMESPACE);
        $days = $doc->xpath('//e:Cube[@time]');
        if (! is_array($days) || $days === []) {
            throw new RateProviderFailed('The ECB feed carries no rate date.');
        }
        $day = $days[0];
        $date = (string) $day['time'];
        if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $date) !== 1) {
            throw new RateProviderFailed('The ECB feed carries no rate date.');
        }

        $rates = [];
        foreach ($day->children(self::NAMESPACE) as $cube) {
            $attributes = $cube->attributes();
            $currency = (string) ($attributes['currency'] ?? '');
            $rate = (string) ($attributes['rate'] ?? '');
            if (preg_match('/^[A-Z]{3}$/', $currency) !== 1 || preg_match('/^\d+(\.\d+)?$/', $rate) !== 1 || ! BigDecimal::of($rate)->isPositive()) {
                continue;
            }
            $rates[$currency] = $rate;
        }
        if ($rates === []) {
            throw new RateProviderFailed('The ECB feed carries no rates.');
        }

        return new ProviderRates($date, 'EUR', $rates);
    }
}
