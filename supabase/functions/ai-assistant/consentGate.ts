/** Must match `public.ai_assistant_expected_consent_version()` in migrations. */
export const AI_ASSISTANT_CONSENT_VERSION = 'v1_2026_ai_terms';

export const AI_ASSISTANT_CONSENT_REQUIRED_ANSWER =
  'AI usage requires acceptance of AI Assistant terms.';

type SupabaseRpc = {
  rpc: (
    name: string,
    args?: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: { message?: string; code?: string } | null }>;
};

/** When `organizationId` is set, user must have an active consent row for the current version. */
export async function gateAiAssistantConsent(
  supabase: SupabaseRpc,
  organizationId: string | null,
): Promise<boolean> {
  if (!organizationId) {
    return true;
  }
  const { data, error } = await supabase.rpc('ai_assistant_assert_consent_for_ai', {
    p_organization_id: organizationId,
  });
  if (error || data !== true) {
    return false;
  }
  return true;
}
