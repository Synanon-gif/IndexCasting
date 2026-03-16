import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { useAuth } from '../context/AuthContext';

export const LegalAcceptanceScreen: React.FC = () => {
  const { profile, acceptTerms, signOut } = useAuth();
  const [tosChecked, setTosChecked] = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [agencyRightsChecked, setAgencyRightsChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAgency = profile?.role === 'agent';
  const canSubmit = tosChecked && privacyChecked && (!isAgency || agencyRightsChecked);

  const handleAccept = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const { error: e } = await acceptTerms(isAgency ? agencyRightsChecked : false);
    if (e) setError(e);
    setBusy(false);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.title}>Terms & Conditions</Text>
        <Text style={styles.subtitle}>
          Please accept the following to continue using the platform.
        </Text>

        <TouchableOpacity style={styles.checkRow} onPress={() => setTosChecked(!tosChecked)}>
          <View style={[styles.checkbox, tosChecked && styles.checkboxChecked]}>
            {tosChecked && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.checkLabel}>
            I accept the <Text style={styles.link}>Terms of Service</Text>
          </Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.checkRow} onPress={() => setPrivacyChecked(!privacyChecked)}>
          <View style={[styles.checkbox, privacyChecked && styles.checkboxChecked]}>
            {privacyChecked && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.checkLabel}>
            I accept the <Text style={styles.link}>Privacy Policy</Text> (GDPR compliant)
          </Text>
        </TouchableOpacity>

        {isAgency && (
          <TouchableOpacity style={styles.checkRow} onPress={() => setAgencyRightsChecked(!agencyRightsChecked)}>
            <View style={[styles.checkbox, agencyRightsChecked && styles.checkboxChecked]}>
              {agencyRightsChecked && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkLabel}>
              I confirm that I hold all necessary rights to use and share the personal data of the models I represent.
            </Text>
          </TouchableOpacity>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity
          style={[styles.acceptBtn, !canSubmit && styles.acceptBtnDisabled]}
          onPress={handleAccept}
          disabled={!canSubmit || busy}
        >
          {busy ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text style={styles.acceptLabel}>Accept & Continue</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutBtn} onPress={signOut}>
          <Text style={styles.logoutLabel}>Logout</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background, justifyContent: 'center', alignItems: 'center' },
  content: { width: '100%', maxWidth: 440, padding: spacing.lg, alignItems: 'center' },
  brand: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.sm },
  title: { ...typography.heading, fontSize: 20, color: colors.textPrimary, marginBottom: spacing.xs },
  subtitle: { ...typography.body, color: colors.textSecondary, textAlign: 'center', marginBottom: spacing.xl },
  checkRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.md, width: '100%' },
  checkbox: {
    width: 22, height: 22, borderRadius: 4, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center', marginTop: 1,
  },
  checkboxChecked: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  checkmark: { color: colors.surface, fontSize: 14, fontWeight: '700' },
  checkLabel: { ...typography.body, flex: 1, color: colors.textPrimary },
  link: { textDecorationLine: 'underline', color: colors.textPrimary },
  error: { ...typography.body, fontSize: 12, color: '#C0392B', marginBottom: spacing.sm },
  acceptBtn: {
    width: '100%', paddingVertical: spacing.md, borderRadius: 8,
    backgroundColor: colors.textPrimary, alignItems: 'center', marginTop: spacing.lg,
  },
  acceptBtnDisabled: { opacity: 0.4 },
  acceptLabel: { ...typography.label, color: colors.surface },
  logoutBtn: { marginTop: spacing.md, paddingVertical: spacing.sm },
  logoutLabel: { ...typography.label, color: colors.textSecondary },
});
