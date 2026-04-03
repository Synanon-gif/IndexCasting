import React, { useEffect, useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator, Modal } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { useAuth } from '../context/AuthContext';
import { uiCopy } from '../constants/uiCopy';
import { TermsScreen } from './TermsScreen';
import { PrivacyScreen } from './PrivacyScreen';

type AuthScreenProps = {
  initialMode?: 'login' | 'signup';
  /** When true (plain login, no ?invite= in URL), stale invite tokens are cleared so sign-in cannot join the wrong org. */
  clearStaleInviteOnSignIn?: boolean;
  /** Einladung: Rolle fix (Agentur-Booker = agent, Client-Mitarbeiter = client). */
  inviteAuth?: {
    orgName: string;
    lockedProfileRole: 'agent' | 'client';
    inviteRoleLabel: string;
  };
};

export const AuthScreen: React.FC<AuthScreenProps> = ({
  initialMode = 'login',
  clearStaleInviteOnSignIn = false,
  inviteAuth,
}) => {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [role, setRole] = useState<'model' | 'agent' | 'client'>(
    inviteAuth?.lockedProfileRole ?? 'client'
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [termsVisible, setTermsVisible] = useState(false);
  const [privacyVisible, setPrivacyVisible] = useState(false);

  useEffect(() => {
    if (role === 'model') setCompanyName('');
  }, [role]);

  const handleSubmit = async () => {
    setError(null);
    if (!email.trim() || !password.trim()) {
      setError(uiCopy.auth.emailPasswordRequired);
      return;
    }
    setBusy(true);
    if (mode === 'login') {
      const { error: e } = await signIn(email.trim(), password, {
        clearStaleInviteToken: clearStaleInviteOnSignIn,
      });
      if (e) setError(e);
    } else {
      const r = inviteAuth?.lockedProfileRole ?? role;
      if (!inviteAuth && (r === 'client' || r === 'agent') && !companyName.trim()) {
        setError(uiCopy.auth.companyNameRequired);
        setBusy(false);
        return;
      }
      const company =
        !inviteAuth && (r === 'client' || r === 'agent') ? companyName.trim() || undefined : undefined;
      const { error: e } = await signUp(
        email.trim(),
        password,
        r,
        displayName.trim() || undefined,
        company,
        { isInviteSignup: !!inviteAuth }
      );
      if (e) setError(e);
    }
    setBusy(false);
  };

  return (
    <View style={styles.container}>
      <Modal visible={termsVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setTermsVisible(false)}>
        <TermsScreen onClose={() => setTermsVisible(false)} />
      </Modal>
      <Modal visible={privacyVisible} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setPrivacyVisible(false)}>
        <PrivacyScreen onClose={() => setPrivacyVisible(false)} />
      </Modal>

      <View style={styles.content}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.subtitle}>B2B platform for fashion casting</Text>

        {inviteAuth && (
          <Text style={styles.inviteBanner}>
            {uiCopy.auth.inviteLine
              .replace('{org}', inviteAuth.orgName)
              .replace('{role}', inviteAuth.inviteRoleLabel)}
          </Text>
        )}

        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'login' && styles.modeBtnActive]}
            onPress={() => setMode('login')}
          >
            <Text style={[styles.modeBtnLabel, mode === 'login' && styles.modeBtnLabelActive]}>
              {uiCopy.auth.loginTab}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'signup' && styles.modeBtnActive]}
            onPress={() => setMode('signup')}
          >
            <Text style={[styles.modeBtnLabel, mode === 'signup' && styles.modeBtnLabelActive]}>
              {uiCopy.auth.signUpTab}
            </Text>
          </TouchableOpacity>
        </View>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.textSecondary}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.textSecondary}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {mode === 'signup' && (
          <>
            <TextInput
              style={styles.input}
              placeholder={uiCopy.auth.signUpDisplayNamePlaceholder}
              placeholderTextColor={colors.textSecondary}
              value={displayName}
              onChangeText={setDisplayName}
            />
            {!inviteAuth && (
              <>
                <Text style={styles.roleLabel}>{uiCopy.auth.roleLabel}</Text>
                <View style={styles.roleRow}>
                  {(['client', 'agent', 'model'] as const).map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={[styles.rolePill, role === r && styles.rolePillActive]}
                      onPress={() => setRole(r)}
                    >
                      <Text style={[styles.rolePillLabel, role === r && styles.rolePillLabelActive]}>
                        {r === 'agent'
                          ? uiCopy.auth.roleAgency
                          : r === 'client'
                            ? uiCopy.auth.roleClient
                            : uiCopy.auth.roleModel}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
            {!inviteAuth && (role === 'client' || role === 'agent') ? (
              <>
                <Text style={styles.ownerHint}>{uiCopy.auth.signUpOwnerHint}</Text>
                <TextInput
                  style={styles.input}
                  placeholder={uiCopy.auth.signUpCompanyNamePlaceholder}
                  placeholderTextColor={colors.textSecondary}
                  value={companyName}
                  onChangeText={setCompanyName}
                  autoCapitalize="words"
                />
              </>
            ) : null}
            {inviteAuth && (
              <Text style={styles.roleLocked}>
                {uiCopy.auth.accountTypeFixed.replace(
                  '{role}',
                  inviteAuth.lockedProfileRole === 'agent' ? 'Agency' : 'Client',
                )}
              </Text>
            )}
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text style={styles.submitLabel}>
              {mode === 'login' ? uiCopy.auth.loginTab : uiCopy.auth.createAccount}
            </Text>
          )}
        </TouchableOpacity>

        <View style={styles.legalFooter}>
          <TouchableOpacity onPress={() => setTermsVisible(true)}>
            <Text style={styles.legalLink}>{uiCopy.legal.tosLabel}</Text>
          </TouchableOpacity>
          <Text style={styles.legalSep}>·</Text>
          <TouchableOpacity onPress={() => setPrivacyVisible(true)}>
            <Text style={styles.legalLink}>{uiCopy.legal.privacyLabel}</Text>
          </TouchableOpacity>
        </View>

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
    paddingHorizontal: spacing.lg,
  },
  content: { width: '100%', maxWidth: 380, alignItems: 'center' },
  brand: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  inviteBanner: {
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.lg,
    padding: spacing.sm,
    borderRadius: 8,
    backgroundColor: colors.background,
    width: '100%',
  },
  roleLocked: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
  },
  modeRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  modeBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modeBtnActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  modeBtnLabel: { ...typography.label, fontSize: 12, color: colors.textSecondary },
  modeBtnLabelActive: { color: colors.surface },
  input: {
    width: '100%',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    marginBottom: spacing.sm,
    ...typography.body,
    color: colors.textPrimary,
  },
  roleLabel: { ...typography.label, color: colors.textSecondary, alignSelf: 'flex-start', marginBottom: spacing.xs },
  roleRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md, alignSelf: 'flex-start' },
  rolePill: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rolePillActive: { backgroundColor: colors.textPrimary, borderColor: colors.textPrimary },
  rolePillLabel: { ...typography.label, fontSize: 11, color: colors.textSecondary },
  rolePillLabelActive: { color: colors.surface },
  ownerHint: {
    ...typography.body,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
    alignSelf: 'stretch',
    marginBottom: spacing.sm,
  },
  error: { ...typography.body, fontSize: 12, color: '#C0392B', marginBottom: spacing.sm },
  submitBtn: {
    width: '100%',
    paddingVertical: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  submitLabel: { ...typography.label, color: colors.surface },
  legalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
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
