-- F-02 Security fix: Ensure recruiting_chat_messages INSERT policy exists in migrations/
-- (previously only in root-SQL). Also removes deprecated email-matching branch
-- (Gefahr 2: rls-security-patterns.mdc) and replaces with org-membership + bookers.
--
-- Policy enforces:
--   from_role='agency'  → caller must be org-member of thread's agency OR legacy booker
--   from_role='model'   → caller must be the applicant (applicant_user_id = auth.uid())
--   from_role='system'  → blocked (no system messages in recruiting chat)

DROP POLICY IF EXISTS "recruiting_messages_insert" ON public.recruiting_chat_messages;

CREATE POLICY "recruiting_messages_insert"
  ON public.recruiting_chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (
      from_role = 'agency'::chat_sender_type
      AND EXISTS (
        SELECT 1
        FROM public.recruiting_chat_threads t
        WHERE t.id = recruiting_chat_messages.thread_id
          AND (
            -- Agency member via organization_members
            (t.agency_id IS NOT NULL AND EXISTS (
              SELECT 1
              FROM public.organization_members om
              JOIN public.organizations o ON o.id = om.organization_id
              WHERE om.user_id = auth.uid()
                AND o.agency_id = t.agency_id
            ))
            OR
            -- Legacy booker fallback
            (t.agency_id IS NOT NULL AND EXISTS (
              SELECT 1
              FROM public.bookers b
              WHERE b.agency_id = t.agency_id
                AND b.user_id = auth.uid()
            ))
            OR
            -- Thread without agency (created_by = caller)
            (t.agency_id IS NULL AND t.created_by = auth.uid())
          )
      )
    )
    OR
    (
      from_role = 'model'::chat_sender_type
      AND EXISTS (
        SELECT 1
        FROM public.recruiting_chat_threads t
        JOIN public.model_applications app ON app.id = t.application_id
        WHERE t.id = recruiting_chat_messages.thread_id
          AND app.applicant_user_id = auth.uid()
      )
    )
  );
