CREATE FUNCTION matchbase_research_run_tier_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.tier_at_submission IS DISTINCT FROM OLD.tier_at_submission THEN
    RAISE EXCEPTION 'research_run.tier_at_submission is immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER research_run_tier_at_submission_immutable
BEFORE UPDATE OF tier_at_submission ON research_run
FOR EACH ROW EXECUTE FUNCTION matchbase_research_run_tier_immutable();
ALTER TABLE research_run ENABLE ALWAYS TRIGGER research_run_tier_at_submission_immutable;
