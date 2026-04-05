-- ============================================================================
-- Security Fix: Three Real Dangers — 2026-04-05
--
-- DANGER 1: profiles.is_admin = TRUE in RLS policies
--   After REVOKE SELECT (is_admin) FROM authenticated, any policy that reads
--   profiles.is_admin directly evaluates to NULL → false for all users.
--   Admin cannot see these tables at all. Fix: use is_current_user_admin().
--
--   Affected tables: activity_logs, legal_acceptances, model_embeddings (2 policies),
--   organization_daily_usage, organization_storage_usage, organization_subscriptions,
--   stippen, used_trial_emails
--
-- DANGER 2: Email-matching in RLS policies
--   Policies using JOIN profiles ON email = agency.email or get_current_user_email()
--   are insecure: email can change, multiple accounts could share an email, and it
--   bypasses the org-membership model. For every table affected, a correct
--   org-member-based policy already exists — drop the legacy email ones.
--
--   Dropped: agencies_manage_territories_delete, agencies_manage_territories_update
--            (model_agency_territories), "Agency can edit booking calendar entries"
--            (calendar_entries), email branch from recruiting_threads_select/update,
--            email branch from recruiting_messages_select.
--
-- DANGER 3: Frontend agencies[0] / email-match fallback
--   Handled in AgencyDashboardScreen.tsx — use profile.agency_id directly.
--
-- ADMIN_UUID:  fb0ab854-d0c3-4e09-a39c-269d60246927
-- ADMIN_EMAIL: rubenelge@t-online.de
-- ============================================================================

-- ── DANGER 1: Fix broken admin checks ────────────────────────────────────────

-- activity_logs
DROP POLICY IF EXISTS "activity_logs_admin_select_only" ON public.activity_logs;
CREATE POLICY "activity_logs_admin_select_only"
  ON public.activity_logs
  FOR SELECT TO authenticated
  USING (public.is_current_user_admin());

-- legal_acceptances
DROP POLICY IF EXISTS "Users can read own legal acceptances" ON public.legal_acceptances;
CREATE POLICY "Users can read own legal acceptances"
  ON public.legal_acceptances
  FOR SELECT TO authenticated
  USING (
    (user_id = auth.uid())
    OR public.is_current_user_admin()
  );

-- model_embeddings — Agency can upsert own model embeddings (ALL)
DROP POLICY IF EXISTS "Agency can upsert own model embeddings" ON public.model_embeddings;
CREATE POLICY "Agency can upsert own model embeddings"
  ON public.model_embeddings
  FOR ALL TO authenticated
  USING (
    (EXISTS (
      SELECT 1
      FROM (((profiles p
        JOIN organization_members om ON (om.user_id = p.id))
        JOIN organizations org ON ((org.id = om.organization_id) AND (org.type = 'agency'::organization_type)))
        JOIN models m ON (m.agency_id = org.agency_id))
      WHERE p.id = auth.uid()
        AND p.role = 'agent'
        AND m.id = model_embeddings.model_id
    ))
    OR public.is_current_user_admin()
  )
  WITH CHECK (
    (EXISTS (
      SELECT 1
      FROM (((profiles p
        JOIN organization_members om ON (om.user_id = p.id))
        JOIN organizations org ON ((org.id = om.organization_id) AND (org.type = 'agency'::organization_type)))
        JOIN models m ON (m.agency_id = org.agency_id))
      WHERE p.id = auth.uid()
        AND p.role = 'agent'
        AND m.id = model_embeddings.model_id
    ))
    OR public.is_current_user_admin()
  );

-- model_embeddings — Embeddings readable scoped (SELECT)
DROP POLICY IF EXISTS "Embeddings readable scoped" ON public.model_embeddings;
CREATE POLICY "Embeddings readable scoped"
  ON public.model_embeddings
  FOR SELECT TO authenticated
  USING (
    public.is_current_user_admin()
    OR (EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid() AND p.role = 'client'
    ))
    OR (EXISTS (
      SELECT 1
      FROM (((profiles p
        JOIN organization_members om ON (om.user_id = p.id))
        JOIN organizations org ON ((org.id = om.organization_id) AND (org.type = 'agency'::organization_type)))
        JOIN models m ON (m.agency_id = org.agency_id))
      WHERE p.id = auth.uid()
        AND p.role = 'agent'
        AND m.id = model_embeddings.model_id
    ))
  );

-- organization_daily_usage
DROP POLICY IF EXISTS "admin_full_access_daily_usage" ON public.organization_daily_usage;
CREATE POLICY "admin_full_access_daily_usage"
  ON public.organization_daily_usage
  FOR ALL TO authenticated
  USING     (public.is_current_user_admin())
  WITH CHECK(public.is_current_user_admin());

-- organization_storage_usage
DROP POLICY IF EXISTS "admin_full_access_storage_usage" ON public.organization_storage_usage;
CREATE POLICY "admin_full_access_storage_usage"
  ON public.organization_storage_usage
  FOR ALL TO authenticated
  USING     (public.is_current_user_admin())
  WITH CHECK(public.is_current_user_admin());

-- organization_subscriptions
DROP POLICY IF EXISTS "admin_full_access_subscriptions" ON public.organization_subscriptions;
CREATE POLICY "admin_full_access_subscriptions"
  ON public.organization_subscriptions
  FOR ALL TO authenticated
  USING     (public.is_current_user_admin())
  WITH CHECK(public.is_current_user_admin());

