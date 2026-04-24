
-- Roles enum
CREATE TYPE public.app_role AS ENUM ('admin', 'lead_auditor', 'member_auditor');

-- Profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- User roles (separate table to avoid privilege escalation)
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer role check
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- Audit groups
CREATE TABLE public.audit_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  lead_auditor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.audit_groups ENABLE ROW LEVEL SECURITY;

-- Group members
CREATE TABLE public.audit_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.audit_groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(group_id, user_id)
);
ALTER TABLE public.audit_group_members ENABLE ROW LEVEL SECURITY;

-- Helper: check if user is member of group (security definer to avoid recursion)
CREATE OR REPLACE FUNCTION public.is_group_member(_user_id UUID, _group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.audit_group_members
    WHERE user_id = _user_id AND group_id = _group_id
  )
$$;

CREATE OR REPLACE FUNCTION public.is_group_lead(_user_id UUID, _group_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.audit_groups
    WHERE id = _group_id AND lead_auditor_id = _user_id
  )
$$;

-- Surveys / Forms
CREATE TYPE public.survey_status AS ENUM ('draft', 'approved', 'archived');

CREATE TABLE public.surveys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  pdf_path TEXT,
  schema JSONB NOT NULL DEFAULT '{"sections":[]}'::jsonb,
  status survey_status NOT NULL DEFAULT 'draft',
  lead_auditor_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  assigned_group_id UUID REFERENCES public.audit_groups(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at TIMESTAMPTZ
);
ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;

-- Member responses (one per user per survey)
CREATE TABLE public.survey_responses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id UUID NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answers JSONB NOT NULL DEFAULT '{}'::jsonb,
  progress NUMERIC NOT NULL DEFAULT 0,
  submitted BOOLEAN NOT NULL DEFAULT false,
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(survey_id, user_id)
);
ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER surveys_updated_at BEFORE UPDATE ON public.surveys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER survey_responses_updated_at BEFORE UPDATE ON public.survey_responses
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email)
  );
  -- Default new users to member_auditor (admin can change)
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'member_auditor')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ====== RLS POLICIES ======

-- profiles
CREATE POLICY "Profiles viewable by authenticated users"
  ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "Users can update own profile"
  ON public.profiles FOR UPDATE TO authenticated USING (auth.uid() = id);
CREATE POLICY "Admins can update any profile"
  ON public.profiles FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- user_roles
CREATE POLICY "Users see own roles"
  ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Admins manage roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- audit_groups
CREATE POLICY "Authenticated can view groups"
  ON public.audit_groups FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage groups"
  ON public.audit_groups FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- audit_group_members
CREATE POLICY "Authenticated can view group members"
  ON public.audit_group_members FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage group members"
  ON public.audit_group_members FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- surveys
CREATE POLICY "Lead sees own surveys"
  ON public.surveys FOR SELECT TO authenticated
  USING (lead_auditor_id = auth.uid());
CREATE POLICY "Admin sees all surveys"
  ON public.surveys FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Group members see assigned approved surveys"
  ON public.surveys FOR SELECT TO authenticated
  USING (
    status = 'approved'
    AND assigned_group_id IS NOT NULL
    AND public.is_group_member(auth.uid(), assigned_group_id)
  );
CREATE POLICY "Lead auditors create surveys"
  ON public.surveys FOR INSERT TO authenticated
  WITH CHECK (
    lead_auditor_id = auth.uid()
    AND public.has_role(auth.uid(), 'lead_auditor')
  );
CREATE POLICY "Lead updates own draft surveys"
  ON public.surveys FOR UPDATE TO authenticated
  USING (lead_auditor_id = auth.uid())
  WITH CHECK (lead_auditor_id = auth.uid());
CREATE POLICY "Admins manage all surveys"
  ON public.surveys FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- survey_responses
CREATE POLICY "Members see own responses"
  ON public.survey_responses FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Lead sees responses for own surveys"
  ON public.survey_responses FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.surveys s WHERE s.id = survey_id AND s.lead_auditor_id = auth.uid()));
CREATE POLICY "Admin sees all responses"
  ON public.survey_responses FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Members create own responses"
  ON public.survey_responses FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.surveys s
      WHERE s.id = survey_id
        AND s.status = 'approved'
        AND s.assigned_group_id IS NOT NULL
        AND public.is_group_member(auth.uid(), s.assigned_group_id)
    )
  );
CREATE POLICY "Members update own responses"
  ON public.survey_responses FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Storage buckets
INSERT INTO storage.buckets (id, name, public) VALUES ('survey-pdfs', 'survey-pdfs', false);
INSERT INTO storage.buckets (id, name, public) VALUES ('response-files', 'response-files', false);

-- Storage policies for survey-pdfs (lead auditor uploads)
CREATE POLICY "Authenticated read survey pdfs"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'survey-pdfs');
CREATE POLICY "Lead auditors upload survey pdfs"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'survey-pdfs'
    AND public.has_role(auth.uid(), 'lead_auditor')
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY "Owners delete survey pdfs"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'survey-pdfs' AND owner = auth.uid());

-- Storage policies for response-files
CREATE POLICY "Auth read response files"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'response-files');
CREATE POLICY "Members upload response files"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'response-files'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
CREATE POLICY "Owners delete response files"
  ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'response-files' AND owner = auth.uid());
