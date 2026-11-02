<?php

declare(strict_types=1);

namespace App\Actions\Banking;

use App\Actions\Banking\Inputs\ImportStatementInput;
use App\Actions\Ledger\SetupGuard;
use App\Domain\Banking\StatementFormatException;
use App\Domain\Shared\DomainRuleViolation;
use App\Domain\Shared\Violation;
use App\Events\Banking\BankStatementImported;
use App\Models\Banking\BankAccount;
use App\Models\Banking\BankStatement;
use App\Services\Banking\StatementImporter;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;

/**
 * Imports a statement file (CSV, OFX, CAMT.053). Importing the same file again, or lines already imported, adds nothing and is
 * reported as `duplicate lines skipped`. Tokens with `banking:write` may import (a feed is data in, not a posting); the account lock
 * serialises imports and matching of one account.
 */
final class ImportBankStatement
{
    public function __construct(private readonly UnitOfWork $uow, private readonly SetupGuard $guard, private readonly StatementImporter $importer) {}

    /** @return array{statement: BankStatement|null, inserted: int, skipped: int, warnings: list<string>, already_imported: bool} */
    public function handle(Actor $actor, ImportStatementInput $in): array
    {
        return $this->uow->run($actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($actor, $in) {
            $this->guard->require($actor, 'banking.reconcile', $in->companyId, tokens: true);
            $seen = BankAccount::query()->where('company_id', $in->companyId)->find($in->bankAccountId)
                ?? throw DomainRuleViolation::single('not_found', 'The bank account does not exist.');
            $account = $locks->document($seen);
            if (! $account->is_active) {
                throw DomainRuleViolation::single('bank_account_inactive', 'The bank account is inactive.');
            }

            try {
                $result = $this->importer->import($actor, $account, $in->content, $in->fileName, $in->format, $in->mapping, $in->openingBalance, $in->closingBalance);
            } catch (StatementFormatException $e) {
                throw new DomainRuleViolation($e->errorCode, $e->getMessage(), array_map(
                    fn (array $x): Violation => new Violation($x['code'], $x['message'], $x['line']),
                    $e->errors,
                ));
            }

            if ($in->saveMapping && $in->mapping !== [] && $result['statement'] !== null) {
                $account->forceFill(['import_mapping' => $in->mapping, 'lock_version' => $account->lock_version + 1])->save();
            }
            $statement = $result['statement'];
            if ($statement !== null) {
                $audit->add('bank_statement.imported', $statement, after: $statement, context: ['lines' => $result['inserted'], 'duplicates_skipped' => $result['skipped']]);
                $outbox->add(new BankStatementImported($statement->id, $account->company_id, 0, ['bank_account_id' => $account->id, 'lines' => $result['inserted']]));
            }

            return $result;
        });
    }
}
