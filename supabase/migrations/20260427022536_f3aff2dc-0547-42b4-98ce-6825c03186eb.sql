ALTER TABLE public.surveys
  ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ends_at   TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.surveys_validate_window()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.starts_at IS NOT NULL AND NEW.ends_at IS NOT NULL AND NEW.ends_at <= NEW.starts_at THEN
    RAISE EXCEPTION 'End date must be after start date';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS surveys_validate_window_trg ON public.surveys;
CREATE TRIGGER surveys_validate_window_trg
BEFORE INSERT OR UPDATE ON public.surveys
FOR EACH ROW EXECUTE FUNCTION public.surveys_validate_window();

CREATE UNIQUE INDEX IF NOT EXISTS surveys_lead_title_unique
  ON public.surveys (lead_auditor_id, lower(title));