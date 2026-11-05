<?php

declare(strict_types=1);

namespace App\Services\Transfers;

use App\Actions\Transfers\Inputs\FundTransferDraftInput;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalDraft;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Trade\ProposedJournal;
use App\Domain\Transfers\FundTransferFigures;
use App\Domain\Transfers\FundTransferPosting;
use App\Models\Banking\BankAccount;
use App\Models\Ledger\Account;
use App\Models\Organisation\Company;
use App\Models\Transfers\FundTransfer;
use App\Queries\Fx\FindExchangeRate;
use App\Services\Trade\PostingAccountResolver;
use Brick\Math\BigDecimal;
use Brick\Math\RoundingMode;
use DateTimeImmutable;
use Illuminate\Support\Facades\DB;

/** What a fund transfer needs before it posts: the header the draft stores, the figures the rule reads, and the journals. */
final class FundTransferService
{
    public function __construct(
        private readonly FindExchangeRate $rates,
        private readonly PostingAccountResolver $accounts,
    ) {}

    /** @return array<string, mixed> columns of the draft */
    public function header(FundTransferDraftInput $in, Company $company): array
    {
        $from = $this->bank($company, $in->fromBankAccountId, 'from');
        $to = $this->bank($company, $in->toBankAccountId, 'to');
        if ($from->id === $to->id) {
            throw DomainRuleViolation::single('transfer_same_account', 'Choose two different accounts.');
        }
        if ($in->fromAmountFc < 1) {
            throw DomainRuleViolation::single('amount_out_of_range', 'The amount must be positive.');
        }
        if ($in->feeFc < 0 || ($in->feeFc > 0 && $in->feeAccountId === null)) {
            throw DomainRuleViolation::single('transfer_fee_account_missing', 'A fee needs the expense account it is charged to.');
        }
        if ($in->feeAccountId !== null) {
            $fee = Account::query()->where('company_id', $company->id)->whereKey($in->feeAccountId)->first();
            if ($fee === null || ! $fee->is_active || ! $fee->is_postable || $fee->control_type->value !== 'none') {
                throw DomainRuleViolation::single('transfer_fee_account_invalid', 'The fee account must be an active, postable account that is not a control account.');
            }
        }
        $toAmount = $in->toAmountFc ?? ($from->currency === $to->currency ? $in->fromAmountFc : null);
        if ($toAmount === null || $toAmount < 1) {
            throw DomainRuleViolation::single('transfer_received_amount_required', 'State the amount that arrives in the destination currency.');
        }
        $sendRate = $this->rate($company, $from->currency, $in->sendDate->format('Y-m-d'), $in->sendRate);
        $receiveRate = $this->rate($company, $to->currency, $in->sendDate->format('Y-m-d'), $in->receiveRate);
        $amounts = FundTransferPosting::sendAmounts($in->fromAmountFc, $in->feeFc, $sendRate);

        return [
            'from_bank_account_id' => $from->id, 'to_bank_account_id' => $to->id, 'send_date' => $in->sendDate,
            'from_currency' => $from->currency, 'from_amount_fc' => $in->fromAmountFc, 'send_rate' => $sendRate, 'send_base' => $amounts['sendBase'],
            'fee_fc' => $in->feeFc, 'fee_account_id' => $in->feeFc > 0 ? $in->feeAccountId : null,
            'to_currency' => $to->currency, 'to_amount_fc' => $toAmount, 'receive_rate' => $receiveRate,
            'settle_same_day' => $in->settleSameDay, 'reference' => $in->reference, 'memo' => $in->memo,
        ];
    }

    public function rate(Company $company, string $currency, string $date, ?string $given): string
    {
        $base = $company->base_currency;
        if ($currency === $base) {
            return '1';
        }
        $units = DB::table('currencies')->whereIn('code', [$currency, $base])->pluck('minor_unit', 'code');
        if (($units[$currency] ?? null) !== ($units[$base] ?? null)) {
            throw DomainRuleViolation::single('currency_scale_unsupported', "{$currency} and {$base} do not have the same minor units; transfers in {$currency} are not supported yet.");
        }
        if ($given !== null) {
            if (preg_match('/^\d{1,12}(\.\d{1,8})?$/', $given) !== 1 || BigDecimal::of($given)->isZero()) {
                throw DomainRuleViolation::single('fx_rate_invalid', 'The exchange rate must be a positive decimal.');
            }

            return BigDecimal::of($given)->toScale(8, RoundingMode::HalfUp)->__toString();
        }

        return $this->rates->require($company->id, $currency, $base, $date)->rate;
    }

