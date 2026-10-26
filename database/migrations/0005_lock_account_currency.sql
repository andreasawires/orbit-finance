CREATE OR REPLACE FUNCTION prevent_account_currency_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN
    RAISE EXCEPTION 'Account currency is locked. Create a new account to use another currency.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounts_currency_immutable ON accounts;
CREATE TRIGGER accounts_currency_immutable
  BEFORE UPDATE OF currency ON accounts
  FOR EACH ROW
  EXECUTE FUNCTION prevent_account_currency_change();
