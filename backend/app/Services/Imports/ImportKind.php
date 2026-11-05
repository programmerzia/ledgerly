<?php

declare(strict_types=1);

namespace App\Services\Imports;

use App\Models\Organisation\Company;
use App\Support\Actor;

/**
 * One thing a file can be imported as (plan 2.18). A kind names its target fields, checks rows with the rules of the Action that will
 * write them (`prepare` writes nothing), and applies the rows through that Action (`apply`, on the queue).
 */
abstract class ImportKind
{
    abstract public function key(): string;

    /** @return list<FieldSpec> */
    abstract public function fields(): array;

    /** The company permission the target Action asks for; the route policy and the Action both check it. */
    abstract public function permission(): string;

    /**
     * Checks every row against the Action's rules without writing, and the file as a whole where rows depend on each other.
     *
     * @param  array<int, array<string, string>>  $rows  row number → cells
     */
    abstract public function prepare(ImportContext $ctx, array $rows): PreparedSet;

    /** Applies the valid rows through the Action, recording each unit through the runner. */
    abstract public function apply(ImportContext $ctx, Actor $actor, ImportRunner $run): void;

    /** All rows or none: a single invalid row refuses the apply (opening balances). */
    public function atomic(): bool
    {
        return false;
    }

    /** A person's signing grant is recorded when apply is requested (ADR-0004). */
    public function needsSignature(): bool
    {
        return false;
    }

    /**
     * Laravel rules for the import-level `options` (the keys below `options.`).
     *
     * @return array<string, mixed>
     */
    public function optionRules(Company $company): array
    {
        return [];
    }

    /**
     * What a mapping still lacks beyond the required fields (a kind with either/or fields says so here).
     *
     * @param  array<string, string>  $columns
     * @param  array<string, string>  $defaults
     * @return list<string>
     */
    public function mappingProblems(array $columns, array $defaults): array
    {
        return [];
    }

    /**
     * Whether an option set is complete enough to preview.
     *
     * @param  array<string, mixed>  $options
     * @return list<string> missing option names
     */
    public function missingOptions(array $options): array
    {
        return [];
    }

    /** @return array<string, FieldSpec> by key */
    final public function fieldMap(): array
    {
        $map = [];
        foreach ($this->fields() as $f) {
            $map[$f->key] = $f;
        }

        return $map;
    }

    /**
     * The header row of a template file: one column per target field, named by its label. A file with these headers maps itself (`suggest` matches the label).
     *
     * @return list<string>
     */
    final public function templateHeaders(): array
    {
        return array_map(fn (FieldSpec $f): string => $f->label, $this->fields());
    }

    /**
     * What the file's headers suggest: a header whose normalised name is one of a field's synonyms (or its key) maps to it.
     *
     * @param  list<string>  $headers
     * @return array<string, string> field → header
     */
    final public function suggest(array $headers): array
    {
        $byName = [];
        foreach ($headers as $h) {
            $byName[self::normalise($h)] ??= $h;
        }
        $out = [];
        $used = [];
        foreach ($this->fields() as $f) {
            foreach ([$f->key, self::normalise($f->label), ...$f->synonyms] as $name) {
                $name = self::normalise($name);
                if (isset($byName[$name]) && ! isset($used[$byName[$name]])) {
                    $out[$f->key] = $byName[$name];
                    $used[$byName[$name]] = true;
                    break;
                }
            }
        }

        return $out;
    }

    final public static function normalise(string $name): string
    {
        return trim((string) preg_replace('/[^a-z0-9]+/', ' ', mb_strtolower($name)));
    }
}
