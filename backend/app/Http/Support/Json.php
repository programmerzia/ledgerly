<?php

declare(strict_types=1);

namespace App\Http\Support;

use App\Models\Organisation\Company;
use DateTimeInterface;
use Illuminate\Contracts\Auth\Access\Authorizable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Http\Request;

/** The wire formats of 13 §16, in one place: money, dates and timestamps. */
final class Json
{
    /** @return array{amount: int, currency: string} integer minor units */
    public static function money(int $amount, string $currency): array
    {
        return ['amount' => $amount, 'currency' => $currency];
    }

    /** YYYY-MM-DD */
    public static function date(?DateTimeInterface $date): ?string
    {
        return $date?->format('Y-m-d');
    }

    /** RFC 3339 in UTC. */
    public static function time(?DateTimeInterface $time): ?string
    {
        return $time === null ? null : \DateTimeImmutable::createFromInterface($time)->setTimezone(new \DateTimeZone('UTC'))->format('Y-m-d\TH:i:s\Z');
    }

    /** The request's company (set by ResolveCompany). */
    public static function company(Request $request): Company
    {
        $company = $request->route('company');

        return $company instanceof Company ? $company : throw new \LogicException('Not a company route.');
    }

    /** The base currency of the request's company: journals and accounts are in it (13 §16 money). */
    public static function baseCurrency(Request $request): string
    {
        return self::company($request)->base_currency;
    }

    /**
     * The `can` hints (13 §7): what the signed-in principal may do with this record, from the policies.
     * Keys are the names the client sees, values the policy abilities.
     *
     * @param  array<string, string>  $abilities
     * @return array<string, bool>
     */
    public static function can(Request $request, Model $subject, array $abilities): array
    {
        $principal = call_user_func($request->getUserResolver());

        return array_map(
            fn (string $ability): bool => $principal instanceof Authorizable && $principal->can($ability, $subject),
            $abilities,
        );
    }
}
