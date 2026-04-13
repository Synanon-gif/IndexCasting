-- =============================================================================
-- B2B CONVERSATION LEGACY DEDUP + PARTICIPANT BACKFILL (2026-07-18)
--
-- Handles legacy conversations that may have been created before the org-pair
-- system was introduced. Merges duplicates and ensures all org members are
-- in participant_ids.
--
-- Step 1: Assign canonical context_id to conversations that have org IDs but
--         no b2b: prefix in context_id (legacy data).
-- Step 2: Merge duplicates — move messages to the canonical conversation
--         (oldest by created_at), delete the duplicate rows.
-- Step 3: Backfill participant_ids for all b2b conversations.
--
-- Idempotent: safe to run multiple times.
-- =============================================================================


-- ─── STEP 1: Assign b2b: context_id to legacy conversations ─────────────────

UPDATE public.conversations
SET context_id = 'b2b:' ||
  CASE WHEN client_organization_id::text < agency_organization_id::text
       THEN client_organization_id::text || ':' || agency_organization_id::text
       ELSE agency_organization_id::text || ':' || client_organization_id::text
  END
WHERE type = 'direct'
  AND client_organization_id IS NOT NULL
  AND agency_organization_id IS NOT NULL
  AND (context_id IS NULL OR context_id NOT LIKE 'b2b:%')
  AND NOT EXISTS (
    SELECT 1 FROM public.conversations c2
    WHERE c2.type = 'direct'
      AND c2.context_id = 'b2b:' ||
        CASE WHEN conversations.client_organization_id::text < conversations.agency_organization_id::text
             THEN conversations.client_organization_id::text || ':' || conversations.agency_organization_id::text
             ELSE conversations.agency_organization_id::text || ':' || conversations.client_organization_id::text
        END
      AND c2.id != conversations.id
  );


-- ─── STEP 2: Merge duplicate b2b conversations ──────────────────────────────
-- For each context_id with >1 row, keep the oldest, move messages, delete rest.

DO $$
DECLARE
  dup RECORD;
  canonical_id uuid;
BEGIN
  FOR dup IN
    SELECT context_id
    FROM public.conversations
    WHERE context_id IS NOT NULL AND context_id LIKE 'b2b:%'
    GROUP BY context_id
    HAVING count(*) > 1
  LOOP
    SELECT id INTO canonical_id
    FROM public.conversations
    WHERE context_id = dup.context_id
    ORDER BY created_at ASC
    LIMIT 1;

    UPDATE public.messages
    SET conversation_id = canonical_id
    WHERE conversation_id IN (
      SELECT id FROM public.conversations
      WHERE context_id = dup.context_id AND id != canonical_id
    );

    DELETE FROM public.conversations
    WHERE context_id = dup.context_id AND id != canonical_id;
  END LOOP;
END $$;


-- ─── STEP 3: Backfill participant_ids from current org members ───────────────

UPDATE public.conversations c
SET participant_ids = (
  SELECT array_agg(DISTINCT uid ORDER BY uid)
  FROM (
    SELECT unnest(c.participant_ids) AS uid
    UNION
    SELECT om.user_id
    FROM public.organization_members om
    WHERE om.organization_id = c.client_organization_id
    UNION
    SELECT om.user_id
    FROM public.organization_members om
    WHERE om.organization_id = c.agency_organization_id
  ) AS combined
)
WHERE c.context_id IS NOT NULL
  AND c.context_id LIKE 'b2b:%'
  AND c.client_organization_id IS NOT NULL
  AND c.agency_organization_id IS NOT NULL;


-- ─── VERIFICATION ────────────────────────────────────────────────────────────

DO $$
BEGIN
  ASSERT NOT EXISTS (
    SELECT context_id FROM public.conversations
    WHERE context_id IS NOT NULL AND context_id LIKE 'b2b:%'
    GROUP BY context_id HAVING count(*) > 1
  ), 'FAIL: duplicate b2b context_ids still exist after dedup';

  RAISE NOTICE 'B2B LEGACY DEDUP COMPLETE — no duplicates remain';
END $$;
