<?php

declare(strict_types=1);

namespace App\Services\Imports\Kinds;

use App\Actions\Ledger\Inputs\RecordJournalInput;
use App\Actions\Ledger\RecordJournal;
use App\Actions\Ledger\SetupGuard;
use App\Domain\Banking\AmountParser;
use App\Domain\Ledger\ControlType;
use App\Domain\Ledger\DraftLine;
use App\Domain\Ledger\JournalDraft;
use App\Domain\Ledger\JournalType;
use App\Domain\Ledger\PostingRejected;
use App\Domain\Ledger\PostingValidator;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Models\Fiscal\FiscalPeriod;
use App\Models\Ledger\Journal;
use App\Models\Organisation\Company;
use App\Services\Imports\FieldSpec;
use App\Services\Imports\ImportContext;
use App\Services\Imports\ImportKind;
use App\Services\Imports\ImportRunner;
use App\Services\Imports\PreparedSet;
use App\Services\Imports\RowOutcome;
use App\Services\Ledger\PostingEngine;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use DateTimeImmutable;
use InvalidArgumentException;

/**
 * A trial balance as ONE `opening` journal dated `options.as_of`, or nothing. Each row is a line (account code, a debit or a credit, and
 * for receivable and payable accounts the customer or supplier); the whole file goes through `PostingValidator` before anything posts,
 * and the file must balance by itself: nothing is added to make it balance, so a retained-earnings line has to be in the file like any
 * other. One posted opening journal per company (until it is reversed); a closed period refuses it like any posting. Control accounts:
 * the validator requires a contact on receivable and payable lines (`contact_required`), so those rows name one (customer for
 * receivable, supplier for payable, `both` fits either); bank, cash, tax and the rest need none. Amounts are in the company base currency.
 */
final class OpeningBalancesKind extends ImportKind
{
    public function __construct(
        private readonly PostingEngine $engine,
        private readonly PostingValidator $validator,
        private readonly RecordJournal $record,
        private readonly SetupGuard $guard,
    ) {}

    public function key(): string
    {
        return 'opening_balances';
    }

    public function permission(): string
    {
        return 'settings.manage';
    }

    public function atomic(): bool
    {
        return true;
    }

    public function needsSignature(): bool
    {
        return true;
    }

    public function fields(): array
    {
        return [
            new FieldSpec('account', 'Account code', true, ['account', 'account number', 'code', 'acct']),
            new FieldSpec('debit', 'Debit', false, ['dr', 'debit amount']),
            new FieldSpec('credit', 'Credit', false, ['cr', 'credit amount']),
            new FieldSpec('contact', 'Customer or supplier code', false, ['customer', 'supplier', 'customer code', 'supplier code', 'contact code'], 'required on receivable and payable accounts'),
            new FieldSpec('description', 'Description', false, ['memo', 'narration', 'account name', 'name']),
        ];
    }

    public function optionRules(Company $company): array
    {
        return ['as_of' => ['required', 'date_format:Y-m-d']];
    }

    /** @param array<string, mixed> $options @return list<string> */
    public function missingOptions(array $options): array
    {
        return isset($options['as_of']) ? [] : ['as_of'];
    }

    public function mappingProblems(array $columns, array $defaults): array
    {
        return isset($columns['debit']) || isset($columns['credit']) ? [] : ['Map the debit column, the credit column, or both.'];
    }

    public function prepare(ImportContext $ctx, array $rows): PreparedSet
    {
        $set = new PreparedSet;
        $date = new DateTimeImmutable((string) $ctx->option('as_of'));
        $lines = [];
        $rowOfLine = [];
        foreach ($rows as $number => $cells) {
            $outcome = new RowOutcome;
            $line = $this->line($ctx, $cells, $outcome);
            if ($line !== null) {
                $lines[] = $line;
                $rowOfLine[] = $number;
            }
            $set->rows[$number] = $outcome;
        }

        $debit = array_sum(array_map(fn (DraftLine $l) => $l->debit, $lines));
        $credit = array_sum(array_map(fn (DraftLine $l) => $l->credit, $lines));
        $set->summary = ['as_of' => $date->format('Y-m-d'), 'lines' => count($rows), 'total_debit' => $debit, 'total_credit' => $credit, 'difference' => $debit - $credit];

        if (Journal::query()->where('company_id', $ctx->company->id)->where('journal_type', JournalType::Opening->value)->where('status', 'posted')->exists()) {
            $set->fileErrors[] = ['code' => 'opening_balances_exist', 'message' => 'This company already has a posted opening journal; reverse it before importing opening balances again.'];
        }

        // The same validator as posting, over the whole file at once; only when every row read cleanly (else "unbalanced" would be noise).
        if (count($lines) === count($rows) && $lines !== []) {
            $draft = new JournalDraft($ctx->company->id, JournalType::Opening, $date, $lines, 'OPENING', 'Opening balances (import)', 'import', $ctx->import->id);
            foreach ($this->violations($ctx, $draft) as $v) {
                if ($v->lineNo !== null && isset($rowOfLine[$v->lineNo - 1])) {
                    $set->rows[$rowOfLine[$v->lineNo - 1]]->add($v->code === 'contact_required' ? 'contact' : null, $v->code, $v->message);
                } else {
                    $set->fileErrors[] = ['code' => $v->code, 'message' => $v->message];
                }
            }
        }

        return $set;
    }

