# CLAUDE.md — agent operating instructions

This repository is a multi-tenant accounting ERP SaaS (Laravel 12 + Inertia 2 + React/TS +
PostgreSQL 16). Architecture is fully specified in `/docs`. **Read before any task**:

1. `docs/01_PRD.md` — what we build and what we explicitly do not.
2. `docs/02_AppFlow.md` — screens, routes, document state machine.
3. `docs/03_UI_Spec.md` — design tokens and component states.
4. `docs/04_TRD.md` — locked stack, folder structure, security constraints.
5. `docs/05_Schema.md` — database schema and RLS.
6. `docs/06_Plan.md` — ordered checklist; this is the source of truth for what to do next.

## Working rules
- Pick the first unchecked step in `docs/06_Plan.md` whose dependencies are done, unless the
  user names a step. Do one step per task.
- **After every completed step update `docs/06_Plan.md`** (`[x]`, date, commit/PR ref). If a
  step changes a design decision, update the relevant doc first and add a row to the
  Decision log.
- Never put business logic in controllers or models. Use `app/Actions` (write) and
  `app/Domain` (pure rules). Controllers: validate → authorize → action → respond.
- Ledger invariants are sacred: posted journals/lines are immutable; corrections are
  reversals; every journal balances; numbers are gapless; maker ≠ checker; closed periods
  reject postings. Any code touching these needs tests in `tests/Feature` and
  `tests/Invariants`.
- Money: integer minor units (`bigint` / PHP `int` + `brick/money`). Never `float`.
- Every tenant table gets `tenant_id` + RLS policy via the `enableRls` migration macro.
- Stack is locked (04_TRD §2). Do not add packages or change versions without an ADR in
  `docs/adr/` and a note in the Decision log.
- Tests: Pest for PHP, Vitest for TS. Run `composer test` and `npm test` before declaring a
  step done. PHPStan level 8 and Pint must pass.
- Secrets never in code or docs. `.env` is never committed.
- Commit messages: Conventional Commits. No AI attribution lines.
- When unsure about an accounting rule, stop and ask; do not invent accounting treatment.

## Commands
```bash
make up            # docker compose up
make test          # pest + vitest
make lint          # pint + phpstan + eslint
php artisan migrate --seed
```
