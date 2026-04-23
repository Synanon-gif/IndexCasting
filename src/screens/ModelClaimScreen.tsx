import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Platform,
  Modal,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { TermsScreen } from './TermsScreen';
import { PrivacyScreen } from './PrivacyScreen';
import { navigatePublicLegal, openAuthAreaPublicPage } from '../utils/publicLegalRoutes';

export interface ModelClaimPreview {
  valid: boolean;
  model_name?: string;
  agency_name?: string;
  error?: string;
}

type Props = {
  preview: ModelClaimPreview | null;
  loading: boolean;
  error: string | null;
  onContinueSignup: () => void;
  onContinueLogin: () => void;
  onDismiss?: () => void;
};

export function ModelClaimScreen({
  preview,
  loading,
  error,
  onContinueSignup,
  onContinueLogin,
  onDismiss,
}: Props) {
  const [copied, setCopied] = useState(false);
  const [termsVisible, setTermsVisible] = useState(false);
  const [privacyVisible, setPrivacyVisible] = useState(false);

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

  const isValid = preview?.valid === true;

  return (
    <View style={styles.container}>
      <Modal
        visible={termsVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setTermsVisible(false)}
      >
        <TermsScreen onClose={() => setTermsVisible(false)} />
      </Modal>
      <Modal
        visible={privacyVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPrivacyVisible(false)}
      >
        <PrivacyScreen onClose={() => setPrivacyVisible(false)} />
      </Modal>

      <View style={styles.card}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.title}>{uiCopy.modelClaim.pageTitle}</Text>

        {loading && (
          <ActivityIndicator
            size="large"
            color={colors.textPrimary}
            style={{ marginVertical: spacing.lg }}
          />
        )}

        {error && (
          <Text style={styles.error}>
            {error}
            {'\n'}
            {uiCopy.modelClaim.previewFailedSignInHint}
          </Text>
        )}

        {!loading && isValid && preview && (
          <>
            <Text style={styles.distinct}>{uiCopy.modelClaim.notOrgTeamInvite}</Text>
            <Text style={styles.body}>
              <Text style={styles.emph}>{preview.agency_name}</Text>{' '}
              {uiCopy.modelClaim.profileCreatedBy}
            </Text>
            {preview.model_name && <Text style={styles.modelName}>{preview.model_name}</Text>}
            <Text style={styles.hint}>{uiCopy.modelClaim.createAccountHint}</Text>
            <Text style={styles.expires}>{uiCopy.modelClaim.expiresNote}</Text>
            <Text style={styles.nextSteps}>{uiCopy.modelClaim.modelClaimNextStepsAfterSignup}</Text>
          </>
        )}

        {!loading && !isValid && !error && (
          <Text style={styles.body}>{uiCopy.modelClaim.invalidLink}</Text>
        )}

        {!loading && (isValid || error) && (
          <View style={styles.btnCol}>
            {isValid && (
              <TouchableOpacity style={styles.primaryBtn} onPress={onContinueSignup}>
                <Text style={styles.primaryLabel}>{uiCopy.modelClaim.createAccount}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={error && !isValid ? styles.primaryBtn : styles.secondaryBtn}
              onPress={onContinueLogin}
            >
              <Text style={error && !isValid ? styles.primaryLabel : styles.secondaryLabel}>
                {uiCopy.modelClaim.alreadyHaveAccount}
              </Text>
            </TouchableOpacity>
            {!isValid && (
              <TouchableOpacity style={styles.secondaryBtn} onPress={onContinueSignup}>
                <Text style={styles.secondaryLabel}>{uiCopy.modelClaim.createAccount}</Text>
              </TouchableOpacity>
            )}
            {Platform.OS === 'web' && (
              <TouchableOpacity onPress={copyHint} style={styles.linkBtn}>
                <Text style={styles.linkLabel}>
                  {copied ? uiCopy.modelClaim.linkCopied : uiCopy.modelClaim.copyLink}
                </Text>
              </TouchableOpacity>
            )}
            {onDismiss && (
              <TouchableOpacity onPress={onDismiss} style={styles.linkBtn}>
                <Text style={styles.linkLabel}>{uiCopy.common.cancel}</Text>
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
        <Text style={styles.legalSep}>·</Text>
        <TouchableOpacity
          onPress={() =>
            openAuthAreaPublicPage({ webPath: '/trust', publicUrl: uiCopy.legal.trustUrl })
          }
        >
          <Text style={styles.legalLink}>{uiCopy.legal.trustLabel}</Text>
        </TouchableOpacity>
        <Text style={styles.legalSep}>·</Text>
        <TouchableOpacity
          onPress={() =>
            openAuthAreaPublicPage({ webPath: '/status', publicUrl: uiCopy.legal.statusUrl })
          }
        >
          <Text style={styles.legalLink}>{uiCopy.legal.statusLabel}</Text>
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
    paddingHorizontal: spacing.md,
  },
  card: {
    maxWidth: 420,
    alignSelf: 'center',
    width: '100%',
    padding: spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  brand: {
    ...typography.heading,
    fontSize: 14,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  title: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.md },
  distinct: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.md,
    lineHeight: 18,
  },
  body: { ...typography.body, color: colors.textPrimary, marginBottom: spacing.sm, lineHeight: 22 },
  emph: { fontWeight: '700' },
  modelName: {
    ...typography.heading,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  hint: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
    lineHeight: 20,
  },
  expires: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: spacing.sm,
  },
  nextSteps: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: spacing.lg,
    lineHeight: 18,
  },
  error: { ...typography.body, fontSize: 12, color: colors.errorDark, marginBottom: spacing.md },
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
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
    alignContent: 'center',
    rowGap: spacing.xs,
    columnGap: spacing.xs,
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