    private function bank(Company $company, string $id, string $side): BankAccount
    {
        $bank = BankAccount::query()->where('company_id', $company->id)->find($id)
            ?? throw DomainRuleViolation::single('not_found', "The {$side} account does not exist.");
        $gl = Account::query()->where('company_id', $company->id)->whereKey($bank->account_id)->first();
        if (! $bank->is_active || ! in_array($bank->kind, ['bank', 'cash'], true) || $gl === null || ! in_array($gl->control_type->value, ['bank', 'cash'], true)) {
            throw DomainRuleViolation::single('transfer_account_invalid', 'Transfers are between active bank or cash accounts of this company.');
        }

        return $bank;
    }

    /** The rule's input; the three posting accounts are required here, with a message that points to Settings → Posting. */
    public function figures(FundTransfer $t, Company $company, ?int $toAmountFc = null, ?string $receiveRate = null): FundTransferFigures
    {
        $from = BankAccount::query()->findOrFail($t->from_bank_account_id);
        $to = BankAccount::query()->findOrFail($t->to_bank_account_id);
        $needsFx = $this->mayNeedFx($t, $company, $toAmountFc, $receiveRate);

        $gain = $needsFx !== 0 ? $this->accounts->required($company, 'fx_realised', 'realised exchange gain') : '';
        $loss = $needsFx < 0 ? ($this->accounts->named($company, 'fx_realised_loss') ?? $gain) : '';

        return new FundTransferFigures(
            $t->id, (string) ($t->number ?? 'Draft'), $t->memo, $t->send_date->format('Y-m-d'), $from->account_id, $to->account_id,
            $from->name, $to->name, $t->from_currency, $t->from_amount_fc, (string) $t->send_rate, $t->fee_fc, $t->fee_account_id,
            $t->to_currency, $toAmountFc ?? $t->to_amount_fc, $receiveRate ?? (string) $t->receive_rate,
            $this->accounts->required($company, 'bank_in_transit', 'funds in transit'), $gain, $loss !== '' ? $loss : $gain,
        );
    }

    /** Sign of the base difference the receive leg will carry (0 when it carries none). */
    private function mayNeedFx(FundTransfer $t, Company $company, ?int $toAmountFc, ?string $receiveRate): int
    {
        $sendBase = FundTransferPosting::sendAmounts($t->from_amount_fc, $t->fee_fc, (string) $t->send_rate)['sendBase'];

        return FundTransferPosting::receiveAmounts($toAmountFc ?? $t->to_amount_fc, $receiveRate ?? (string) $t->receive_rate, $sendBase)['difference'] <=> 0;
    }

    public function sendDraft(FundTransferFigures $f, string $companyId, string $base): JournalDraft
    {
        return $this->toDraft($companyId, FundTransferPosting::send($f, $base), $base);
    }

    public function receiveDraft(FundTransferFigures $f, string $companyId, string $base, string $date): JournalDraft
    {
        return $this->toDraft($companyId, FundTransferPosting::receive($f, $base, $date), $base);
    }

    private function toDraft(string $companyId, ProposedJournal $p, string $base): JournalDraft
    {
        // A transfer leg has one line in a foreign currency at most, so unlike a document it does not balance in foreign
        // currency on its own (D6: only base must balance); DraftMapper's foreign-sum check does not apply.
        $lines = array_map(static function ($l) use ($base): DraftLine {
            $foreign = $l->currency !== $base;

            return new DraftLine(
                accountId: $l->accountRef, debit: $l->debit, credit: $l->credit, currency: $foreign ? $l->currency : null,
                fxRate: $foreign ? $l->fxRate : null, amountFc: $foreign ? $l->amountFc : null, description: $l->description,
            );
        }, $p->lines);

        return new JournalDraft($companyId, $p->journalType, new DateTimeImmutable($p->journalDate), $lines, $p->reference, $p->memo, $p->sourceType, $p->sourceId);
    }

    public function dateOf(FundTransfer $t): DateTimeImmutable
    {
        return DateTimeImmutable::createFromInterface($t->send_date);
    }
}
