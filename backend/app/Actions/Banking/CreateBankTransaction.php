<?php

declare(strict_types=1);

namespace App\Actions\Banking;

use App\Actions\Banking\Inputs\BankTransactionInput;
use App\Actions\Ledger\CreateJournalDraft;
use App\Actions\Ledger\Inputs\JournalDraftInput;
use App\Actions\Ledger\SetupGuard;
use App\Actions\Workflow\Inputs\DocumentRef;
use App\Actions\Workflow\SubmitDocument;
use App\Contracts\IdGenerator;
use App\Domain\Banking\BankTransactionPosting;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalType;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Workflow\DocumentSource;
use App\Domain\Workflow\WorkflowResolver;
use App\Events\Banking\BankTransactionCreated;
use App\Models\Banking\BankAccount;
use App\Models\Banking\BankRule;
use App\Models\Banking\BankStatementLine;
use App\Models\Banking\BankTransaction;
use App\Models\Ledger\Account;
use App\Models\Ledger\Journal;
use App\Models\Organisation\Company;
use App\Models\Organisation\CompanySettings;
use App\Models\Tax\TaxCode;
use App\Models\Trade\Contact;
use App\Models\Workflow\ApprovalWorkflow;
use App\Queries\Tax\TaxRateResolver;
use App\Services\Banking\BankLineState;
use App\Services\Trade\PostingAccountResolver;
use App\Services\Trade\SettlementWriter;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use DateTimeImmutable;
use Illuminate\Database\DatabaseManager;

/**
 * Codes an unmatched statement line as spend money, receive money or a transfer between own banks (14 E1): builds one balanced
 * journal (type bank, source bank_transaction, dated the line date, in its period, in the bank's currency) and submits it, so
 * the usual rules apply: below the threshold and with no journal workflow it posts at once (a person needs a signing grant) and the
 * hook matches the line; above the threshold (company_settings.approval_defaults.journal_threshold, base amount) or when an active
 * journal workflow covers it, it waits for an approver (maker ≠ checker) and posting matches the line.
 *
 * Consistency with approval_workflows: the workflow decides WHO approves and can only make this stricter; the threshold decides
 * whether approval is needed. A bank transaction over the threshold with no journal workflow that covers it is refused
 * (`approval_workflow_missing`) rather than posted unapproved. People only.
 */
final class CreateBankTransaction
{
    public function __construct(
        private readonly UnitOfWork $uow,
        private readonly SetupGuard $guard,
        private readonly IdGenerator $ids,
        private readonly CreateJournalDraft $drafts,
        private readonly SubmitDocument $submit,
        private readonly BankLineState $state,
        private readonly TaxRateResolver $taxRates,
        private readonly PostingAccountResolver $posting,
        private readonly SettlementWriter $settlements,
        private readonly DatabaseManager $db,
    ) {}

    public function handle(Actor $actor, BankTransactionInput $in): BankTransaction
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->guard->require($actor, 'banking.transactions.create', $in->companyId);
            if (! in_array($in->kind, ['spend', 'receive', 'transfer'], true)) {
                throw DomainRuleViolation::single('kind_invalid', 'The kind must be spend, receive or transfer.');
            }
            $company = Company::query()->findOrFail($in->companyId);
            $seen = BankStatementLine::query()->where('company_id', $in->companyId)->find($in->statementLineId)
                ?? throw DomainRuleViolation::single('not_found', 'The bank line does not exist.');
            $bank = BankAccount::query()->findOrFail($seen->bank_account_id);
            $date = DateTimeImmutable::createFromInterface($seen->txn_date);
            $memo = trim((string) $in->memo) !== '' ? trim((string) $in->memo) : ($seen->description !== '' ? $seen->description : 'Bank transaction');

            $other = null;
            $coding = null;
            if ($in->kind === 'transfer') {
                $other = BankAccount::query()->where('company_id', $in->companyId)->find($in->toBankAccountId ?? '')
                    ?? throw DomainRuleViolation::single('transfer_account_invalid', 'Choose a different bank account to transfer to.');
                if ($other->id === $bank->id || ! $other->is_active) {
                    throw DomainRuleViolation::single('transfer_account_invalid', 'Choose a different, active bank account to transfer to.');
                }
                if ($other->currency !== $bank->currency) {
                    throw DomainRuleViolation::single('transfer_currency_mismatch', 'Transfers between currencies are not supported here yet.');
                }
            } else {
                $coding = Account::query()->where('company_id', $in->companyId)->find($in->accountId ?? '');
                if ($coding === null || ! $coding->is_active || ! $coding->is_postable) {
                    throw DomainRuleViolation::single('account_invalid', 'Choose an active account to code this line to.');
                }
                if (in_array($coding->control_type->value, BankTransactionPosting::BLOCKED_CONTROL, true)) {
                    throw DomainRuleViolation::single('control_account_not_allowed', "{$coding->code} {$coding->name} is a control account. Record customer and supplier money as a receipt or payment instead.");
                }
                if ($in->contactId !== null && ! Contact::query()->where('company_id', $in->companyId)->whereKey($in->contactId)->exists()) {
                    throw DomainRuleViolation::single('not_found', 'The contact does not exist.');
                }
            }

