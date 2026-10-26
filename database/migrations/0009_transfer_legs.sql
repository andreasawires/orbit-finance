-- A transfer is two transactions sharing a transfer_id, each in its own account's currency: what left one
-- account and what arrived in the other. The exchange rate is never stored; it is received / sent.
-- Same-currency transfers move the same amount out and in, so their legs sum to zero.

CREATE OR REPLACE FUNCTION broken_transfer_ids(ids uuid[] DEFAULT NULL)
RETURNS SETOF uuid
LANGUAGE sql
STABLE
AS $$
  SELECT t.transfer_id
  FROM transactions t
  JOIN accounts a ON a.id = t.account_id AND a.workspace_id = t.workspace_id
  WHERE t.transfer_id IS NOT NULL AND (ids IS NULL OR t.transfer_id = ANY(ids))
  GROUP BY t.transfer_id
  HAVING NOT (
    count(*) = 2
    AND count(DISTINCT t.account_id) = 2
    AND count(*) FILTER (WHERE t.amount < 0) = 1
    AND bool_and(t.type = 'Transfer')
    AND (count(DISTINCT a.currency) = 2 OR sum(t.amount) = 0)
  );
$$;

DO $$
DECLARE
  broken uuid;
BEGIN
  SELECT id INTO broken FROM broken_transfer_ids() AS id LIMIT 1;
  IF broken IS NOT NULL THEN
    RAISE EXCEPTION 'Transfer % does not have one outgoing and one incoming leg on two accounts. Fix it before migrating.', broken;
  END IF;
END;
$$;

ALTER TABLE transactions ADD CONSTRAINT transactions_transfer_id_matches_type
  CHECK ((type = 'Transfer') = (transfer_id IS NOT NULL));

CREATE OR REPLACE FUNCTION check_transfer_legs()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  ids uuid[] := array_remove(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.transfer_id END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.transfer_id END
  ], NULL);
  broken uuid;
BEGIN
  IF cardinality(ids) = 0 THEN RETURN NULL; END IF;
  SELECT id INTO broken FROM broken_transfer_ids(ids) AS id LIMIT 1;
  IF broken IS NOT NULL THEN
    RAISE EXCEPTION 'A transfer needs one outgoing and one incoming leg on two different accounts, with equal amounts when both use the same currency.';
  END IF;
  RETURN NULL;
END;
$$;

-- Deferred to commit, so both legs can be written (or rewritten) before they are checked together.
CREATE CONSTRAINT TRIGGER transactions_transfer_legs
  AFTER INSERT OR UPDATE OR DELETE ON transactions
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION check_transfer_legs();
