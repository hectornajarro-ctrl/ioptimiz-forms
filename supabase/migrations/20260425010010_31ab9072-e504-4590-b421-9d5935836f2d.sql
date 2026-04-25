-- Allow admins to upload survey PDFs and response files in storage
CREATE POLICY "Admins upload survey pdfs"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'survey-pdfs'
  AND has_role(auth.uid(), 'admin')
);

-- Allow admins to insert surveys without lead_auditor role check
DROP POLICY IF EXISTS "Lead auditors create surveys" ON public.surveys;
CREATE POLICY "Lead auditors or admins create surveys"
ON public.surveys FOR INSERT
TO authenticated
WITH CHECK (
  lead_auditor_id = auth.uid()
  AND (has_role(auth.uid(), 'lead_auditor') OR has_role(auth.uid(), 'admin'))
);