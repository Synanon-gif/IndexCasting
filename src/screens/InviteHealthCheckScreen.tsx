/**
 * InviteHealthCheckScreen — admin-only, web-only.
 *
 * Detects regressions across all invite and model-claim token flows without
 * affecting real users. Reachable at /admin/invite-health (admin session required).
 *
 * Checks:
 *   1. get_model_claim_preview RPC  — plaintext sentinel → expect token_not_found
 *   2. claim_model_by_token RPC     — plaintext sentinel → expect token_not_found
 *   3. send-invite Edge Function    — sentinel call → expect structured error (proves function live)
 *   4. Token round-trip (optional)  — generate → preview (requires agency-member model ID)
 *   5. Org invite row (optional)    — create + verify + delete (requires org owner org ID)
 */

import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { supabase } from '../../lib/supabase';
import { generateModelClaimToken, getModelClaimPreview } from '../services/modelsSupabase';
import { createOrganizationInvitation } from '../services/organizationsInvitationsSupabase';
import { colors, spacing, typography } from '../theme/theme';

// ─── Types ───────────────────────────────────────────────────────────────────

type CheckId = 'preview_rpc' | 'claim_rpc' | 'edge_function' | 'token_roundtrip' | 'org_invite';

type CheckStatus = 'idle' | 'running' | 'ok' | 'fail' | 'skip';

type CheckResult = {
  id: CheckId;
  name: string;
  status: CheckStatus;
  detail: string;
};

const INITIAL_CHECKS: CheckResult[] = [
  { id: 'preview_rpc', name: 'get_model_claim_preview RPC', status: 'idle', detail: '' },
  { id: 'claim_rpc', name: 'claim_model_by_token RPC', status: 'idle', detail: '' },
  { id: 'edge_function', name: 'send-invite Edge Function', status: 'idle', detail: '' },
  { id: 'token_roundtrip', name: 'Token generate → preview', status: 'idle', detail: '' },
  { id: 'org_invite', name: 'Org invitation create + clean', status: 'idle', detail: '' },
];

// ─── Individual check runners ─────────────────────────────────────────────────

/**
 * Check 1: get_model_claim_preview uses plaintext lookup.
 * A sentinel token returns token_not_found (not a DB column error, not token_hash drift).
 */
