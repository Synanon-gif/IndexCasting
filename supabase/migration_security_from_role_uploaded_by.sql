-- =============================================================================
-- Security Fix: from_role Enforcement + uploaded_by Enforcement
--
-- H-1 (HIGH): from_role in option_request_messages is caller-controlled.
--   A client could claim from_role = 'agency' to spoof the sender identity,
--   corrupting notification routing and workflow logic.
--   Fix: BEFORE INSERT trigger validates from_role against auth.uid()'s actual
--   membership in the parent option request's agency / client / model.
--
-- H-2 (HIGH): uploaded_by in option_documents is a free-text string.
--   Any value can be sent by the caller, enabling authorship spoofing and
--   breaking the option_documents_delete_own RLS policy (which checks
--   uploaded_by = auth.uid()::text).
--   Fix: BEFORE INSERT trigger overwrites uploaded_by with auth.uid()::text
--   regardless of what the caller provided.
--
-- Security Audit 2026-04.
-- Idempotent: CREATE OR REPLACE + DROP TRIGGER IF EXISTS.
-- =============================================================================


-- ─── H-1: Enforce from_role matches caller's actual org role ─────────────────

CREATE OR REPLACE FUNCTION public.trg_enforce_option_message_from_role()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agency_id   uuid;
  v_model_id    uuid;
  v_org_id      uuid;
  v_client_id   uuid;
BEGIN
  -- Load the parent option request fields we need for all checks.
  SELECT agency_id, model_id, organization_id, client_id
    INTO v_agency_id, v_model_id, v_org_id, v_client_id
    FROM public.option_requests
   WHERE id = NEW.option_request_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'option_request_messages: parent option request % not found',
      NEW.option_request_id;
  END IF;

  -- ── 'agency' from_role: caller must be an agency org member ────────────────
  IF NEW.from_role = 'agency' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.organizations o
      JOIN public.organization_members m ON m.organization_id = o.id
      WHERE o.agency_id = v_agency_id
        AND o.type      = 'agency'
        AND m.user_id   = auth.uid()
    ) THEN
      RAISE EXCEPTION
        'from_role validation failed: caller is not a member of the agency for this option request';
    END IF;

  -- ── 'client' from_role: caller must be the direct client or org member ─────
  ELSIF NEW.from_role = 'client' THEN
    IF NOT (
      -- Legacy direct client
      v_client_id = auth.uid()
      -- Modern client org member
      OR (v_org_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.organization_members m
        JOIN public.organizations o ON o.id = m.organization_id
        WHERE m.organization_id = v_org_id
          AND o.type            = 'client'
          AND m.user_id         = auth.uid()
      ))
    ) THEN
      RAISE EXCEPTION
        'from_role validation failed: caller is not the client for this option request';
    END IF;

  -- ── 'model' from_role: caller must be the model's linked user ──────────────
  ELSIF NEW.from_role = 'model' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.models mo
      WHERE mo.id      = v_model_id
        AND mo.user_id = auth.uid()
    ) THEN
      RAISE EXCEPTION
        'from_role validation failed: caller is not the model linked to this option request';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Only service_role and postgres may call this function directly.
-- It is invoked exclusively as a trigger.
REVOKE EXECUTE ON FUNCTION public.trg_enforce_option_message_from_role() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_option_message_from_role
  ON public.option_request_messages;

CREATE TRIGGER enforce_option_message_from_role
  BEFORE INSERT
  ON public.option_request_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_enforce_option_message_from_role();

COMMENT ON FUNCTION public.trg_enforce_option_message_from_role() IS
  'Validates that from_role matches auth.uid()''s actual membership role for the '
  'parent option request. Prevents clients from spoofing agency identity (and '
  'vice versa). H-1 fix — Security Audit 2026-04.';


-- ─── H-2: Overwrite uploaded_by with auth.uid()::text ────────────────────────

CREATE OR REPLACE FUNCTION public.trg_set_option_document_uploaded_by()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Always overwrite the caller-supplied value with the authenticated uid.
  -- This makes the option_documents_delete_own RLS policy reliable and prevents
  -- authorship spoofing regardless of what the client passes in the request.
  NEW.uploaded_by := auth.uid()::text;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.trg_set_option_document_uploaded_by() FROM PUBLIC;

DROP TRIGGER IF EXISTS enforce_option_document_uploaded_by
  ON public.option_documents;

CREATE TRIGGER enforce_option_document_uploaded_by
  BEFORE INSERT
  ON public.option_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_set_option_document_uploaded_by();

COMMENT ON FUNCTION public.trg_set_option_document_uploaded_by() IS
  'Overwrites uploaded_by with auth.uid()::text on every INSERT into option_documents, '
  'regardless of the caller-supplied value. Makes the delete_own RLS policy reliable '
  'and prevents authorship spoofing. H-2 fix — Security Audit 2026-04.';


-- ─── Verification ─────────────────────────────────────────────────────────────

SELECT tgname, tgenabled
FROM   pg_trigger
WHERE  tgrelid IN (
  'public.option_request_messages'::regclass,
  'public.option_documents'::regclass
)
  AND tgname IN (
    'enforce_option_message_from_role',
    'enforce_option_document_uploaded_by'
  );
