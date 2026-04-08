import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Platform, Modal } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import type { InvitationPreview } from '../services/organizationsInvitationsSupabase';
import { uiCopy } from '../constants/uiCopy';
import { TermsScreen } from './TermsScreen';
import { PrivacyScreen } from './PrivacyScreen';
import { navigatePublicLegal } from '../utils/publicLegalRoutes';

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
  const [termsVisible, setTermsVisible] = useState(false);
  const [privacyVisible, setPrivacyVisible] = useState(false);

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
      <Modal visible={termsVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setTermsVisible(false)}>
        <TermsScreen onClose={() => setTermsVisible(false)} />
      </Modal>
      <Modal visible={privacyVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPrivacyVisible(false)}>
        <PrivacyScreen onClose={() => setPrivacyVisible(false)} />
      </Modal>
      <View style={styles.card}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.title}>{uiCopy.invite.pageTitle}</Text>

        {loading && <ActivityIndicator size="large" color={colors.textPrimary} style={{ marginVertical: spacing.lg }} />}

        {error && <Text style={styles.error}>{error}</Text>}

        {!loading && preview && (
          <>
            <Text style={styles.body}>
              {uiCopy.invite.invitedJoinAs
                .replace('{org}', preview.org_name)
                .replace('{role}', roleLabel)}
            </Text>
            <Text style={styles.notSelfService}>{uiCopy.invite.inviteNotSelfServiceHint}</Text>
            <Text style={styles.meta}>
              {uiCopy.invite.validUntil}: {new Date(preview.expires_at).toLocaleString()}
            </Text>
            {preview.invited_email_hint ? (
              <Text style={styles.emailHint}>
                {uiCopy.invite.emailHintPrefix}{' '}
                <Text style={styles.emailHintValue}>{preview.invited_email_hint}</Text>
              </Text>
            ) : null}
            <Text style={styles.hint}>{uiCopy.invite.sameEmailInstructions}</Text>
            <Text style={styles.nextSteps}>{uiCopy.invite.inviteNextStepsAfterSignup}</Text>
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

      <View style={styles.legalFooter}>
        <TouchableOpacity
          onPress={() =>
            Platform.OS === 'web' ? navigatePublicLegal('/terms') : setTermsVisible(true)
          }
        >
          <Text style={styles.legalLink}>{uiCopy.legal.tosLabel}</Text>
        </TouchableOpacity>
        <Text style={styles.legalSep}>·</Text>
        <TouchableOpacity
          onPress={() =>
            Platform.OS === 'web' ? navigatePublicLegal('/privacy') : setPrivacyVisible(true)
          }
        >
          <Text style={styles.legalLink}>{uiCopy.legal.privacyLabel}</Text>
        </TouchableOpacity>
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
  body: { ...typography.body, color: colors.textPrimary, marginBottom: spacing.sm, lineHeight: 22 },
  notSelfService: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  emph: { fontWeight: '700' },
  meta: { ...typography.label, fontSize: 12, color: colors.textSecondary, marginBottom: spacing.md, lineHeight: 18 },
  emailHint: { ...typography.body, fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm, lineHeight: 18 },
  emailHintValue: { fontWeight: '700', color: colors.textPrimary },
  hint: { ...typography.body, fontSize: 12, color: colors.textSecondary, marginBottom: spacing.sm, lineHeight: 18 },
  nextSteps: { ...typography.body, fontSize: 12, color: colors.textSecondary, marginBottom: spacing.lg, lineHeight: 18 },
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
  legalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  legalLink: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
  legalSep: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
  },
});
