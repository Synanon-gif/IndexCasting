import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import type { InvitationPreview } from '../services/organizationsInvitationsSupabase';
import { uiCopy } from '../constants/uiCopy';

type Props = {
  preview: InvitationPreview | null;
  loading: boolean;
  error: string | null;
  onContinueLogin: () => void;
  onContinueSignup: () => void;
};

export function InviteAcceptanceScreen({
  preview,
  loading,
  error,
  onContinueLogin,
  onContinueSignup,
}: Props) {
  const [copied, setCopied] = useState(false);

  const roleLabel =
    preview?.invite_role === 'booker'
      ? uiCopy.invite.roleBookerAgency
      : preview?.invite_role === 'employee'
        ? uiCopy.invite.roleEmployeeClient
        : uiCopy.invite.roleMember;

  const copyHint = async () => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.title}>{uiCopy.invite.pageTitle}</Text>

        {loading && <ActivityIndicator size="large" color={colors.textPrimary} style={{ marginVertical: spacing.lg }} />}

        {error && <Text style={styles.error}>{error}</Text>}

        {!loading && preview && (
          <>
            <Text style={styles.body}>
              {uiCopy.invite.invitedToWorkAt}{' '}
              <Text style={styles.emph}>{preview.org_name}</Text>.
            </Text>
            <Text style={styles.meta}>
              Role: {roleLabel}
              {'\n'}
              {uiCopy.invite.validUntil}: {new Date(preview.expires_at).toLocaleString()}
            </Text>
            <Text style={styles.hint}>{uiCopy.invite.sameEmailInstructions}</Text>
          </>
        )}

        {!loading && !preview && !error && (
          <Text style={styles.body}>{uiCopy.invite.invalidLink}</Text>
        )}

        {preview && !loading && (
          <View style={styles.btnCol}>
            <TouchableOpacity style={styles.primaryBtn} onPress={onContinueSignup}>
              <Text style={styles.primaryLabel}>{uiCopy.invite.signUpToAccept}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onContinueLogin}>
              <Text style={styles.secondaryLabel}>{uiCopy.invite.alreadyHaveAccount}</Text>
            </TouchableOpacity>
            {Platform.OS === 'web' && (
              <TouchableOpacity onPress={copyHint} style={styles.linkBtn}>
                <Text style={styles.linkLabel}>{copied ? uiCopy.invite.linkCopied : uiCopy.invite.copyLink}</Text>
              </TouchableOpacity>
            )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  card: {
    maxWidth: 420,
    alignSelf: 'center',
    width: '100%',
    padding: spacing.lg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  brand: { ...typography.heading, fontSize: 14, color: colors.textSecondary, marginBottom: spacing.sm },
  title: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.md },
  body: { ...typography.body, color: colors.textPrimary, marginBottom: spacing.md, lineHeight: 22 },
  emph: { fontWeight: '700' },
  meta: { ...typography.label, fontSize: 12, color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 18 },
  hint: { ...typography.body, fontSize: 12, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 18 },
  error: { ...typography.body, fontSize: 12, color: '#C0392B', marginBottom: spacing.md },
  btnCol: { gap: spacing.sm },
  primaryBtn: {
    backgroundColor: colors.textPrimary,
    paddingVertical: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  primaryLabel: { ...typography.label, color: colors.surface },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    borderRadius: 8,
    alignItems: 'center',
  },
  secondaryLabel: { ...typography.label, color: colors.textPrimary },
  linkBtn: { paddingVertical: spacing.sm, alignItems: 'center' },
  linkLabel: { ...typography.label, fontSize: 11, color: colors.textSecondary },
});
