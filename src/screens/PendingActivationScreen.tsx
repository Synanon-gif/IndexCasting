import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, ActivityIndicator } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { useAuth } from '../context/AuthContext';
import { isAgency } from '../types/roles';
import { uiCopy } from '../constants/uiCopy';

const ADMIN_EMAIL = 'admin@castingindex.com';

export const PendingActivationScreen: React.FC = () => {
  const { profile, signOut, markDocumentsSent, refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);

  const documentsSent = profile?.activation_documents_sent ?? false;

  const handleSendDocuments = async () => {
    const displayName =
      profile?.display_name || profile?.email || uiCopy.pendingActivation.fallbackUser;
    const subject = encodeURIComponent(uiCopy.pendingActivation.emailSubject(displayName));
    const body = encodeURIComponent(
      uiCopy.pendingActivation.emailBody({
        orgKind: isAgency(profile) ? 'Agency' : 'Client',
        email: profile?.email ?? '',
        displayName: profile?.display_name ?? '',
        company: profile?.company_name || uiCopy.pendingActivation.fallbackCompany,
      }),
    );
    const url = `mailto:${ADMIN_EMAIL}?subject=${subject}&body=${body}`;
    await Linking.openURL(url);
    setBusy(true);
    await markDocumentsSent();
    setBusy(false);
  };

  const handleRefresh = async () => {
    setBusy(true);
    await refreshProfile();
    setBusy(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.brand}>{uiCopy.pendingActivation.brand}</Text>
        <Text style={styles.icon}>🔒</Text>
        <Text style={styles.title}>{uiCopy.pendingActivation.title}</Text>

        {!documentsSent ? (
          <>
            <Text style={styles.body}>{uiCopy.pendingActivation.bodyPending}</Text>

            {isAgency(profile) && (
              <Text style={styles.hint}>{uiCopy.pendingActivation.agencyHint}</Text>
            )}

            <TouchableOpacity style={styles.primaryBtn} onPress={handleSendDocuments}>
              <Text style={styles.primaryBtnLabel}>
                {uiCopy.pendingActivation.sendDocumentsBtn}
              </Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.body}>{uiCopy.pendingActivation.bodySent}</Text>

            <TouchableOpacity style={styles.primaryBtn} onPress={handleRefresh} disabled={busy}>
              {busy ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text style={styles.primaryBtnLabel}>
                  {uiCopy.pendingActivation.checkStatusBtn}
                </Text>
              )}
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={styles.logoutBtn} onPress={signOut}>
          <Text style={styles.logoutLabel}>{uiCopy.pendingActivation.logoutBtn}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
  },
  content: { width: '100%', maxWidth: 440, alignItems: 'center' },
  brand: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.lg },
  icon: { fontSize: 48, marginBottom: spacing.md },
  title: {
    ...typography.heading,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: spacing.md,
    textAlign: 'center',
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
    lineHeight: 22,
  },
  hint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
    fontStyle: 'italic',
  },
  primaryBtn: {
    width: '100%',
    paddingVertical: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  primaryBtnLabel: { ...typography.label, color: colors.surface },
  logoutBtn: { marginTop: spacing.lg, paddingVertical: spacing.sm },
  logoutLabel: { ...typography.label, color: colors.textSecondary },
});
