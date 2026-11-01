<?php

declare(strict_types=1);

namespace App\Queries\Reports;

use App\Http\Support\Json;
use App\Models\Ledger\JournalLine;
use App\Support\Reports\Dates;
use Illuminate\Validation\ValidationException;

/**
 * General ledger detail for one account: opening balance, the lines of the range (all journal types, closing
 * included, because this is the ledger itself) and the closing balance. The balance is in the account's own
 * direction, like the balance sheet. Lines are paged by the controller; this class gives it the filter, the
 * header and the balance a page starts from.
 */
final class GeneralLedger
{
    public const string OPEN_END = '9999-12-31';

    public function __construct(
        private readonly LedgerBalances $balances,
        private readonly LedgerLines $lines,
        private readonly AccountDirectory $accounts,
    ) {}

    public function filter(ReportParams $p): LineFilter
    {
        return new LineFilter($p->companyId, $this->account($p)->id, $p->from, $p->to === self::OPEN_END ? null : $p->to, false, $p->dims);
    }

    /** @return array<string, mixed> */
    public function header(ReportParams $p): array
    {
        $account = $this->account($p);
        $cur = $p->currency;
        $opening = $this->opening($p, $account);
        $sum = $this->lines->summary($this->filter($p));
        $movement = $account->natural($sum['debit'], $sum['credit']);

        return [
            'report' => 'general_ledger',
            'currency' => $cur,
            'account' => $account->ref() + ['account_type' => $account->type, 'subtype' => $account->subtype],
            'from' => $p->from,
            'to' => $p->to === self::OPEN_END ? null : $p->to,
            'opening_balance' => Json::money($opening, $cur),
            'summary' => [
                'debit' => Json::money($sum['debit'], $cur), 'credit' => Json::money($sum['credit'], $cur), 'line_count' => $sum['count'],
            ],
            'closing_balance' => Json::money($opening + $movement, $cur),
        ];
    }

    /** The balance just before the first line of a page, so each page's running balance continues the last. */
    public function balanceBefore(ReportParams $p, JournalLine $first): int
    {
        $account = $this->account($p);
        $before = $this->filter($p)->withBefore([(string) $first->getAttribute('journal_date'), (string) $first->getKey()]);
        $sum = $this->lines->summary($before);

        return $this->opening($p, $account) + $account->natural($sum['debit'], $sum['credit']);
    }

    public function account(ReportParams $p): AccountInfo
    {
        return ($p->accountId === null ? null : $this->accounts->find($p->companyId, $p->accountId))
            ?? throw ValidationException::withMessages(['account_id' => ['Give the account of this company.']]);
    }

    private function opening(ReportParams $p, AccountInfo $account): int
    {
        if ($p->from === null) {
            return 0;
        }
        $sum = 0;
        foreach ($this->balances->totals($p->companyId, null, Dates::before($p->from), false, $p->dims, accountIds: [$account->id]) as $row) {
            $sum += $account->natural($row->debit, $row->credit);
        }

        return $sum;
    }
}