            [$taxRate, $taxAccount, $recoverable, $taxCodeId] = $this->tax($in, $company, $date);
            $rate = $bank->currency === $company->base_currency ? '1' : $this->settlements->rate($company, $bank->currency, null, $date->format('Y-m-d'));
            $built = BankTransactionPosting::build(
                $in->kind, $seen->amount, $bank->currency, $company->base_currency, $rate, $bank->account_id, $coding?->id, $other?->account_id,
                $taxCodeId, $taxRate, $taxAccount, $recoverable, $this->posting->named($company, 'rounding'), $in->dims, $in->contactId,
                $memo, $seen->description, $other->name ?? '',
            );
            $baseGross = $this->bankBaseAmount($built['lines'], $bank->account_id);
            $this->assertApproval($company, $baseGross);

            $locks->periodsForPost($company->id, [$date]);                                           // 1
            $journal = $this->drafts->handle($actor, new JournalDraftInput(
                $company->id, JournalType::Bank, $date, $built['lines'], $seen->reference, $memo, null, null, 'bank_transaction', $txnId = $this->ids->next(),
            ));
            $locks->document($journal);                                                              // 2: journal, bank account, line
            $locks->document($bank);
            $line = $locks->document($seen);
            if ($line->status !== 'unmatched') {
                throw DomainRuleViolation::single('line_not_open', 'This bank line is already matched or excluded.');
            }
            $this->state->assertNotReconciled($line);
            $open = $this->db->connection()->table('bank_transactions as t')->join('journals as j', 'j.id', '=', 't.journal_id')
                ->where('t.statement_line_id', $line->id)->whereIn('j.status', ['pending_approval', 'posted'])->exists();
            if ($open) {
                throw DomainRuleViolation::single('line_not_open', 'This bank line is already matched or waiting for approval.');
            }

            $txn = new BankTransaction;
            $txn->forceFill([
                'id' => $txnId, 'tenant_id' => $actor->tenantId, 'company_id' => $company->id, 'bank_account_id' => $bank->id,
                'statement_line_id' => $line->id, 'journal_id' => $journal->id, 'kind' => $in->kind, 'to_bank_account_id' => $other?->id,
                'rule_id' => $in->ruleId, 'gross' => abs($line->amount), 'currency' => $bank->currency, 'created_by' => $actor->id,
            ])->save();
            if ($in->ruleId !== null) {
                $rule = BankRule::query()->where('company_id', $company->id)->find($in->ruleId);
                $rule?->forceFill(['times_applied' => $rule->times_applied + 1])->save();
            }

            $this->submit->handle($actor, new DocumentRef('journal', $journal->id));
            $audit->add('bank_transaction.created', $txn, after: $txn, context: ['journal_id' => $journal->id, 'status' => Journal::query()->whereKey($journal->id)->value('status')]);
            $outbox->add(new BankTransactionCreated($txn->id, $company->id, 0, ['journal_id' => $journal->id, 'kind' => $in->kind]));

            return $txn;
        });
    }

    /** @return array{0: string|null, 1: string|null, 2: bool, 3: string|null} rate, account, recoverable, code id */
    private function tax(BankTransactionInput $in, Company $company, DateTimeImmutable $date): array
    {
        if ($in->taxCodeId === null || $in->kind === 'transfer') {
            return [null, null, true, null];
        }
        $code = TaxCode::query()->where('company_id', $company->id)->find($in->taxCodeId) ?? throw DomainRuleViolation::single('tax_code_invalid', 'Unknown tax code.');
        if (! $code->is_active) {
            throw DomainRuleViolation::single('tax_code_invalid', 'The tax code is inactive.');
        }
        if ($code->kind === 'wht') {
            return [null, null, true, null]; // withholding is not split out of a bank line
        }
        $rate = $this->taxRates->requireRateOn($code->id, $date);
        $account = $in->kind === 'spend'
            ? ($code->pay_account_id ?? $this->posting->named($company, 'tax_input'))
            : ($code->collect_account_id ?? $this->posting->named($company, 'tax_output'));

        return [$rate, $account, $code->is_recoverable, $code->id];
    }

    /** @param list<DraftLine> $lines */
    private function bankBaseAmount(array $lines, string $bankGl): int
    {
        $sum = 0;
        foreach ($lines as $l) {
            if ($l->accountId === $bankGl) {
                $sum += max($l->debit, $l->credit);
            }
        }

        return $sum;
    }

    private function assertApproval(Company $company, int $baseGross): void
    {
        $threshold = (CompanySettings::query()->where('company_id', $company->id)->first()?->getAttribute('approval_defaults') ?? [])['journal_threshold'] ?? null;
        if (! is_int($threshold) && ! (is_string($threshold) && ctype_digit($threshold))) {
            return;
        }
        if ($baseGross <= (int) $threshold) {
            return;
        }
        $workflows = ApprovalWorkflow::query()->where('company_id', $company->id)->where('document_type', 'journal')->where('is_active', true)->get()->map(fn (ApprovalWorkflow $w) => $w->toDefinition())->all();
        if (WorkflowResolver::resolve(array_values($workflows), 'journal', DocumentSource::User, $baseGross) === null) {
            throw DomainRuleViolation::single('approval_workflow_missing', 'This amount is above the journal approval threshold, but no active journal approval workflow covers it. Set one up in the approval settings.');
        }
    }
}
