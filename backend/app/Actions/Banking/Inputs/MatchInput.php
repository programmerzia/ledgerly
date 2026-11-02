<?php

declare(strict_types=1);

namespace App\Actions\Banking\Inputs;

final readonly class MatchInput
{
    /**
     * @param  list<string>  $statementLineIds
     * @param  list<string>  $journalLineIds  book lines on the bank's GL account
     * @param  list<string>  $settlementIds  posted settlements whose bank line is matched
     */
    public function __construct(public string $companyId, public array $statementLineIds, public array $journalLineIds = [], public array $settlementIds = []) {}
}
