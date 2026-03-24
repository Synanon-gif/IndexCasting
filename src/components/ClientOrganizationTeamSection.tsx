/**
 * Client organization: team roster + invitations (same tables/RPCs as agency booker invites).
 * English UI; organization members can manage team settings based on role policy.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import {
  ensureClientOrganization,
  listOrganizationMembers,
  listInvitationsForOrganization,
  createOrganizationInvitation,
  buildOrganizationInviteUrl,
  getMyClientMemberRole,
  type InvitationRow,
} from '../services/organizationsInvitationsSupabase';
import { uiCopy } from '../constants/uiCopy';

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
  if (role === 'owner') return 'Owner';
  if (role === 'booker') return 'Booker';
  if (role === 'employee') return 'Employee';
  return role;
}

export const ClientOrganizationTeamSection: React.FC<{
  /** Supabase profile id when logged in as client; null in demo mode */
  realClientId: string | null;
}> = ({ realClientId }) => {
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const [teamMembers, setTeamMembers] = useState<Awaited<ReturnType<typeof listOrganizationMembers>>>([]);
  const [invitations, setInvitations] = useState<InvitationRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'employee'>('employee');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [memberRole, setMemberRole] = useState<'owner' | 'employee' | 'booker' | null>(null);

  const loadTeam = useCallback(async () => {
    if (!realClientId) {
      setOrganizationId(null);
      setTeamMembers([]);
      setInvitations([]);
      setMemberRole(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const oid = await ensureClientOrganization();
      setOrganizationId(oid);
      const roleRow = await getMyClientMemberRole();
      setMemberRole((roleRow?.member_role as 'owner' | 'employee' | 'booker' | null) ?? null);
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
    } finally {
      setLoading(false);
    }
  }, [realClientId]);

  useEffect(() => {
    void loadTeam();
  }, [loadTeam]);

  const handleInvite = async () => {
    if (!organizationId || !inviteEmail.trim()) return;
    const canManageClientSettings = memberRole === 'owner' || memberRole === 'employee';
    if (!canManageClientSettings) {
      Alert.alert('Permission', 'Only owner/employee members can send invitations.');
      return;
    }
    setInviteBusy(true);
    try {
      const row = await createOrganizationInvitation({
        organizationId,
        email: inviteEmail.trim(),
        role: inviteRole,
      });
      if (row) {
        setInviteEmail('');
        const link = buildOrganizationInviteUrl(row.token);
        Alert.alert(
          'Invitation created',
          `Share this link securely with the invitee (e.g. by email):\n\n${link}`,
        );
        void loadTeam();
      } else {
        Alert.alert(
          'Error',
          'Could not create invitation. Ensure your member role has permission and RLS allows inserts.',
        );
      }
    } finally {
      setInviteBusy(false);
    }
  };

  if (!realClientId) {
    return (
      <Text style={styles.muted}>
        Sign in with a client account to manage your organization team.
      </Text>
    );
  }

  if (loading) {
    return <Text style={styles.muted}>Loading team…</Text>;
  }

  const pendingInv = invitations.filter((i) => i.status === 'pending');
  const acceptedInv = invitations.filter((i) => i.status === 'accepted');

  const canManageClientSettings = memberRole === 'owner' || memberRole === 'employee';
  // Bookers are external team members and cannot see invitation lists (owner + employee only).
  const invitationListHiddenForMember = !canManageClientSettings && realClientId;

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
      <Text style={styles.lead}>{uiCopy.team.leadClient}</Text>
      <Text style={[styles.lead, { marginTop: spacing.sm }]}>
        {uiCopy.team.ownerRoleExplainerClient}
      </Text>

      <Text style={styles.sectionTitle}>Team members</Text>
      {teamMembers.length === 0 ? (
        <Text style={styles.muted}>No members loaded.</Text>
      ) : (
        teamMembers.map((m) => (
          <View key={m.id} style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>
                {m.display_name || m.email || m.user_id.slice(0, 8)} · {roleLabel(m.role)}
              </Text>
              <Text style={styles.mutedSmall}>{m.email || '—'}</Text>
            </View>
          </View>
        ))
      )}

      <Text style={[styles.sectionTitle, styles.sectionSpacer]}>Pending invitations</Text>
      {invitationListHiddenForMember ? (
        <Text style={styles.muted}>Visible to organization owners and employees only.</Text>
      ) : pendingInv.length === 0 ? (
        <Text style={styles.muted}>None.</Text>
      ) : (
        pendingInv.map((i) => (
          <View key={i.id} style={styles.row}>
            <Text style={styles.rowTitle}>
              {i.email} · {roleLabel(i.role)}
            </Text>
            <Text style={styles.mutedSmall}>Expires {new Date(i.expires_at).toLocaleDateString()}</Text>
          </View>
        ))
      )}

      <Text style={[styles.sectionTitle, styles.sectionSpacer]}>Accepted invitations</Text>
      {invitationListHiddenForMember ? (
        <Text style={styles.muted}>Visible to organization owners and employees only.</Text>
      ) : acceptedInv.length === 0 ? (
        <Text style={styles.muted}>None yet.</Text>
      ) : (
        acceptedInv.map((i) => (
          <View key={i.id} style={styles.row}>
            <Text style={styles.rowTitle}>
              {i.email} · {roleLabel(i.role)}
            </Text>
            <Text style={styles.mutedSmall}>Accepted {new Date(i.created_at).toLocaleDateString()}</Text>
          </View>
        ))
      )}

      {canManageClientSettings && organizationId ? (
        <View style={styles.inviteBox}>
          <Text style={styles.sectionTitle}>Invite member</Text>
          <Text style={styles.label}>Email</Text>
          <TextInput
            value={inviteEmail}
            onChangeText={setInviteEmail}
            placeholder="name@company.com"
            placeholderTextColor={colors.textSecondary}
            style={[inputStyle, { marginBottom: spacing.sm }]}
            autoCapitalize="none"
            keyboardType="email-address"
          />
          <Text style={styles.label}>Role</Text>
          <View style={styles.roleRow}>
            {(['employee'] as const).map((r) => (
              <TouchableOpacity
                key={r}
                style={[styles.rolePill, inviteRole === r && styles.rolePillActive]}
                onPress={() => setInviteRole(r)}
              >
                <Text style={[styles.rolePillText, inviteRole === r && styles.rolePillTextActive]}>Employee</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity
            style={[styles.primaryBtn, (!inviteEmail.trim() || inviteBusy) && styles.primaryBtnDisabled]}
            onPress={() => void handleInvite()}
            disabled={inviteBusy || !inviteEmail.trim()}
          >
            <Text style={styles.primaryBtnLabel}>{inviteBusy ? '…' : 'Send invitation'}</Text>
          </TouchableOpacity>
        </View>
      ) : organizationId ? (
        <Text style={[styles.muted, { marginTop: spacing.md }]}>
          Only organization owners and employees can send invitations. Contact your organization owner if you need access.
        </Text>
      ) : (
        <Text style={[styles.muted, { marginTop: spacing.md }]}>
          Organization could not be loaded. Ensure your profile is a client account.
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
