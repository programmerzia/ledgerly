# ADR-0003 — Money as integer minor units
Status: Accepted · Date: 2026-10-27

Decision: `bigint` minor units in PostgreSQL, PHP `int` + `brick/money`; FX rates and
quantities `numeric(20,8)`. Rounding happens once per line with a documented rounding
account for residuals.
Consequences: no float drift; currency minor-unit table required; presentation layer formats.
