-- Ledger invariants enforced in the database (13 §9). Error codes: class LG.
--   LG001 journal_lines_guard   LG002 posted_row_guard   LG003 journal_balanced   LG004 journal_period_open

-- Lines of a posted or reversed journal can never be inserted, changed or deleted.
CREATE OR REPLACE FUNCTION journal_lines_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF TG_OP = 'DELETE' AND purge_allowed(OLD.tenant_id) THEN
      RETURN OLD;
    END IF;
    SELECT status INTO parent_status FROM journals WHERE id = OLD.journal_id;
    IF parent_status IN ('posted', 'reversed') THEN
      RAISE EXCEPTION 'journal_lines_guard: journal % is %', OLD.journal_id, parent_status USING ERRCODE = 'LG001';
    END IF;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT status INTO parent_status FROM journals WHERE id = NEW.journal_id;
    IF parent_status IN ('posted', 'reversed') THEN
      RAISE EXCEPTION 'journal_lines_guard: journal % is %', NEW.journal_id, parent_status USING ERRCODE = 'LG001';
    END IF;
    RETURN NEW;
  END IF;
  RETURN OLD;
END
$$;

CREATE TRIGGER journal_lines_guard
  BEFORE INSERT OR UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_lines_guard();

-- Posted documents: no DELETE; UPDATE only of whitelisted columns.
-- TG_ARGV[0] = allowed status targets after posting (comma list); TG_ARGV[1..] = mutable columns.
CREATE OR REPLACE FUNCTION posted_row_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allowed_status text[] := string_to_array(TG_ARGV[0], ',');
  old_doc jsonb := to_jsonb(OLD);
  new_doc jsonb;
  i int;
BEGIN
  IF OLD.status NOT IN ('posted', 'reversed', 'paid') THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF purge_allowed(OLD.tenant_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'posted_row_guard: % % is % and cannot be deleted', TG_TABLE_NAME, OLD.id, OLD.status
      USING ERRCODE = 'LG002';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (NEW.status = ANY (allowed_status)) THEN
    RAISE EXCEPTION 'posted_row_guard: % % cannot move from % to %', TG_TABLE_NAME, OLD.id, OLD.status, NEW.status
      USING ERRCODE = 'LG002';
  END IF;

  new_doc := to_jsonb(NEW) - 'status';
  old_doc := old_doc - 'status';
  FOR i IN 1 .. TG_NARGS - 1 LOOP
    new_doc := new_doc - TG_ARGV[i];
    old_doc := old_doc - TG_ARGV[i];
  END LOOP;

  IF new_doc IS DISTINCT FROM old_doc THEN
    RAISE EXCEPTION 'posted_row_guard: % % is % and only whitelisted columns may change', TG_TABLE_NAME, OLD.id, OLD.status
      USING ERRCODE = 'LG002';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER journals_posted_row_guard
  BEFORE UPDATE OR DELETE ON journals
  FOR EACH ROW EXECUTE FUNCTION posted_row_guard('reversed', 'reversed_by_id', 'lock_version', 'updated_at');

-- A journal that becomes posted must balance, have >= 2 lines, and carry matching totals.
-- Deferred to commit, once per journal (not per line).
CREATE OR REPLACE FUNCTION journal_balanced() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  n int;
  sum_debit bigint;
  sum_credit bigint;
  cur_status text;
BEGIN
  SELECT status INTO cur_status FROM journals WHERE id = NEW.id;
  IF cur_status IS DISTINCT FROM 'posted' AND cur_status IS DISTINCT FROM 'reversed' THEN
    RETURN NULL;
  END IF;
  SELECT count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0)
    INTO n, sum_debit, sum_credit
    FROM journal_lines WHERE journal_id = NEW.id;
  IF n < 2 OR sum_debit <> sum_credit OR sum_debit <> NEW.total_debit OR sum_credit <> NEW.total_credit THEN
    RAISE EXCEPTION 'journal_balanced: journal % has % lines, debit %, credit %, totals %/%',
      NEW.id, n, sum_debit, sum_credit, NEW.total_debit, NEW.total_credit
      USING ERRCODE = 'LG003';
  END IF;
  RETURN NULL;
END
$$;

CREATE CONSTRAINT TRIGGER journal_balanced_on_post
  AFTER UPDATE OF status ON journals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted')
  EXECUTE FUNCTION journal_balanced();

CREATE CONSTRAINT TRIGGER journal_balanced_on_insert
  AFTER INSERT ON journals
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  WHEN (NEW.status IN ('posted', 'reversed'))
  EXECUTE FUNCTION journal_balanced();

-- A journal may only become posted into an open period (or soft-closed with the SET LOCAL GUC),
-- dated inside that period.
CREATE OR REPLACE FUNCTION journal_period_open() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  p record;
BEGIN
  SELECT status, starts_on, ends_on INTO p FROM fiscal_periods WHERE id = NEW.fiscal_period_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'journal_period_open: journal % has no period', NEW.id USING ERRCODE = 'LG004';
  END IF;
  IF NEW.journal_date < p.starts_on OR NEW.journal_date > p.ends_on THEN
    RAISE EXCEPTION 'journal_period_open: date % outside period', NEW.journal_date USING ERRCODE = 'LG004';
  END IF;
  IF p.status = 'open' THEN
    RETURN NEW;
  END IF;
  IF p.status = 'soft_closed' AND current_setting('app.allow_soft_closed', true) = 'on' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'journal_period_open: period is %', p.status USING ERRCODE = 'LG004';
END
$$;

CREATE TRIGGER journal_period_open_on_post
  BEFORE UPDATE OF status ON journals
  FOR EACH ROW
  WHEN (NEW.status = 'posted' AND OLD.status IS DISTINCT FROM 'posted')
  EXECUTE FUNCTION journal_period_open();

CREATE TRIGGER journal_period_open_on_insert
  BEFORE INSERT ON journals
  FOR EACH ROW
  WHEN (NEW.status = 'posted')
  EXECUTE FUNCTION journal_period_open();
