-- Allow lead auditors to delete their own draft surveys, and admins to delete any draft survey
CREATE POLICY "Lead deletes own draft surveys"
ON public.surveys
FOR DELETE
TO authenticated
USING (lead_auditor_id = auth.uid() AND status = 'draft');

CREATE POLICY "Admin deletes draft surveys"
ON public.surveys
FOR DELETE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) AND status = 'draft');