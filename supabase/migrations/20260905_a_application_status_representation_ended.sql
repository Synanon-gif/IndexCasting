-- Enum extension only (own migration — PG: ADD VALUE must not share a transaction with first use).
ALTER TYPE public.application_status ADD VALUE IF NOT EXISTS 'representation_ended';
