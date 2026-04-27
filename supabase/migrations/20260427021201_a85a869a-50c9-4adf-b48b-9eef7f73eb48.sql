-- Allow lead auditors to create their own groups (where they are the lead)
CREATE POLICY "Leads create own groups"
ON public.audit_groups
FOR INSERT
TO authenticated
WITH CHECK (
  lead_auditor_id = auth.uid()
  AND has_role(auth.uid(), 'lead_auditor'::app_role)
  AND created_by = auth.uid()
);

-- Allow lead auditors to update their own groups
CREATE POLICY "Leads update own groups"
ON public.audit_groups
FOR UPDATE
TO authenticated
USING (lead_auditor_id = auth.uid())
WITH CHECK (lead_auditor_id = auth.uid());

-- Allow lead auditors to delete their own groups
CREATE POLICY "Leads delete own groups"
ON public.audit_groups
FOR DELETE
TO authenticated
USING (lead_auditor_id = auth.uid());

-- Allow lead auditors to manage members of their own groups
CREATE POLICY "Leads manage own group members"
ON public.audit_group_members
FOR ALL
TO authenticated
USING (is_group_lead(auth.uid(), group_id))
WITH CHECK (is_group_lead(auth.uid(), group_id));