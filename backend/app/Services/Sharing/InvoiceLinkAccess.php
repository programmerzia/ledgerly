<?php

declare(strict_types=1);

namespace App\Services\Sharing;

use App\Contracts\Clock;
use App\Contracts\IdGenerator;
use App\Domain\Documents\ShareToken;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\InvoiceKind;
use App\Domain\Workflow\DocumentStatus;
use App\Http\Middleware\ResolveTenant;
use App\Models\Organisation\Company;
use App\Models\Platform\Tenant;
use App\Models\Sharing\InvoiceShareLink;
use App\Models\Trade\Invoice;
use App\Support\Tenancy\TenantContext;
use Closure;
use Illuminate\Support\Facades\DB;

/**
 * THE SECURITY-SENSITIVE PART of the online invoice link (plan 3c.7b): how a link is made and how a stranger's token becomes access to
 * exactly one invoice. Read this class and nothing else to review the public page's access control.
 *
 *  - A token is 256 random bits ({@see ShareToken}); only its SHA-256 is stored, so a leaked database does not leak working links.
 *  - `open()` is the only way in. A malformed token never reaches the database. A well-formed one is hashed and looked up through
 *    `sysops.invoice_link_by_token_hash`, which returns a link id and a tenant id and nothing else: that is the one place row-level
 *    security is stepped around, and it is a single row by a unique hash. From there everything is read INSIDE that tenant's
 *    context with RLS on, by the link's own ids: the link, then its one invoice in its own company. Nothing else is reachable.
 *  - Every refusal is the same `null`: unknown token, revoked, expired, tenant closed, company inactive, or an invoice that is not a
 *    sales invoice (only posted or reversed ones are shown; a draft or voided one never is). The caller answers all of them alike,
 *    so the page cannot be used to tell which tokens ever existed.
 *  - The callback runs inside the tenant context; nothing it returns carries the context out of it.
 *  - `issue()` makes a link only for a posted sales invoice and returns the raw token once; it is not recoverable afterwards.
 */
final class InvoiceLinkAccess
{
    /** Longest an expiry may be set, in days. */
    public const int MAX_EXPIRY_DAYS = 365;

    public function __construct(private readonly Clock $clock, private readonly IdGenerator $ids, private readonly TenantContext $tenant) {}

    /**
     * @return array{link: InvoiceShareLink, token: string}
     */
    public function issue(string $tenantId, Invoice $invoice, string $channel, ?string $createdBy, ?int $expiresInDays): array
    {
        if ($invoice->kind !== InvoiceKind::SalesInvoice || $invoice->status !== DocumentStatus::Posted) {
            throw DomainRuleViolation::single('link_not_available', 'An online link can only be made for a posted invoice.');
        }
        if ($expiresInDays !== null && ($expiresInDays < 1 || $expiresInDays > self::MAX_EXPIRY_DAYS)) {
            throw DomainRuleViolation::single('link_expiry_invalid', 'A link can last from 1 to '.self::MAX_EXPIRY_DAYS.' days.');
        }
        $token = ShareToken::generate();
        $now = $this->clock->now();
        $link = new InvoiceShareLink;
        $link->forceFill([
            'id' => $this->ids->next(), 'tenant_id' => $tenantId, 'company_id' => $invoice->company_id, 'invoice_id' => $invoice->id,
            'token_hash' => ShareToken::hash($token), 'channel' => $channel, 'created_by' => $createdBy,
            'expires_at' => $expiresInDays === null ? null : $now->modify("+{$expiresInDays} days"),
            'created_at' => $now, 'updated_at' => $now,
        ])->save();

        return ['link' => $link->refresh(), 'token' => $token];
    }

    /**
     * The stored copy of a sent message with any online link in it blanked: the log keeps what was said, not a working address
     * (only the token's hash is stored anywhere, and the send log must not undo that). Called once the mail has gone or failed.
     *
     * @return array{subject: string, body: string}
     */
    public static function scrubbed(string $subject, string $body): array
    {
        $pattern = '~'.preg_quote(rtrim((string) config('app.frontend_url'), '/'), '~').'/i/[A-Za-z0-9_-]{'.ShareToken::LENGTH.'}~';

        return ['subject' => (string) preg_replace($pattern, '[online link]', $subject), 'body' => (string) preg_replace($pattern, '[online link]', $body)];
    }

    /** The address a customer opens: the SPA's public page. The token is the only thing in it; no tenant, company or invoice id. */
    public function url(string $token): string
    {
        return rtrim((string) config('app.frontend_url'), '/').'/i/'.$token;
    }

    /**
     * Runs $use with the link, its one invoice and its company, inside the link's tenant. Null when the token gives access to nothing.
     *
     * @template T
     *
     * @param  Closure(OpenedInvoiceLink): T  $use
     * @return T|null
     */
    public function open(string $token, Closure $use): mixed
    {
        if (! ShareToken::wellFormed($token) || $this->tenant->id() !== null) {
            return null;
        }
        $found = DB::selectOne('SELECT link_id, tenant_id FROM sysops.invoice_link_by_token_hash(?)', [ShareToken::hash($token)]);
        if ($found === null) {
            return null;
        }
        $row = (array) $found;
        $tenant = Tenant::query()->find((string) $row['tenant_id']);
        if ($tenant === null || in_array($tenant->lifecycle, ResolveTenant::CLOSED_LIFECYCLES, true)) {
            return null;
        }

        return $this->tenant->run($tenant->id, function () use ($row, $use) {
            $link = InvoiceShareLink::query()->find((string) $row['link_id']);
            if ($link === null || $link->statusAt($this->clock->now()) !== 'active') {
                return null;
            }
            $invoice = Invoice::query()->where('company_id', $link->company_id)->whereKey($link->invoice_id)
                ->where('kind', InvoiceKind::SalesInvoice->value)->whereIn('status', [DocumentStatus::Posted->value, DocumentStatus::Reversed->value])->first();
            $company = Company::query()->whereKey($link->company_id)->where('status', 'active')->first();
            if ($invoice === null || $company === null) {
                return null;
            }

            return $use(new OpenedInvoiceLink($link, $invoice, $company));
        });
    }
}
