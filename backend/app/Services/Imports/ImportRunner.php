<?php

declare(strict_types=1);

namespace App\Services\Imports;

use App\Contracts\Clock;
use App\Domain\Shared\DomainRuleViolation;
use App\Models\Imports\Import;
use App\Models\Imports\ImportRow;
use App\Support\Actor;
use App\Support\UnitOfWork\AuditBuffer;
use App\Support\UnitOfWork\LockSet;
use App\Support\UnitOfWork\Outbox;
use App\Support\UnitOfWork\UnitOfWork;
use Closure;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Applies the rows of one import, one unit at a time. A unit is one row (or the rows of one invoice, or the whole file for the
 * kinds that must be atomic) and commits together with the rows' own `applied` mark, so a crash or a retry can never leave a record
 * created without its row marked, nor a row marked without its record. A unit whose rows are no longer `valid` (applied by an earlier
 * run, or by a worker that got there first) is skipped. A rule that refuses a unit fails its rows and the run goes on.
 */
final class ImportRunner
{
    public function __construct(
        public readonly Import $import,
        private readonly Actor $actor,
        private readonly UnitOfWork $uow,
        private readonly Clock $clock,
    ) {}

    /** @return Collection<int, ImportRow> the rows still waiting to be applied, in sheet order */
    public function pending(): Collection
    {
        return ImportRow::query()->where('import_id', $this->import->id)->where('status', 'valid')->orderBy('row_number')->get();
    }

    /**
     * @param  Collection<int, ImportRow>  $rows
     * @return list<string>
     */
    public static function ids(Collection $rows): array
    {
        return array_values(array_map(fn (ImportRow $r): string => $r->id, $rows->all()));
    }

    /**
     * @param  list<string>  $rowIds
     * @param  Closure(LockSet, AuditBuffer, Outbox): array<string, mixed>  $work  returns what to remember about the created record
     * @return bool true when the unit was applied now
     */
    public function unit(array $rowIds, Closure $work): bool
    {
        try {
            return $this->uow->run($this->actor, function (LockSet $locks, AuditBuffer $audit, Outbox $outbox) use ($rowIds, $work): bool {
                $rows = ImportRow::query()->where('import_id', $this->import->id)->whereIn('id', $rowIds)->orderBy('row_number')->lockForUpdate()->get();
                if ($rows->count() !== count($rowIds) || $rows->contains(fn (ImportRow $r) => $r->status !== 'valid')) {
                    return false;
                }
                $result = $work($locks, $audit, $outbox);
                DB::table('import_rows')->whereIn('id', $rowIds)->update([
                    'status' => 'applied', 'errors' => null, 'result' => json_encode($result, JSON_THROW_ON_ERROR),
                    'applied_at' => $this->clock->now()->format('Y-m-d H:i:s.uP'), 'updated_at' => $this->clock->now()->format('Y-m-d H:i:s.uP'),
                ]);

                return true;
            });
        } catch (DomainRuleViolation $e) {
            $errors = $e->violations === []
                ? [['field' => null, 'code' => $e->errorCode, 'message' => $e->getMessage()]]
                : array_map(fn ($v) => ['field' => null, 'code' => $v->code, 'message' => $v->message], $e->violations);
            $this->fail($rowIds, $errors);
        } catch (ValidationException $e) {
            $this->fail($rowIds, RequestRules::errors($e->errors()));
        } catch (UniqueConstraintViolationException) {
            $this->fail($rowIds, [['field' => null, 'code' => 'duplicate', 'message' => 'Another record with the same key was created at the same time.']]);
        }

        return false;
    }

    /**
     * @param  list<string>  $rowIds
     * @param  list<array{field: string|null, code: string, message: string}>  $errors
     */
    public function fail(array $rowIds, array $errors): void
    {
        $this->uow->run($this->actor, function () use ($rowIds, $errors): void {
            DB::table('import_rows')->whereIn('id', $rowIds)->where('status', 'valid')->update([
                'status' => 'failed', 'errors' => json_encode($errors, JSON_THROW_ON_ERROR), 'updated_at' => $this->clock->now()->format('Y-m-d H:i:s.uP'),
            ]);
        });
    }

    /** @return array{rows_applied: int, rows_failed: int, rows_valid: int, rows_invalid: int} the counters, recomputed from the rows */
    public function counts(): array
    {
        $counts = ImportRow::query()->where('import_id', $this->import->id)->selectRaw('status, count(*) as n')->groupBy('status')->pluck('n', 'status');
        $applied = (int) ($counts['applied'] ?? 0);
        $failed = (int) ($counts['failed'] ?? 0);

        return ['rows_applied' => $applied, 'rows_failed' => $failed, 'rows_valid' => (int) ($counts['valid'] ?? 0) + $applied + $failed, 'rows_invalid' => (int) ($counts['invalid'] ?? 0)];
    }
}