-- stippen
DROP POLICY IF EXISTS "Stippen readable by involved parties" ON public.stippen;
CREATE POLICY "Stippen readable by involved parties"
  ON public.stippen
  FOR SELECT TO authenticated
  USING (
    (from_user_id = auth.uid())
    OR (EXISTS (
      SELECT 1
      FROM ((models m
        JOIN organization_members om ON (true))
        JOIN organizations o ON (o.id = om.organization_id))
      WHERE m.id = stippen.to_model_id
        AND o.agency_id = m.agency_id
        AND om.user_id = auth.uid()
    ))
    OR (EXISTS (
      SELECT 1 FROM models m
      WHERE m.id = stippen.to_model_id AND m.user_id = auth.uid()
    ))
    OR public.is_current_user_admin()
  );

-- used_trial_emails
DROP POLICY IF EXISTS "used_trial_emails_admin_select" ON public.used_trial_emails;
CREATE POLICY "used_trial_emails_admin_select"
  ON public.used_trial_emails
  FOR SELECT TO authenticated
  USING (public.is_current_user_admin());


-- ── DANGER 2: Remove email-matching RLS policies ──────────────────────────────

-- model_agency_territories: legacy email-join policies.
-- org-member replacements exist: agency_members_manage_own_territories_delete/update
DROP POLICY IF EXISTS "agencies_manage_territories_delete" ON public.model_agency_territories;
DROP POLICY IF EXISTS "agencies_manage_territories_update" ON public.model_agency_territories;

-- calendar_entries: legacy email-based UPDATE.
-- org-member replacement exists: calendar_entries_update_agency
DROP POLICY IF EXISTS "Agency can edit booking calendar entries" ON public.calendar_entries;

-- recruiting_chat_threads: remove email branch from SELECT, keep org-member + applicant + created_by
DROP POLICY IF EXISTS "recruiting_threads_select" ON public.recruiting_chat_threads;
CREATE POLICY "recruiting_threads_select"
  ON public.recruiting_chat_threads
  FOR SELECT TO authenticated
  USING (
    (
      (agency_id IS NOT NULL)
      AND (EXISTS (
        SELECT 1
        FROM (organization_members om
          JOIN organizations o ON (o.id = om.organization_id))
        WHERE om.user_id = auth.uid()
          AND o.agency_id = recruiting_chat_threads.agency_id
      ))
    )
    OR (EXISTS (
      SELECT 1 FROM model_applications app
      WHERE app.id = recruiting_chat_threads.application_id
        AND app.applicant_user_id = auth.uid()
    ))
    OR (
      (agency_id IS NULL)
      AND (organization_id IS NULL)
      AND (created_by = auth.uid())
    )
  );

-- recruiting_chat_threads: remove email branch from UPDATE, keep org-member + created_by
DROP POLICY IF EXISTS "recruiting_threads_update" ON public.recruiting_chat_threads;
CREATE POLICY "recruiting_threads_update"
  ON public.recruiting_chat_threads
  FOR UPDATE TO authenticated
  USING (
    (
      (agency_id IS NOT NULL)
      AND (EXISTS (
        SELECT 1
        FROM (organization_members om
          JOIN organizations o ON (o.id = om.organization_id))
        WHERE om.user_id = auth.uid()
          AND o.agency_id = recruiting_chat_threads.agency_id
      ))
    )
    OR (
      (agency_id IS NULL)
      AND (created_by = auth.uid())
    )
  );

-- recruiting_chat_messages: remove email branch from SELECT, keep org-member + applicant + created_by
DROP POLICY IF EXISTS "recruiting_messages_select" ON public.recruiting_chat_messages;
CREATE POLICY "recruiting_messages_select"
  ON public.recruiting_chat_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM recruiting_chat_threads t
      WHERE t.id = recruiting_chat_messages.thread_id
        AND (
          (
            (t.agency_id IS NOT NULL)
            AND (EXISTS (
              SELECT 1
              FROM (organization_members om
                JOIN organizations o ON (o.id = om.organization_id))
              WHERE om.user_id = auth.uid()
                AND o.agency_id = t.agency_id
            ))
          )
          OR (EXISTS (
            SELECT 1 FROM model_applications app
            WHERE app.id = t.application_id
              AND app.applicant_user_id = auth.uid()
          ))
          OR (
            (t.agency_id IS NULL)
            AND (t.created_by = auth.uid())
          )
        )
    )
  );


-- ── Verification queries (run manually to confirm) ────────────────────────────
--
-- 1. Admin can see activity_logs:
--    SELECT count(*) FROM public.activity_logs;   -- run as admin JWT → must not be 0 if rows exist
--
-- 2. Email-match policies gone:
--    SELECT policyname FROM pg_policies
--    WHERE tablename IN ('model_agency_territories','calendar_entries','recruiting_chat_threads','recruiting_chat_messages')
--    AND qual ILIKE '%email%';
--    → 0 rows expected
--
-- 3. profiles.is_admin = true gone from all policies:
--    SELECT tablename, policyname FROM pg_policies
--    WHERE qual ILIKE '%is_admin = true%' OR qual ILIKE '%is_admin=true%';
--    → 0 rows expected
