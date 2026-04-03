-- =============================================================================
-- Activity Logs (Audit Light)
--
-- Lightweight audit trail: one row per user action, scoped to an organization.
-- RLS: members can only read logs for their own organization.
-- Writes exclusively via SECURITY DEFINER RPC (no direct INSERT from client).
-- =============================================================================

-- ─── 1. Table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.activity_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id     UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action_type TEXT        NOT NULL,   -- e.g. 'option_sent', 'booking_confirmed', 'model_added'
  entity_id   UUID,                   -- optional: the affected row id
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_activity_logs_org_created
  ON public.activity_logs (org_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user
  ON public.activity_logs (user_id);

-- ─── 2. RLS ───────────────────────────────────────────────────────────────────

ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Members can read logs for their own organization only.
DROP POLICY IF EXISTS "activity_logs_org_members_select" ON public.activity_logs;
CREATE POLICY "activity_logs_org_members_select"
  ON public.activity_logs FOR SELECT
  TO authenticated
  USING (public.user_is_member_of_organization(org_id));

-- No direct INSERT/UPDATE/DELETE from client — all writes via RPC.
-- (No INSERT policy = blocked for authenticated users.)

-- Admins have full access for debugging.
DROP POLICY IF EXISTS "activity_logs_admin_full_access" ON public.activity_logs;
CREATE POLICY "activity_logs_admin_full_access"
  ON public.activity_logs FOR ALL
  TO authenticated
  USING     (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE))
  WITH CHECK(EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND is_admin = TRUE));

-- ─── 3. RPC: log_activity ─────────────────────────────────────────────────────
-- Inserts an activity log entry after verifying caller is org member.
-- Safe to call fire-and-forget; never throws.

CREATE OR REPLACE FUNCTION public.log_activity(
  p_org_id      uuid,
  p_action_type text,
  p_entity_id   uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Verify caller is a member of the organization.
  IF NOT EXISTS (
    SELECT 1
    FROM public.organization_members om
    WHERE om.organization_id = p_org_id
      AND om.user_id = auth.uid()
  ) THEN
    RETURN; -- silently ignore if not a member (defensive)
  END IF;

  INSERT INTO public.activity_logs (org_id, user_id, action_type, entity_id)
  VALUES (p_org_id, auth.uid(), p_action_type, p_entity_id);

EXCEPTION WHEN OTHERS THEN
  -- Fire-and-forget: never break the calling flow.
  NULL;
END;
$$;

ALTER FUNCTION public.log_activity(uuid, text, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.log_activity(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_activity(uuid, text, uuid) TO authenticated;

-- ─── 4. RPC: get_latest_activity_log ──────────────────────────────────────────
-- Returns the single most recent activity log entry for an organization,
-- joined with the display name of the acting user.

CREATE OR REPLACE FUNCTION public.get_latest_activity_log(p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
BEGIN
  -- Verify caller is a member of the organization.
  IF NOT public.user_is_member_of_organization(p_org_id) THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  SELECT
    al.action_type,
    al.entity_id,
    al.created_at,
    COALESCE(p.display_name, p.email, 'Unknown') AS actor_name
  INTO v_row
  FROM   public.activity_logs al
  LEFT JOIN public.profiles    p ON p.id = al.user_id
  WHERE  al.org_id = p_org_id
  ORDER  BY al.created_at DESC
  LIMIT  1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'action_type', v_row.action_type,
    'entity_id',   v_row.entity_id,
    'created_at',  v_row.created_at,
    'actor_name',  v_row.actor_name
  );
END;
$$;

ALTER FUNCTION public.get_latest_activity_log(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_latest_activity_log(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_latest_activity_log(uuid) TO authenticated;
