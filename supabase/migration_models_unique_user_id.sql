-- migration_models_unique_user_id.sql
-- Prevents duplicate model rows for the same linked user account.
-- A model with user_id IS NOT NULL must be unique (one model row per user).
-- models without a linked user (user_id IS NULL) are unaffected.

-- Step 1: Identify and log duplicate user_id values before applying the constraint.
-- (Run SELECT first to inspect before applying in production.)
-- SELECT user_id, COUNT(*) FROM models WHERE user_id IS NOT NULL GROUP BY user_id HAVING COUNT(*) > 1;

-- Step 2: Deduplicate — keep the oldest row per user_id (the first accepted application row).
-- Only run this if duplicates exist. Safe to skip if no duplicates.
DO $$
DECLARE
  dup RECORD;
BEGIN
  FOR dup IN (
    SELECT user_id
    FROM models
    WHERE user_id IS NOT NULL
    GROUP BY user_id
    HAVING COUNT(*) > 1
  ) LOOP
    -- Delete all but the oldest model row for this user_id.
    DELETE FROM models
    WHERE user_id = dup.user_id
      AND id NOT IN (
        SELECT id FROM models WHERE user_id = dup.user_id ORDER BY created_at ASC LIMIT 1
      );
  END LOOP;
END;
$$;

-- Step 3: Add partial unique index — enforces one model row per linked user account.
CREATE UNIQUE INDEX IF NOT EXISTS models_user_id_unique
  ON models (user_id)
  WHERE user_id IS NOT NULL;

-- RLS note: existing policies remain unchanged. This index only prevents data duplication.
