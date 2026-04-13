/**
 * Client organization: team roster + invitations (same tables/RPCs as agency booker invites).
 * English UI; organization members can manage team settings based on role policy.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import {
  ensureClientOrganization,
  listOrganizationMembers,
  listInvitationsForOrganization,
  createOrganizationInvitation,
  buildOrganizationInviteUrl,
  removeOrganizationMember,
  type InvitationRow,
} from '../services/organizationsInvitationsSupabase';
import { uiCopy } from '../constants/uiCopy';
import { useAuth } from '../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { describeSendInviteFailure, resendInviteEmail } from '../services/inviteDelivery';
import { isClientOperationalMember, isOrganizationOwner } from '../services/orgRoleTypes';
import { showAppAlert, showConfirmAlert } from '../utils/crossPlatformAlert';

const inputStyle = {
  borderWidth: 1,
  borderColor: colors.border,
  borderRadius: 12,
  paddingHorizontal: spacing.md,
  paddingVertical: spacing.sm,
  ...typography.body,
  color: colors.textPrimary,
} as const;

function roleLabel(role: string): string {
  if (role === 'owner') return uiCopy.team.roleOwner;
  if (role === 'booker') return uiCopy.team.roleBooker;
  if (role === 'employee') return uiCopy.team.roleEmployee;
  return role;
}

export const ClientOrganizationTeamSection: React.FC<{
  /** Supabase profile id of the authenticated client; null when not available. */
  realClientId: string | null;
}> = ({ realClientId }) => {
  const { profile, updateDisplayName } = useAuth();
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<Awaited<ReturnType<typeof listOrganizationMembers>>>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'employee'>('employee');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [nameInput, setNameInput] = useState(profile?.display_name ?? '');
  const [removingUserId, setRemovingUserId] = useState<string | null>(null);
  const [resendingInvitationId, setResendingInvitationId] = useState<string | null>(null);
  const [resendInvitationCooldownUntil, setResendInvitationCooldownUntil] = useState<Record<string, number>>({});

  useEffect(() => {
    setNameInput(profile?.display_name ?? '');
  }, [profile?.display_name]);
  const [nameBusy, setNameBusy] = useState(false);

  const loadTeam = useCallback(async () => {
    if (!realClientId) {
      setOrganizationId(null);
      setTeamMembers([]);
      setInvitations([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const oid = await ensureClientOrganization();
      setOrganizationId(oid);
      if (oid) {
        const [members, inv] = await Promise.all([
          listOrganizationMembers(oid),
          listInvitationsForOrganization(oid),
        ]);
        setTeamMembers(members);
        setInvitations(inv);
      } else {
        setTeamMembers([]);
        setInvitations([]);
      }
    } catch (e) {
      console.error('ClientOrganizationTeamSection loadTeam error:', e);
      showAppAlert(uiCopy.common.error, uiCopy.team.loadTeamError ?? 'Could not load team data.');
    } finally {
      setLoading(false);
    }
  }, [realClientId]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  const handleSaveName = async () => {
    if (!nameInput.trim()) return;
    setNameBusy(true);
    const { error } = await updateDisplayName(nameInput);
    setNameBusy(false);
    if (error) {
      showAppAlert(uiCopy.common.error, uiCopy.team.ownerDisplayNameError);
    } else {
      showAppAlert(uiCopy.team.ownerDisplayNameLabel, uiCopy.team.ownerDisplayNameSaved);
      void loadTeam();
    }
  };

  const handleInvite = async () => {
    if (!organizationId || !inviteEmail.trim()) return;
    if (!isOrganizationOwner(profile?.org_member_role)) {
      showAppAlert(uiCopy.team.permissionAlertTitle, uiCopy.team.permissionAlertOwnerOnly);
      return;
    }
    setInviteBusy(true);
    try {
      const result = await createOrganizationInvitation({
        organizationId,
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      if (result.ok) {
        const row = result.invitation;
        const link = buildOrganizationInviteUrl(row.token);

        // Email dispatch is best-effort. The invite link remains a deterministic fallback.
        let emailOk = false;
        let emailFailureReason = '';
        try {
          const { data: { session: s } } = await supabase.auth.getSession();
          const res = await supabase.functions.invoke('send-invite', {
            body: {
              type: 'org_invitation',
              to: inviteEmail.trim(),
              token: row.token,
              organization_id: organizationId,
              orgName: profile?.company_name || profile?.display_name || undefined,
              inviterName: profile?.display_name || undefined,
              invite_role: inviteRole,
            },
            headers: s?.access_token ? { Authorization: `Bearer ${s.access_token}` } : undefined,
          });
          const body = res.data as { ok?: boolean; error?: string; detail?: string } | null;
          emailOk = !res.error && body?.ok === true;
          if (!emailOk) {
            emailFailureReason = describeSendInviteFailure(res.data, res.error);
            console.error('ClientOrganizationTeamSection send-invite error:', emailFailureReason, res);
          }
        } catch (e) {
          emailFailureReason = e instanceof Error ? e.message : String(e);
          console.error('ClientOrganizationTeamSection send-invite exception:', e);
        }

        setInviteEmail('');
        showAppAlert(
          uiCopy.alerts.invitationCreated,
          emailOk
            ? uiCopy.alerts.invitationCreatedBody
            : uiCopy.inviteDelivery.invitationCreatedEmailFailedWithLink(emailFailureReason || 'unknown_error', link),
        );
        void loadTeam();
      } else if (!result.ok && result.error === 'agency_member_limit_reached') {
        showAppAlert(uiCopy.common.error, uiCopy.team.agencyPlanMemberLimitReached);
      } else if (!result.ok && result.error === 'already_invited') {
        showAppAlert(uiCopy.common.error, uiCopy.alerts.invitationAlreadyInvited);
      } else if (!result.ok && result.error === 'already_member') {
        showAppAlert(uiCopy.common.error, uiCopy.alerts.invitationAlreadyMember);
      } else if (!result.ok && result.error === 'owner_only') {
        showAppAlert(uiCopy.common.error, uiCopy.alerts.invitationOwnerOnly);
      } else {
        showAppAlert(uiCopy.common.error, uiCopy.team.invitationErrorBody);
      }
    } catch (e) {
      console.error('ClientOrganizationTeamSection handleInvite error:', e);
      showAppAlert(uiCopy.common.error, uiCopy.team.invitationErrorBody);
    } finally {
      setInviteBusy(false);
    }
  };

  const handleRemoveMember = (targetUserId: string, displayName: string) => {
    if (!organizationId) return;
    const orgId = organizationId;
    showConfirmAlert(
      'Remove Member',
      `Remove ${displayName} from the organization? Their session will be invalidated immediately.`,
      async () => {
        setRemovingUserId(targetUserId);
        try {
          const result = await removeOrganizationMember(targetUserId, orgId);
          if (result.ok) {
            setTeamMembers((prev) => prev.filter((m) => m.user_id !== targetUserId));
            showAppAlert('Member Removed', 'The member has been removed and their session has been invalidated.');
          } else {
            showAppAlert(uiCopy.common.error, result.error ?? 'Failed to remove member.');
          }
        } catch (e) {
          console.error('handleRemoveMember error:', e);
          showAppAlert(uiCopy.common.error, 'An unexpected error occurred.');
        } finally {
          setRemovingUserId(null);
        }
      },
      'Remove',
    );
  };

  const handleResendInvitation = async (invitation: InvitationRow) => {
    if (!organizationId || !invitation.email || !invitation.token || invitation.status !== 'pending') return;
    const cooldownUntil = resendInvitationCooldownUntil[invitation.id] ?? 0;
    if (Date.now() < cooldownUntil) return;
    setResendingInvitationId(invitation.id);
    const result = await resendInviteEmail({
      email: invitation.email,
      token: invitation.token,
      type: 'org_invitation',
      organization_id: organizationId,
      invite_role: 'employee',
      orgName: profile?.company_name || profile?.display_name || undefined,
      inviterName: profile?.display_name || undefined,
    });
    setResendingInvitationId(null);
    setResendInvitationCooldownUntil((prev) => ({ ...prev, [invitation.id]: Date.now() + 4000 }));
    if (result.ok) {
      showAppAlert(uiCopy.common.success, uiCopy.inviteResend.success);
      return;
    }
    const fallbackLink = buildOrganizationInviteUrl(invitation.token);
    showAppAlert(
      uiCopy.common.error,
      `${uiCopy.inviteResend.error}: ${result.error}\n\n${uiCopy.alerts.invitationLink}: ${fallbackLink}\n\n${uiCopy.inviteResend.checkSpamHint}`,
    );
  };

  if (!realClientId) {
    return (
      <Text style={styles.muted}>
        {uiCopy.team.noClientSignIn}
      </Text>
    );
  }

  if (loading) {
    return <Text style={styles.muted}>{uiCopy.team.loadingTeam}</Text>;
  }

  const pendingInv = invitations.filter((i) => i.status === 'pending');
  const acceptedInv = invitations.filter((i) => i.status === 'accepted');

  // Owner + Employee can view the team and invitation list
  const canViewTeam = isClientOperationalMember(profile?.org_member_role);
  // Only the organization owner may send invitations
  const canInvite = isOrganizationOwner(profile?.org_member_role);
  // Bookers are external team members and cannot see invitation lists
  const invitationListHiddenForMember = !canViewTeam && realClientId;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.lead}>{uiCopy.team.leadClient}</Text>
      <Text style={[styles.lead, { marginTop: spacing.sm }]}>
        {uiCopy.team.ownerRoleExplainerClient}
      </Text>

      {canInvite && (
        <View style={styles.nameBox}>
          <Text style={styles.sectionTitle}>{uiCopy.team.ownerDisplayNameLabel}</Text>
          <Text style={styles.lead}>{uiCopy.team.ownerDisplayNameHint}</Text>
          <TextInput
            value={nameInput}
            onChangeText={setNameInput}
            placeholder={uiCopy.team.ownerDisplayNamePlaceholder}
            placeholderTextColor={colors.textSecondary}
            style={[inputStyle, { marginBottom: spacing.sm }]}
          />
          <TouchableOpacity
            style={[styles.primaryBtn, (!nameInput.trim() || nameBusy) && styles.primaryBtnDisabled]}
            onPress={() => void handleSaveName()}
            disabled={nameBusy || !nameInput.trim()}
          >
            <Text style={styles.primaryBtnLabel}>{nameBusy ? '…' : uiCopy.team.ownerDisplayNameSave}</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={styles.sectionTitle}>{uiCopy.team.teamMembers}</Text>
      {teamMembers.length === 0 ? (
        <Text style={styles.muted}>{uiCopy.team.noMembersLoaded}</Text>
      ) : (
        teamMembers.map((m) => {
          const isSelf = m.user_id === realClientId;
          const displayName = m.display_name || m.email || m.user_id.slice(0, 8);
          return (
            <View key={m.id} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  {displayName} · {roleLabel(m.role)}
                </Text>
                <Text style={styles.mutedSmall}>{m.email || '—'}</Text>
              </View>
              {canInvite && !isSelf && m.role !== 'owner' && (
                <TouchableOpacity
                  onPress={() => handleRemoveMember(m.user_id, displayName)}
                  disabled={removingUserId === m.user_id}
                  style={styles.removeBtn}
                >
                  <Text style={styles.removeBtnLabel}>
                    {removingUserId === m.user_id ? '…' : 'Remove'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })
      )}

      <Text style={[styles.sectionTitle, styles.sectionSpacer]}>{uiCopy.team.pendingInvitations}</Text>
      {invitationListHiddenForMember ? (
        <Text style={styles.muted}>{uiCopy.team.invitationsHiddenForMember}</Text>
      ) : pendingInv.length === 0 ? (
        <Text style={styles.muted}>{uiCopy.team.noPendingInvitations}</Text>
      ) : (
        pendingInv.map((i) => (
          <View key={i.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>
                {i.email} · {roleLabel(i.role)}
              </Text>
              <Text style={styles.mutedSmall}>{uiCopy.team.inviteExpiresLabel} {new Date(i.expires_at).toLocaleDateString()}</Text>
            </View>
            {canInvite && i.email && i.token && (
              <TouchableOpacity
                style={[styles.primaryBtn, { marginTop: 0, marginLeft: spacing.sm, paddingHorizontal: spacing.md }]}
                onPress={() => {
                  void handleResendInvitation(i);
                }}
                disabled={resendingInvitationId === i.id || Date.now() < (resendInvitationCooldownUntil[i.id] ?? 0)}
              >
                <Text style={styles.primaryBtnLabel}>
                  {resendingInvitationId === i.id ? uiCopy.inviteResend.loading : uiCopy.inviteResend.cta}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        ))
      )}

      <Text style={[styles.sectionTitle, styles.sectionSpacer]}>{uiCopy.team.acceptedInvitations}</Text>
      {invitationListHiddenForMember ? (
        <Text style={styles.muted}>{uiCopy.team.invitationsHiddenForMember}</Text>
      ) : acceptedInv.length === 0 ? (
        <Text style={styles.muted}>{uiCopy.team.noAcceptedInvitations}</Text>
      ) : (
        acceptedInv.map((i) => (
          <View key={i.id} style={styles.row}>
            <Text style={styles.rowTitle}>
              {i.email} · {roleLabel(i.role)}
            </Text>
            <Text style={styles.mutedSmall}>{uiCopy.team.inviteAcceptedLabel} {new Date(i.created_at).toLocaleDateString()}</Text>
          </View>
        ))
      )}

      {canInvite && organizationId ? (
        <View style={styles.inviteBox}>
          <Text style={styles.sectionTitle}>{uiCopy.team.inviteSection}</Text>
          <Text style={styles.label}>{uiCopy.team.inviteEmailLabel}</Text>
          <TextInput
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder={uiCopy.team.inviteEmailPlaceholder}
            placeholderTextColor={colors.textSecondary}
            style={[inputStyle, { marginBottom: spacing.sm }]}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Text style={styles.label}>{uiCopy.team.inviteRoleLabel}</Text>
          <View style={styles.roleRow}>
            {(['employee'] as const).map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.rolePill, inviteRole === r && styles.rolePillActive]}
                onPress={() => setInviteRole(r)}
              >
                <Text style={[styles.rolePillText, inviteRole === r && styles.rolePillTextActive]}>{uiCopy.team.inviteRoleEmployee}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.primaryBtn, (!inviteEmail.trim() || inviteBusy) && styles.primaryBtnDisabled]}
            onPress={() => void handleInvite()}
            disabled={inviteBusy || !inviteEmail.trim()}
          >
            <Text style={styles.primaryBtnLabel}>
              {inviteBusy ? uiCopy.common.busyEllipsis : uiCopy.team.sendInvitation}
            </Text>
          </TouchableOpacity>
        </View>
      ) : organizationId ? (
        <Text style={[styles.muted, { marginTop: spacing.md }]}>
          {uiCopy.team.ownerOnlyInviteNote}
        </Text>
      ) : (
        <Text style={[styles.muted, { marginTop: spacing.md }]}>
          {uiCopy.team.orgNotLoaded}
        </Text>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  scroll: { flex: 1, alignSelf: 'stretch' },
  scrollContent: { paddingBottom: spacing.xl * 2 },
  lead: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    ...typography.label,
    fontSize: 13,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  sectionSpacer: { marginTop: spacing.lg },
  muted: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
  },
  mutedSmall: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
  },
  row: {
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
  },
  removeBtn: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#C0392B',
    marginLeft: spacing.sm,
  },
  removeBtnLabel: {
    ...typography.label,
    fontSize: 11,
    color: '#C0392B',
  },
  rowTitle: {
    ...typography.label,
    fontSize: 13,
    color: colors.textPrimary,
  },
  label: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
    marginBottom: 4,
  },
  nameBox: { marginTop: spacing.lg, marginBottom: spacing.lg, gap: spacing.xs },
  inviteBox: { marginTop: spacing.lg, gap: spacing.xs },
  roleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
  rolePill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rolePillActive: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.textPrimary,
  },
  rolePillText: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
  },
  rolePillTextActive: {
    color: colors.surface,
  },
  primaryBtn: {
    borderRadius: 999,
    backgroundColor: colors.accentGreen,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  primaryBtnDisabled: { opacity: 0.55 },
  primaryBtnLabel: {
    ...typography.label,
    color: colors.surface,
  },
});
