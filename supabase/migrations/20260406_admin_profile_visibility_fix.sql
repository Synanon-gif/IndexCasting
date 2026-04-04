-- ============================================================================
-- Admin Profile Visibility Fix — 2026-04-06 (Part 2)
--
-- Problem 1 (CRITICAL): Previous migration revoked SELECT (role) from authenticated.
--   The `role` column is read in PROFILE_FIELDS by every app user for routing.
--   This broke auth for ALL users. → GRANT SELECT (role) back.
--
-- Problem 2: Admin profile must NOT be visible to other users.
--   The `role = 'admin'` value in a profile row can expose admin identity to
--   any user who sees the admin's profile row (e.g. in the same org or conversation).
--   → Rebuild profiles_org_scoped_read to exclude the admin profile from
--     all non-self viewers (UUID-pinned: the admin is the only match).
--
-- Problem 3: Admin is identified by UUID+email+is_admin (three-layer pin).
--   Since role='admin' is no longer used as an access gate (code already fixed),
--   it is safe to keep the column readable — the bypass path is eliminated in code.
--
-- ADMIN_UUID: fb0ab854-d0c3-4e09-a39c-269d60246927
-- ============================================================================

-- ── 1. Restore SELECT (role) for authenticated ────────────────────────────────
--
-- Role is essential for app routing (roleFromProfile(), org-gate, activation gate).
-- The `role='admin'` bypass was removed from code; the column value alone is harmless.

GRANT SELECT (role) ON public.profiles TO authenticated;

-- ── 2. Rebuild profiles_org_scoped_read: hide admin profile from other users ──
--
-- Admin's profile (UUID-pinned) is ONLY visible to the admin themselves.
-- Regular user profiles remain visible per the existing org/conversation/model rules.

DROP POLICY IF EXISTS "profiles_org_scoped_read" ON public.profiles;

CREATE POLICY "profiles_org_scoped_read"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    -- Always: every user can read their own profile
    id = auth.uid()

    -- Exclude admin profile from ALL non-self visibility.
    -- Any other viewer hits none of the conditions below (they return no rows
    -- for the admin UUID), so the admin profile is invisible to regular users.
    OR (
      profiles.id != 'fb0ab854-d0c3-4e09-a39c-269d60246927'
      AND (
        -- Same-org members (booker↔booker, owner↔booker, client employees, etc.)
        id IN (
          SELECT om2.user_id
          FROM   public.organization_members om2
          WHERE  om2.organization_id IN (
            SELECT om1.organization_id
            FROM   public.organization_members om1
            WHERE  om1.user_id = auth.uid()
          )
        )

        -- Cross-org conversation participants (B2B messenger display_name resolution)
        OR EXISTS (
          SELECT 1
          FROM   public.conversations c
          WHERE  auth.uid() = ANY(c.participant_ids)
            AND  profiles.id = ANY(c.participant_ids)
        )

        -- Models in the caller's agency that have a linked user account
        OR id IN (
          SELECT m.user_id
          FROM   public.models m
          WHERE  m.user_id IS NOT NULL
            AND  EXISTS (
              SELECT 1
              FROM   public.organizations       o
              JOIN   public.organization_members om ON om.organization_id = o.id
              WHERE  o.agency_id  = m.agency_id
                AND  om.user_id   = auth.uid()
            )
        )
      )
    )
  );

-- ── 3. Verification ───────────────────────────────────────────────────────────
-- Admin profile invisible to other users:
--   As a non-admin user, run:
--   SELECT id, role FROM profiles WHERE id = 'fb0ab854-d0c3-4e09-a39c-269d60246927';
--   → should return 0 rows.
--
-- Admin can still read their own profile:
--   As the admin user, run:
--   SELECT id, role FROM profiles WHERE id = auth.uid();
--   → returns 1 row with role='admin'.
--
-- Regular users still see same-org colleagues:
--   SELECT id, display_name FROM profiles WHERE id IN (
--     SELECT user_id FROM organization_members
--     WHERE organization_id = (SELECT organization_id FROM organization_members WHERE user_id = auth.uid())
--   );
--   → returns org member profiles (excluding admin UUID).
-- ============================================================================
