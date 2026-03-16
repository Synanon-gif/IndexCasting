import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Linking, ActivityIndicator } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { useAuth } from '../context/AuthContext';

const ADMIN_EMAIL = 'admin@castingindex.com';

export const PendingActivationScreen: React.FC = () => {
  const { profile, signOut, markDocumentsSent, refreshProfile } = useAuth();
  const [busy, setBusy] = useState(false);

  const documentsSent = profile?.activation_documents_sent ?? false;

  const handleSendDocuments = async () => {
    const subject = encodeURIComponent(`Account Verification – ${profile?.display_name || profile?.email || 'User'}`);
    const body = encodeURIComponent(
      `Hello Casting Index Team,\n\n` +
      `I would like to activate my ${profile?.role === 'agent' ? 'Agency' : 'Client'} account.\n\n` +
      `Account Email: ${profile?.email}\n` +
      `Display Name: ${profile?.display_name}\n` +
      `Company: ${profile?.company_name || 'N/A'}\n\n` +
      `I have attached the required verification documents.\n\n` +
      `Best regards`
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
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.icon}>🔒</Text>
        <Text style={styles.title}>Account Pending Activation</Text>

        {!documentsSent ? (
          <>
            <Text style={styles.body}>
              Your account needs to be verified before you can access the platform.
              Please send your verification documents to the app operator.
            </Text>

            {profile?.role === 'agent' && (
              <Text style={styles.hint}>
                Agency accounts must register with the email address listed on your company website.
              </Text>
            )}

            <TouchableOpacity style={styles.primaryBtn} onPress={handleSendDocuments}>
              <Text style={styles.primaryBtnLabel}>Send Verification Documents via Email</Text>
            </TouchableOpacity>
          </>
        ) : (
          <>
            <Text style={styles.body}>
              Thank you! Your documents have been submitted. The app operator will review
              and activate your account shortly. You will receive an email confirmation.
            </Text>

            <TouchableOpacity style={styles.primaryBtn} onPress={handleRefresh} disabled={busy}>
              {busy ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text style={styles.primaryBtnLabel}>Check Activation Status</Text>
              )}
            </TouchableOpacity>
          </>
        )}

        <TouchableOpacity style={styles.logoutBtn} onPress={signOut}>
          <Text style={styles.logoutLabel}>Logout</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center', paddingHorizontal: spacing.lg },
  content: { width: '100%', maxWidth: 440, alignItems: 'center' },
  brand: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.lg },
  icon: { fontSize: 48, marginBottom: spacing.md },
  title: { ...typography.heading, fontSize: 20, color: colors.textPrimary, marginBottom: spacing.md, textAlign: 'center' },
  body: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md, lineHeight: 22 },
  hint: { ...typography.body, fontSize: 12, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.md, fontStyle: 'italic' },
  primaryBtn: {
    width: '100%', paddingVertical: spacing.md, borderRadius: 8,
    backgroundColor: colors.textPrimary, alignItems: 'center', marginTop: spacing.sm,
  },
  primaryBtnLabel: { ...typography.label, color: colors.surface },
  logoutBtn: { marginTop: spacing.lg, paddingVertical: spacing.sm },
  logoutLabel: { ...typography.label, color: colors.textSecondary },
});