    public function apply(ImportContext $ctx, Actor $actor, ImportRunner $run): void
    {
        $rows = $run->pending();
        if ($rows->isEmpty()) {
            return;
        }
        $run->unit(ImportRunner::ids($rows), function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($ctx, $actor, $rows): array {
            $this->guard->require($actor, $this->permission(), $ctx->company->id);
            if (! $actor->hasSigningGrant || $actor->id === null || $ctx->import->signed_by !== $actor->id) {
                throw DomainRuleViolation::single('signature_required', 'Opening balances need the signing PIN of the person who requested the apply.');
            }

            $fresh = $this->prepare($ctx, $rows->mapWithKeys(fn ($r) => [$r->row_number => $r->cells])->all());
            $problems = array_map(fn (array $e) => new Violation($e['code'], $e['message']), $fresh->fileErrors);
            foreach ($fresh->rows as $number => $outcome) {
                foreach ($outcome->errors as $e) {
                    $problems[] = new Violation($e['code'], "Row {$number}: {$e['message']}", $number);
                }
            }
            if ($problems !== []) {
                throw new DomainRuleViolation($problems[0]->code, 'The opening balances no longer pass validation.', $problems);
            }

            $journal = $this->record->handle($actor, new RecordJournalInput($this->draft($ctx, $rows->map(fn ($r) => $r->cells)->all())));

            return ['journal_id' => $journal->id, 'number' => $journal->number];
        });
    }

    /**
     * @param  array<string, string>  $cells
     */
    private function line(ImportContext $ctx, array $cells, RowOutcome $outcome): ?DraftLine
    {
        $code = $ctx->value($cells, 'account');
        $account = $code === null ? null : $ctx->account($code);
        if ($code === null) {
            $outcome->add('account', 'required', 'The account code is empty.');
        } elseif ($account === null) {
            $outcome->add('account', 'code_not_found', "There is no account with code {$code} in this company.");
        }

        $amounts = [];
        foreach (['debit', 'credit'] as $side) {
            $raw = $ctx->value($cells, $side);
            if ($raw === null) {
                $amounts[$side] = 0;

                continue;
            }
            try {
                $amounts[$side] = AmountParser::parse($raw, $ctx->locale(), $ctx->scale());
            } catch (InvalidArgumentException $e) {
                $amounts[$side] = 0;
                $outcome->add($side, 'invalid_amount', $e->getMessage());
            }
            if ($amounts[$side] < 0) {
                $outcome->add($side, 'negative_amount', 'Amounts must not be negative; put a credit balance in the credit column.');
            }
        }
        if ($outcome->ok() && $amounts['debit'] > 0 && $amounts['credit'] > 0) {
            $outcome->add(null, 'line_both_sides', 'A line is either a debit or a credit, not both.');
        } elseif ($outcome->ok() && $amounts['debit'] === 0 && $amounts['credit'] === 0) {
            $outcome->add(null, 'amount_required', 'The row has no debit and no credit amount.');
        }

        $contactId = null;
        $contactCode = $ctx->value($cells, 'contact');
        if ($contactCode !== null) {
            $contact = $ctx->contact($contactCode);
            $type = $account?->control_type;
            if ($contact === null) {
                $outcome->add('contact', 'code_not_found', "There is no customer or supplier with code {$contactCode} in this company.");
            } elseif ($account !== null && $type !== ControlType::Ar && $type !== ControlType::Ap) {
                $outcome->add('contact', 'contact_not_allowed', "Account {$account->code} is not a receivable or payable account, so it takes no customer or supplier.");
            } elseif (($type === ControlType::Ar && $contact->kind === 'supplier') || ($type === ControlType::Ap && $contact->kind === 'customer')) {
                $outcome->add('contact', 'contact_kind_mismatch', 'A '.($type === ControlType::Ar ? 'receivable account needs a customer' : 'payable account needs a supplier').", but {$contactCode} is a {$contact->kind}.");
            } else {
                $contactId = $contact->id;
            }
        }

        if (! $outcome->ok() || $account === null) {
            return null;
        }

        return new DraftLine($account->id, $amounts['debit'], $amounts['credit'], contactId: $contactId, description: $ctx->value($cells, 'description'));
    }

    /**
     * @param  array<int, array<string, string>>  $cellRows
     */
    private function draft(ImportContext $ctx, array $cellRows): JournalDraft
    {
        $lines = [];
        foreach ($cellRows as $cells) {
            $line = $this->line($ctx, $cells, new RowOutcome);
            if ($line === null) {
                throw DomainRuleViolation::single('import_invalid', 'A row can no longer be read.');
            }
            $lines[] = $line;
        }

        return new JournalDraft($ctx->company->id, JournalType::Opening, new DateTimeImmutable((string) $ctx->option('as_of')), $lines, 'OPENING', 'Opening balances (import)', 'import', $ctx->import->id);
    }

    /** @return list<Violation> */
    private function violations(ImportContext $ctx, JournalDraft $draft): array
    {
        $period = FiscalPeriod::query()->where('company_id', $ctx->company->id)->where('kind', 'regular')
            ->where('starts_on', '<=', $draft->date->format('Y-m-d'))->where('ends_on', '>=', $draft->date->format('Y-m-d'))->first();
        $context = $this->engine->context($ctx->actor, $draft, $period);
        if ($period === null) {
            return [new Violation('period_missing', 'No fiscal period covers the opening date.')];
        }
        try {
            $this->validator->validate($draft, $context);
        } catch (PostingRejected $e) {
            return $e->violations;
        }

        return [];
    }
}
