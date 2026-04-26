DO $$ BEGIN
  CREATE TYPE public.survey_mode AS ENUM ('free', 'compliance');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.surveys
  ADD COLUMN IF NOT EXISTS mode public.survey_mode NOT NULL DEFAULT 'free';