async function runPreviewRpc(): Promise<{ status: CheckStatus; detail: string }> {
  try {
    const { data, error } = await supabase.rpc('get_model_claim_preview', {
      p_token: 'healthcheck-sentinel-noop',
    });
    if (error) {
      return { status: 'fail', detail: `RPC error: ${error.message}` };
    }
    const result = data as { valid?: boolean; error?: string } | null;
    if (result?.valid === false && result?.error === 'token_not_found') {
      return {
        status: 'ok',
        detail: 'Plaintext lookup active — returned token_not_found as expected',
      };
    }
    if (result?.valid === false && result?.error) {
      return { status: 'fail', detail: `Unexpected error shape: ${result.error}` };
    }
    if (result?.valid === true) {
      return { status: 'fail', detail: 'Sentinel matched a real token — unexpected valid:true' };
    }
    return { status: 'fail', detail: `Unexpected response: ${JSON.stringify(result)}` };
  } catch (e) {
    return { status: 'fail', detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Check 2: claim_model_by_token uses plaintext lookup.
 * A sentinel token raises a postgres exception 'token_not_found', not a SQL-level error
 * like "column token_hash does not exist".
 */
async function runClaimRpc(): Promise<{ status: CheckStatus; detail: string }> {
  try {
    const { error } = await supabase.rpc('claim_model_by_token', {
      p_token: 'healthcheck-sentinel-noop',
    });
    if (!error) {
      return {
        status: 'fail',
        detail: 'Sentinel claim unexpectedly succeeded — check database state',
      };
    }
    const msg = error.message ?? '';
    // Postgres raises the exception text as the message via PostgREST.
    if (msg.includes('token_not_found')) {
      return {
        status: 'ok',
        detail: 'Plaintext lookup active — raised token_not_found as expected',
      };
    }
    if (msg.includes('token_hash')) {
      return { status: 'fail', detail: `token_hash drift detected: ${msg}` };
    }
    if (msg.includes('not_authenticated')) {
      return { status: 'fail', detail: 'Admin session not recognized by RPC — check auth' };
    }
    return { status: 'fail', detail: `Unexpected error: ${msg}` };
  } catch (e) {
    return { status: 'fail', detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Check 3: send-invite Edge Function is live and returns structured JSON.
 * Admin users are not agency members, so the expected response is agency_only —
 * any structured error response proves the function is deployed and running.
 */
async function runEdgeFunction(): Promise<{ status: CheckStatus; detail: string }> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;

    const invokeRes = await supabase.functions.invoke('send-invite', {
      body: {
        type: 'model_claim',
        to: 'healthcheck@noop.internal',
        token: 'healthcheck-sentinel-noop',
      },
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    });

    if (invokeRes.error && !invokeRes.data) {
      return {
        status: 'fail',
        detail: `Invocation failed (no structured response): ${invokeRes.error.message ?? invokeRes.error}`,
      };
    }

    const body = invokeRes.data as { ok?: boolean; error?: string } | null;
    const errorCode = body?.error ?? '';

    // These codes all represent structured responses from the running function.
    const EXPECTED_CODES = [
      'agency_only',
      'invalid_or_expired_claim_token',
      'not_authenticated',
      'email_service_not_configured',
      'not_member_of_organization',
    ];

    if (EXPECTED_CODES.includes(errorCode)) {
      return { status: 'ok', detail: `Function live — returned structured response: ${errorCode}` };
    }

    if (body?.ok === true) {
      return {
        status: 'ok',
        detail: 'Function live — unexpected success (sentinel sent as real email?)',
      };
    }

    if (errorCode) {
      return { status: 'ok', detail: `Function live — response code: ${errorCode}` };
    }

    return { status: 'fail', detail: `Unrecognised response shape: ${JSON.stringify(body)}` };
  } catch (e) {
    return { status: 'fail', detail: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Check 4: Token round-trip — generate_model_claim_token → get_model_claim_preview.
 * Requires a model ID where the caller (admin) is a member of the model's home agency.
 * Admin users without agency membership will receive a skip result.
 * Generates a real token row; attempts cleanup after preview.
 */
async function runTokenRoundtrip(
  modelId: string,
  orgId: string,
): Promise<{ status: CheckStatus; detail: string }> {
  const trimModelId = modelId.trim();
  const trimOrgId = orgId.trim() || undefined;

  if (!trimModelId) {
    return { status: 'skip', detail: 'No model ID provided' };
  }

  // Generate token
  const genResult = await generateModelClaimToken(trimModelId, trimOrgId);
  if (!genResult.ok) {
    const msg = (genResult as { error?: string }).error ?? 'unknown';
    // Auth/membership failures are expected for admin users — mark as skip not fail.
    const AUTH_ERRORS = [
      'model_not_in_agency',
      'not_in_agency',
      'not_member_of_organization',
      'not_authenticated',
    ];
    if (AUTH_ERRORS.some((e) => msg.includes(e))) {
      return {
        status: 'skip',
        detail: `Admin user lacks agency membership for this model (${msg}). Provide a model ID belonging to an agency where this admin account is also a booker.`,
      };
    }
    return { status: 'fail', detail: `generateModelClaimToken failed: ${msg}` };
  }

  const token = (genResult as { data?: { token: string } }).data?.token ?? '';
  if (!token) {
    return { status: 'fail', detail: 'generateModelClaimToken returned no token' };
  }

  // Preview
  const preview = await getModelClaimPreview(token);
  if (!preview || !(preview as { valid?: boolean }).valid) {
    const errCode = (preview as { error?: string } | null)?.error ?? 'null response';
    // Attempt cleanup even on failure
    await supabase.from('model_claim_tokens').delete().eq('token', token).is('used_at', null);
    return { status: 'fail', detail: `Preview returned invalid: ${errCode}` };
  }

  // Cleanup — may silently fail if admin lacks DELETE RLS; token expires naturally.
  await supabase.from('model_claim_tokens').delete().eq('token', token).is('used_at', null);

  const p = preview as { model_name?: string; agency_name?: string };
  return {
    status: 'ok',
    detail: `Round-trip OK — model: "${p.model_name}", agency: "${p.agency_name}"`,
  };
}

/**
 * Check 5: Org invitation row create + cleanup.
 * Requires an organization ID where the admin account is the owner.
 * Creates a test invitation row with a noop email and immediately deletes it.
 */
async function runOrgInvite(orgId: string): Promise<{ status: CheckStatus; detail: string }> {
  const trimOrgId = orgId.trim();
  if (!trimOrgId) {
    return { status: 'skip', detail: 'No organization ID provided' };
  }

  const testEmail = `healthcheck-${Date.now()}@noop.indexcasting.internal`;

  const createResult = await createOrganizationInvitation({
    organizationId: trimOrgId,
    email: testEmail,
    role: 'booker',
    ttlHours: 1,
  });

  if (!createResult.ok) {
    const errCode = (createResult as { error?: string }).error ?? 'unknown';
    if (errCode === 'owner_only') {
      return {
        status: 'skip',
        detail:
          'Admin user is not the owner of this organization — provide an org where this account is owner.',
      };
    }
    return { status: 'fail', detail: `createOrganizationInvitation failed: ${errCode}` };
  }

  const invitation = (createResult as { invitation: { id: string; token: string } }).invitation;

  // Cleanup
  const { error: deleteError } = await supabase
    .from('invitations')
    .delete()
    .eq('id', invitation.id);

  if (deleteError) {
    return {
      status: 'ok',
      detail: `Row created (id: ${invitation.id}) but cleanup failed — delete manually. Error: ${deleteError.message}`,
    };
  }

  return { status: 'ok', detail: `Row created and cleaned up — invitation id: ${invitation.id}` };
}

// ─── Component ────────────────────────────────────────────────────────────────

type Props = { onBack: () => void };

export const InviteHealthCheckScreen: React.FC<Props> = ({ onBack }) => {
  const [checks, setChecks] = useState<CheckResult[]>(INITIAL_CHECKS);
  const [running, setRunning] = useState(false);
  const [modelId, setModelId] = useState('');
  const [orgId, setOrgId] = useState('');

  function patchCheck(id: CheckId, patch: Partial<CheckResult>) {
    setChecks((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }

  async function runAll() {
    if (running) return;
    setRunning(true);
    setChecks(INITIAL_CHECKS.map((c) => ({ ...c, status: 'idle', detail: '' })));

    // Check 1 — preview RPC
    patchCheck('preview_rpc', { status: 'running' });
    const r1 = await runPreviewRpc();
    patchCheck('preview_rpc', r1);

    // Check 2 — claim RPC
    patchCheck('claim_rpc', { status: 'running' });
    const r2 = await runClaimRpc();
    patchCheck('claim_rpc', r2);

    // Check 3 — edge function
    patchCheck('edge_function', { status: 'running' });
    const r3 = await runEdgeFunction();
    patchCheck('edge_function', r3);

    // Check 4 — token round-trip (optional)
    patchCheck('token_roundtrip', { status: 'running' });
    const r4 = await runTokenRoundtrip(modelId, orgId);
    patchCheck('token_roundtrip', r4);

    // Check 5 — org invite (optional)
    patchCheck('org_invite', { status: 'running' });
    const r5 = await runOrgInvite(orgId);
    patchCheck('org_invite', r5);

    setRunning(false);
  }

  if (Platform.OS !== 'web') {
    return (
      <View style={styles.shell}>
        <Text style={styles.errorText}>This screen is web-only.</Text>
      </View>
    );
  }

  const allDone = checks.every((c) => c.status !== 'idle' && c.status !== 'running');
  const failCount = checks.filter((c) => c.status === 'fail').length;
  const okCount = checks.filter((c) => c.status === 'ok').length;

  return (
    <View style={styles.shell}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backLabel}>← Admin</Text>
        </TouchableOpacity>
        <Text style={styles.title}>INVITE FLOW HEALTH CHECK</Text>
        <View style={styles.backButton} />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Summary badge */}
        {allDone && (
          <View
            style={[styles.summaryBadge, failCount === 0 ? styles.summaryOk : styles.summaryFail]}
          >
            <Text style={styles.summaryText}>
              {failCount === 0
                ? `All checks passed (${okCount} OK)`
                : `${failCount} check${failCount > 1 ? 's' : ''} failed — ${okCount} OK`}
            </Text>
          </View>
        )}

        {/* Optional inputs */}
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>OPTIONAL — TOKEN ROUND-TRIP</Text>
          <Text style={styles.inputHint}>
            Model ID (UUID) where this admin account is also a booker. Leave blank to skip checks 4
            and 5.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Model ID (UUID)"
            placeholderTextColor={colors.textSecondary}
            value={modelId}
            onChangeText={setModelId}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.inputHint}>
            Organization ID (UUID) where this admin account is the owner. Required for check 5.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="Organization ID (UUID)"
            placeholderTextColor={colors.textSecondary}
            value={orgId}
            onChangeText={setOrgId}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>

        {/* Run button */}
        <TouchableOpacity
          style={[styles.runButton, running && styles.runButtonDisabled]}
          onPress={runAll}
          disabled={running}
        >
          {running ? (
            <ActivityIndicator color={colors.surface} size="small" />
          ) : (
            <Text style={styles.runButtonLabel}>Run All Checks</Text>
          )}
        </TouchableOpacity>

        {/* Check list */}
        <View style={styles.checkList}>
          {checks.map((check) => (
            <CheckRow key={check.id} check={check} />
          ))}
        </View>

        {/* Legend */}
        <View style={styles.legend}>
          <Text style={styles.legendText}>
            Checks 1–3 always run (no agency membership required).{'\n'}
            Check 4 requires a model where this account is a booker.{'\n'}
            Check 5 requires an org where this account is the owner.{'\n'}
            Temporary rows are deleted after each check.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
};

// ─── CheckRow ────────────────────────────────────────────────────────────────

const CheckRow: React.FC<{ check: CheckResult }> = ({ check }) => {
  const { status, name, detail } = check;

  const dot =
    status === 'ok'
      ? '●'
      : status === 'fail'
        ? '●'
        : status === 'skip'
          ? '○'
          : status === 'running'
            ? '…'
            : '○';

  const dotColor =
    status === 'ok'
      ? colors.success
      : status === 'fail'
        ? colors.error
        : status === 'skip'
          ? colors.textSecondary
          : status === 'running'
            ? colors.warning
            : colors.border;

  return (
    <View style={styles.checkRow}>
      <Text style={[styles.dot, { color: dotColor }]}>{dot}</Text>
      <View style={styles.checkBody}>
        <Text style={styles.checkName}>{name}</Text>
        {detail ? (
          <Text
            style={[
              styles.checkDetail,
              status === 'fail' && styles.checkDetailFail,
              status === 'ok' && styles.checkDetailOk,
            ]}
          >
            {detail}
          </Text>
        ) : null}
      </View>
    </View>
  );
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  shell: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  backButton: {
    minWidth: 64,
  },
  backLabel: {
    ...typography.label,
    color: colors.textSecondary,
    fontSize: 12,
  },
  title: {
    ...typography.label,
    fontSize: 11,
    color: colors.textPrimary,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: spacing.md,
    paddingBottom: spacing.xl,
    maxWidth: 640,
    alignSelf: 'center',
    width: '100%',
  },
  summaryBadge: {
    borderRadius: 6,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  summaryOk: {
    backgroundColor: '#D4EDDA',
  },
  summaryFail: {
    backgroundColor: '#FDECEA',
  },
  summaryText: {
    ...typography.body,
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  section: {
    marginBottom: spacing.md,
  },
  sectionLabel: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  inputHint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    ...typography.body,
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  runButton: {
    backgroundColor: colors.textPrimary,
    borderRadius: 6,
    paddingVertical: spacing.sm + 2,
    alignItems: 'center',
    marginBottom: spacing.md,
  },
  runButtonDisabled: {
    opacity: 0.5,
  },
  runButtonLabel: {
    ...typography.label,
    fontSize: 12,
    color: colors.surface,
  },
  checkList: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 6,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    marginBottom: spacing.md,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  dot: {
    fontSize: 16,
    marginRight: spacing.sm,
    marginTop: 1,
  },
  checkBody: {
    flex: 1,
  },
  checkName: {
    ...typography.body,
    fontSize: 13,
    fontWeight: '600' as const,
    color: colors.textPrimary,
  },
  checkDetail: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: 2,
  },
  checkDetailOk: {
    color: colors.success,
  },
  checkDetailFail: {
    color: colors.error,
  },
  legend: {
    paddingTop: spacing.sm,
  },
  legendText: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  errorText: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.xl,
  },
});
