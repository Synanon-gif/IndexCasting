-- Migration: Add label column to guest_links
-- Allows agencies to name packages (e.g. "Summer Castings 2025")

ALTER TABLE public.guest_links
  ADD COLUMN IF NOT EXISTS label TEXT;

-- Index for sorted display by label
CREATE INDEX IF NOT EXISTS idx_guest_links_label ON public.guest_links (label);
