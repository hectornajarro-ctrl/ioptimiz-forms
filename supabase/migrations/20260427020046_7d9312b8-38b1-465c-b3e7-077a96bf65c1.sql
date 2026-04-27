-- 1) Add open_enrollment flag
ALTER TABLE public.audit_groups
  ADD COLUMN IF NOT EXISTS open_enrollment boolean NOT NULL DEFAULT false;

-- 2) Helper: is the group an open-enrollment group with no members yet?
CREATE OR REPLACE FUNCTION public.is_group_open_unclaimed(_group_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.audit_groups g
    WHERE g.id = _group_id
      AND g.open_enrollment = true
      AND NOT EXISTS (
        SELECT 1 FROM public.audit_group_members m WHERE m.group_id = g.id
      )
  )
$$;

-- 3) Surveys: visible to everyone authenticated when their assigned group is open & unclaimed
DROP POLICY IF EXISTS "Open unclaimed approved surveys visible" ON public.surveys;
CREATE POLICY "Open unclaimed approved surveys visible"
ON public.surveys
FOR SELECT
TO authenticated
USING (
  status = 'approved'::survey_status
  AND assigned_group_id IS NOT NULL
  AND public.is_group_open_unclaimed(assigned_group_id)
);

-- 4) Survey responses: a user can create their own response when claiming an open survey
DROP POLICY IF EXISTS "Members create responses on open unclaimed surveys" ON public.survey_responses;
CREATE POLICY "Members create responses on open unclaimed surveys"
ON public.survey_responses
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.surveys s
    WHERE s.id = survey_responses.survey_id
      AND s.status = 'approved'::survey_status
      AND s.assigned_group_id IS NOT NULL
      AND public.is_group_open_unclaimed(s.assigned_group_id)
  )
);

-- 5) Group members: a user can claim an open & unclaimed group by inserting themselves
DROP POLICY IF EXISTS "Self claim open unclaimed group" ON public.audit_group_members;
CREATE POLICY "Self claim open unclaimed group"
ON public.audit_group_members
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND public.is_group_open_unclaimed(group_id)
);
