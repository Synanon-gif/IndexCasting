-- Align audit_trail.action_type CHECK with TypeScript AuditActionType / product emitters
-- (fixes 23514 on option_price_accepted, option_request_deleted, etc.)

ALTER TABLE public.audit_trail DROP CONSTRAINT IF EXISTS audit_trail_action_type_check;

ALTER TABLE public.audit_trail
  ADD CONSTRAINT audit_trail_action_type_check CHECK (action_type IN (
    -- GDPR
    'user_deleted', 'user_deletion_requested', 'user_deletion_cancelled',
    'org_deleted', 'data_exported',
    -- Bookings
    'booking_created', 'booking_confirmed', 'booking_cancelled',
    'booking_agency_accepted', 'booking_model_confirmed', 'booking_completed',
    -- Price / option negotiations
    'option_sent', 'option_price_proposed', 'option_price_countered',
    'option_price_accepted', 'option_price_rejected',
    'option_confirmed', 'option_rejected',
    'option_schedule_updated', 'option_document_uploaded',
    'option_request_deleted',
    -- Recruiting / Casting
    'application_accepted', 'application_rejected',
    -- Profile edits
    'profile_updated', 'model_created', 'model_updated', 'model_removed',
    'model_visibility_changed',
    -- Image rights
    'image_rights_confirmed', 'image_uploaded', 'image_deleted',
    -- Minor consent
    'minor_flagged', 'minor_guardian_consent', 'minor_agency_confirmed',
    -- Team
    'member_invited', 'member_removed', 'member_role_changed',
    -- Admin
    'admin_override', 'admin_profile_updated', 'admin_subscription_changed',
    -- Security
    'login_failed', 'permission_denied', 'suspicious_activity'
  ));
