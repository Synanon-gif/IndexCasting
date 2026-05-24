import { supabase } from '../../lib/supabase';
import { recordConsent } from './consentSupabase';

const LEGAL_DOCUMENT_VERSION = '1.0';

type LegalAcceptanceResult = { error: string | null };

/**
 * Persists platform ToS + Privacy acceptance (and optional agency model-rights).
 * Profiles gate flags and legal_acceptances audit row must succeed together;
 * consent_log sync remains best-effort (non-fatal).
 */
export async function persistPlatformLegalAcceptance(
  userId: string,
  agencyRights: boolean,
): Promise<LegalAcceptanceResult> {
  const now = new Date().toISOString();
  const profileUpdates: Record<string, unknown> = {
    tos_accepted: true,
    privacy_accepted: true,
    tos_accepted_at: now,
    privacy_accepted_at: now,
  };
  if (agencyRights) {
    profileUpdates.agency_model_rights_accepted = true;
  }

  const { error: profileError } = await supabase
    .from('profiles')
    .update(profileUpdates)
    .eq('id', userId);
  if (profileError) {
    console.error('persistPlatformLegalAcceptance profiles update error:', profileError);
    return { error: profileError.message };
  }

  const legalRows = [
    {
      user_id: userId,
      document_type: 'terms_of_service',
      document_version: LEGAL_DOCUMENT_VERSION,
      accepted: true,
    },
    {
      user_id: userId,
      document_type: 'privacy_policy',
      document_version: LEGAL_DOCUMENT_VERSION,
      accepted: true,
    },
    ...(agencyRights
      ? [
          {
            user_id: userId,
            document_type: 'agency_model_rights',
            document_version: LEGAL_DOCUMENT_VERSION,
            accepted: true,
          },
        ]
      : []),
  ];

  const { error: legalError } = await supabase.from('legal_acceptances').insert(legalRows);
  if (legalError) {
    console.error('persistPlatformLegalAcceptance legal_acceptances insert error:', legalError);
    const rollback: Record<string, unknown> = {
      tos_accepted: false,
      privacy_accepted: false,
      tos_accepted_at: null,
      privacy_accepted_at: null,
    };
    if (agencyRights) {
      rollback.agency_model_rights_accepted = false;
    }
    const { error: rollbackError } = await supabase
      .from('profiles')
      .update(rollback)
      .eq('id', userId);
    if (rollbackError) {
      console.error(
        'persistPlatformLegalAcceptance profile rollback after legal insert failed:',
        rollbackError,
      );
    }
    return { error: legalError.message ?? 'legal_acceptance_failed' };
  }

  try {
    await recordConsent(userId, 'terms', LEGAL_DOCUMENT_VERSION);
    await recordConsent(userId, 'privacy', LEGAL_DOCUMENT_VERSION);
    if (agencyRights) {
      await recordConsent(userId, 'image_rights', LEGAL_DOCUMENT_VERSION);
    }
  } catch (consentErr) {
    console.warn(
      'persistPlatformLegalAcceptance: consent_log sync failed (non-fatal):',
      consentErr,
    );
  }

  return { error: null };
}
