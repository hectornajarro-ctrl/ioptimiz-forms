-- Remove duplicate group (keep the earliest one created)
DELETE FROM public.audit_groups WHERE id = '95c7b4ae-869d-4e76-b419-9bb82927cb05';

-- Prevent the same lead from creating two groups with the same name (case-insensitive)
CREATE UNIQUE INDEX IF NOT EXISTS audit_groups_lead_name_unique
  ON public.audit_groups (lead_auditor_id, lower(name));