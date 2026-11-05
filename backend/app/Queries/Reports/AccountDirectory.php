<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Support\Reports\ReportRunner;

/** Every account of the company, including deactivated ones: old postings still belong to them. */
final class AccountDirectory
{
    /** @var array<string, array<string, AccountInfo>> */
    private array $cache = [];

    public function __construct(private readonly ReportRunner $runner) {}

    /** @return array<string, AccountInfo> id → account, ordered by code */
    public function all(string $companyId): array
    {
        if (isset($this->cache[$companyId])) {
            return $this->cache[$companyId];
        }
        $out = [];
        $rows = $this->runner->db()->select(
            'SELECT id, code, name, account_type, account_subtype, normal_balance, control_type, reporting_tags, is_postable, ifrs_element FROM accounts WHERE company_id = ? ORDER BY code',
            [$companyId],
        );
        foreach ($rows as $r) {
            $tags = json_decode((string) $r->reporting_tags, true);
            $out[(string) $r->id] = new AccountInfo(
                (string) $r->id, (string) $r->code, (string) $r->name, (string) $r->account_type,
                $r->account_subtype === null ? null : (string) $r->account_subtype,
                (string) $r->normal_balance, (string) $r->control_type,
                is_array($tags) ? array_values(array_filter($tags, 'is_string')) : [],
                (bool) $r->is_postable,
                $r->ifrs_element === null ? null : (string) $r->ifrs_element,
            );
        }

        return $this->cache[$companyId] = $out;
    }

    public function find(string $companyId, string $accountId): ?AccountInfo
    {
        return $this->all($companyId)[$accountId] ?? null;
    }
}
