import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { useAuth } from '../context/AuthContext';
import { isAgency as checkIsAgency } from '../types/roles';
import { uiCopy } from '../constants/uiCopy';
import { TermsScreen } from './TermsScreen';
import { PrivacyScreen } from './PrivacyScreen';

export const LegalAcceptanceScreen: React.FC = () => {
  const { profile, acceptTerms, signOut } = useAuth();
  const [tosChecked, setTosChecked] = useState(false);
  const [privacyChecked, setPrivacyChecked] = useState(false);
  const [agencyRightsChecked, setAgencyRightsChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [termsVisible, setTermsVisible] = useState(false);
  const [privacyVisible, setPrivacyVisible] = useState(false);

  const isAgency = checkIsAgency(profile);
  const canSubmit = tosChecked && privacyChecked && (!isAgency || agencyRightsChecked);

  const openTos = () => setTermsVisible(true);
  const openPrivacy = () => setPrivacyVisible(true);

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
      {/* In-app Terms of Service modal */}
      <Modal
        visible={termsVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setTermsVisible(false)}
      >
        <TermsScreen onClose={() => setTermsVisible(false)} />
      </Modal>

      {/* In-app Privacy Policy modal */}
      <Modal
        visible={privacyVisible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={() => setPrivacyVisible(false)}
      >
        <PrivacyScreen onClose={() => setPrivacyVisible(false)} />
      </Modal>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.title}>{uiCopy.legal.title}</Text>
        <Text style={styles.subtitle}>{uiCopy.legal.subtitle}</Text>

        <TouchableOpacity style={styles.checkRow} onPress={() => setTosChecked(!tosChecked)}>
          <View style={[styles.checkbox, tosChecked && styles.checkboxChecked]}>
            {tosChecked && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.checkLabel}>
            {uiCopy.legal.tosCheckLabel}{' '}
            <Text style={styles.link} onPress={openTos}>
              {uiCopy.legal.tosLabel}
            </Text>
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.checkRow}
          onPress={() => setPrivacyChecked(!privacyChecked)}
        >
          <View style={[styles.checkbox, privacyChecked && styles.checkboxChecked]}>
            {privacyChecked && <Text style={styles.checkmark}>✓</Text>}
          </View>
          <Text style={styles.checkLabel}>
            {uiCopy.legal.privacyCheckLabel}{' '}
            <Text style={styles.link} onPress={openPrivacy}>
              {uiCopy.legal.privacyLabel}
            </Text>{' '}
            {uiCopy.legal.privacySuffix}
          </Text>
        </TouchableOpacity>

        {isAgency && (
          <TouchableOpacity
            style={styles.checkRow}
            onPress={() => setAgencyRightsChecked(!agencyRightsChecked)}
          >
            <View style={[styles.checkbox, agencyRightsChecked && styles.checkboxChecked]}>
              {agencyRightsChecked && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkLabel}>{uiCopy.legal.agencyRightsLabel}</Text>
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
            <Text style={styles.acceptLabel}>{uiCopy.legal.acceptButton}</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.logoutBtn} onPress={signOut}>
          <Text style={styles.logoutLabel}>{uiCopy.legal.logoutButton}</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: { width: '100%', maxWidth: 440, padding: spacing.md, alignItems: 'center' },
  brand: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.sm },
  title: {
    ...typography.heading,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.xl,
  },
  checkRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: spacing.md,
    width: '100%',
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxChecked: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  checkmark: { color: colors.surface, fontSize: 14, fontWeight: '700' },
  checkLabel: { ...typography.body, flex: 1, color: colors.textPrimary },
  link: { textDecorationLine: 'underline', color: colors.textPrimary },
  error: { ...typography.body, fontSize: 12, color: colors.errorDark, marginBottom: spacing.sm },
  acceptBtn: {
    width: '100%',
    paddingVertical: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    marginTop: spacing.lg,
  },
  acceptBtnDisabled: { opacity: 0.4 },
  acceptLabel: { ...typography.label, color: colors.surface },
  logoutBtn: { marginTop: spacing.md, paddingVertical: spacing.sm },
  logoutLabel: { ...typography.label, color: colors.textSecondary },
});
