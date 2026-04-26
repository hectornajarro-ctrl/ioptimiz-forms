
-- Audit log table to record create/update/delete actions on key entities
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID,
  actor_email TEXT,
  action TEXT NOT NULL, -- 'create' | 'update' | 'delete'
  entity_type TEXT NOT NULL, -- 'user' | 'group' | 'survey' | 'role'
  entity_id TEXT,
  summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX idx_audit_logs_entity ON public.audit_logs (entity_type, entity_id);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can read audit logs
CREATE POLICY "Admins read audit logs"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- Allow authenticated inserts (triggers run as definer; service role bypasses RLS).
-- We deliberately do NOT allow update/delete from any client role.
CREATE POLICY "System inserts audit logs"
ON public.audit_logs
FOR INSERT
TO authenticated
WITH CHECK (true);

-- Helper to grab actor email from auth.users without exposing it broadly
CREATE OR REPLACE FUNCTION public._actor_email(_uid UUID)
RETURNS TEXT
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email FROM public.profiles WHERE id = _uid LIMIT 1
$$;

-- ============= Triggers =============

-- SURVEYS
CREATE OR REPLACE FUNCTION public.log_surveys_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.audit_logs(actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
    VALUES (v_actor, public._actor_email(v_actor), 'create', 'survey', NEW.id::text,
            'Created survey "' || COALESCE(NEW.title,'(untitled)') || '"',
            jsonb_build_object('title', NEW.title, 'status', NEW.status));
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    INSERT INTO public.audit_logs(actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
    VALUES (v_actor, public._actor_email(v_actor), 'update', 'survey', NEW.id::text,
            'Updated survey "' || COALESCE(NEW.title,'(untitled)') || '"',
            jsonb_build_object(
              'title', NEW.title,
              'status_from', OLD.status, 'status_to', NEW.status,
              'assigned_group_from', OLD.assigned_group_id, 'assigned_group_to', NEW.assigned_group_id
            ));
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO public.audit_logs(actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
    VALUES (v_actor, public._actor_email(v_actor), 'delete', 'survey', OLD.id::text,
            'Deleted survey "' || COALESCE(OLD.title,'(untitled)') || '"',
            jsonb_build_object('title', OLD.title, 'status', OLD.status));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_log_surveys
AFTER INSERT OR UPDATE OR DELETE ON public.surveys
FOR EACH ROW EXECUTE FUNCTION public.log_surveys_changes();

-- AUDIT GROUPS
CREATE OR REPLACE FUNCTION public.log_groups_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_actor UUID := auth.uid();
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.audit_logs(actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
    VALUES (v_actor, public._actor_email(v_actor), 'create', 'group', NEW.id::text,
            'Created group "' || NEW.name || '"',
            jsonb_build_object('name', NEW.name, 'lead_auditor_id', NEW.lead_auditor_id));
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    INSERT INTO public.audit_logs(actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
    VALUES (v_actor, public._actor_email(v_actor), 'update', 'group', NEW.id::text,
            'Updated group "' || NEW.name || '"',
            jsonb_build_object('name_from', OLD.name, 'name_to', NEW.name,
                               'lead_from', OLD.lead_auditor_id, 'lead_to', NEW.lead_auditor_id));
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO public.audit_logs(actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
    VALUES (v_actor, public._actor_email(v_actor), 'delete', 'group', OLD.id::text,
            'Deleted group "' || OLD.name || '"',
            jsonb_build_object('name', OLD.name));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_log_groups
AFTER INSERT OR UPDATE OR DELETE ON public.audit_groups
FOR EACH ROW EXECUTE FUNCTION public.log_groups_changes();

-- USER PROFILES (treated as 'user' entity for create/delete; updates show name change)
CREATE OR REPLACE FUNCTION public.log_profiles_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_actor UUID := auth.uid();
BEGIN
  IF (TG_OP = 'INSERT') THEN
    INSERT INTO public.audit_logs(actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
    VALUES (v_actor, public._actor_email(v_actor), 'create', 'user', NEW.id::text,
            'Created user ' || NEW.email,
            jsonb_build_object('email', NEW.email, 'full_name', NEW.full_name));
    RETURN NEW;
  ELSIF (TG_OP = 'UPDATE') THEN
    INSERT INTO public.audit_logs(actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
    VALUES (v_actor, public._actor_email(v_actor), 'update', 'user', NEW.id::text,
            'Updated user ' || NEW.email,
            jsonb_build_object('email', NEW.email,
                               'full_name_from', OLD.full_name, 'full_name_to', NEW.full_name));
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    INSERT INTO public.audit_logs(actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
    VALUES (v_actor, public._actor_email(v_actor), 'delete', 'user', OLD.id::text,
            'Deleted user ' || OLD.email,
            jsonb_build_object('email', OLD.email));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_log_profiles
AFTER INSERT OR UPDATE OR DELETE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.log_profiles_changes();

-- USER ROLES (track role grants/revocations under 'user' entity)
CREATE OR REPLACE FUNCTION public.log_user_roles_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_actor UUID := auth.uid(); v_email TEXT;
BEGIN
  IF (TG_OP = 'INSERT') THEN
    SELECT email INTO v_email FROM public.profiles WHERE id = NEW.user_id;
    INSERT INTO public.audit_logs(actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
    VALUES (v_actor, public._actor_email(v_actor), 'update', 'user', NEW.user_id::text,
            'Granted role ' || NEW.role::text || ' to ' || COALESCE(v_email,'user'),
            jsonb_build_object('role', NEW.role, 'change', 'granted'));
    RETURN NEW;
  ELSIF (TG_OP = 'DELETE') THEN
    SELECT email INTO v_email FROM public.profiles WHERE id = OLD.user_id;
    INSERT INTO public.audit_logs(actor_id, actor_email, action, entity_type, entity_id, summary, metadata)
    VALUES (v_actor, public._actor_email(v_actor), 'update', 'user', OLD.user_id::text,
            'Revoked role ' || OLD.role::text || ' from ' || COALESCE(v_email,'user'),
            jsonb_build_object('role', OLD.role, 'change', 'revoked'));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_log_user_roles
AFTER INSERT OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.log_user_roles_changes();
