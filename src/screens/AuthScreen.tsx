import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Platform,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { useAuth } from '../context/AuthContext';
import { uiCopy } from '../constants/uiCopy';
import { TermsScreen } from './TermsScreen';
import { PrivacyScreen } from './PrivacyScreen';
import { navigatePublicLegal } from '../utils/publicLegalRoutes';
import { supabase } from '../../lib/supabase';

type AuthScreenProps = {
  initialMode?: 'login' | 'signup';
  /** When set (e.g. user opened ?shared= before sign-in), explains they may need to reopen the link after auth. */
  sharedSelectionHint?: string | null;
  /** When true (plain login, no ?invite= in URL), stale invite tokens are cleared so sign-in cannot join the wrong org. */
  clearStaleInviteOnSignIn?: boolean;
  /** Einladung: Rolle fix (Agentur-Booker = agent, Client-Mitarbeiter = client). */
  inviteAuth?: {
    orgName: string;
    lockedProfileRole: 'agent' | 'client';
    inviteRoleLabel: string;
    fallbackBanner?: string;
  };
  /** Model-Claim: Locks role to 'model', shows agency name banner. */
  modelClaimAuth?: {
    agencyName: string;
    fallbackBanner?: string;
  };
};

export const AuthScreen: React.FC<AuthScreenProps> = ({
  initialMode = 'login',
  sharedSelectionHint,
  clearStaleInviteOnSignIn = false,
  inviteAuth,
  modelClaimAuth,
}) => {
  const { signIn, signUp, requestPasswordReset } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [role, setRole] = useState<'model' | 'agent' | 'client'>(
    modelClaimAuth ? 'model' : (inviteAuth?.lockedProfileRole ?? 'client'),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  /** Set when signUp succeeds but there is no session (email confirmation required). */
  const [signUpAwaitingEmail, setSignUpAwaitingEmail] = useState(false);
  const [termsVisible, setTermsVisible] = useState(false);
  const [privacyVisible, setPrivacyVisible] = useState(false);

  useEffect(() => {
    if (role === 'model') setCompanyName('');
  }, [role]);

  const handleSubmit = async () => {
    setError(null);

    // Forgot-password mode: only email required
    if (mode === 'forgot') {
      if (!email.trim()) {
        setError(uiCopy.auth.emailPasswordRequired);
        return;
      }
      setBusy(true);
      const { error: e } = await requestPasswordReset(email.trim());
      setBusy(false);
      if (e) {
        setError(e);
      } else {
        setForgotSent(true);
      }
      return;
    }

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
      const r = modelClaimAuth ? 'model' : (inviteAuth?.lockedProfileRole ?? role);
      const isOrgInviteFlow = !!inviteAuth && !modelClaimAuth;
      if (
        !isOrgInviteFlow &&
        !modelClaimAuth &&
        (r === 'client' || r === 'agent') &&
        !companyName.trim()
      ) {
        setError(uiCopy.auth.companyNameRequired);
        setBusy(false);
        return;
      }
      const company =
        !isOrgInviteFlow && !modelClaimAuth && (r === 'client' || r === 'agent')
          ? companyName.trim() || undefined
          : undefined;
      const { error: e } = await signUp(
        email.trim(),
        password,
        r,
        displayName.trim() || undefined,
        company,
        { isInviteSignup: isOrgInviteFlow },
      );
      if (e) {
        setError(e);
        setSignUpAwaitingEmail(false);
      } else {
        const { data: sessWrap } = await supabase.auth.getSession();
        if (!sessWrap.session) {
          setSignUpAwaitingEmail(true);
        } else {
          setSignUpAwaitingEmail(false);
        }
      }
    }
    setBusy(false);
  };

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

      <View style={styles.content}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.subtitle}>
          {inviteAuth || modelClaimAuth
            ? uiCopy.auth.inviteOrClaimContextSubtitle
            : uiCopy.auth.subtitleTagline}
        </Text>

        {sharedSelectionHint ? (
          <Text style={styles.sharedSelectionHint}>{sharedSelectionHint}</Text>
        ) : null}

        {inviteAuth && (
          <Text style={styles.inviteBanner}>
            {inviteAuth.fallbackBanner
              ? inviteAuth.fallbackBanner
              : uiCopy.auth.inviteLine
                  .replace('{org}', inviteAuth.orgName)
                  .replace('{role}', inviteAuth.inviteRoleLabel)}
          </Text>
        )}
        {modelClaimAuth && (
          <Text style={styles.inviteBanner}>
            {modelClaimAuth.fallbackBanner
              ? modelClaimAuth.fallbackBanner
              : uiCopy.auth.modelClaimBannerLine.replace('{agency}', modelClaimAuth.agencyName)}
          </Text>
        )}

        {mode === 'forgot' ? (
          <View style={styles.forgotHeader}>
            <Text style={styles.forgotTitle}>{uiCopy.auth.forgotPasswordTitle}</Text>
            <Text style={styles.forgotHint}>{uiCopy.auth.forgotPasswordHint}</Text>
          </View>
        ) : (
          <View style={styles.modeRow}>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'login' && styles.modeBtnActive]}
              onPress={() => {
                setMode('login');
                setError(null);
                setSignUpAwaitingEmail(false);
              }}
            >
              <Text style={[styles.modeBtnLabel, mode === 'login' && styles.modeBtnLabelActive]}>
                {uiCopy.auth.loginTab}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modeBtn, mode === 'signup' && styles.modeBtnActive]}
              onPress={() => {
                setMode('signup');
                setError(null);
                setSignUpAwaitingEmail(false);
              }}
            >
              <Text style={[styles.modeBtnLabel, mode === 'signup' && styles.modeBtnLabelActive]}>
                {uiCopy.auth.signUpTab}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <TextInput
          style={styles.input}
          placeholder={uiCopy.auth.emailPlaceholder}
          placeholderTextColor={colors.textSecondary}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        {mode !== 'forgot' && (
          <TextInput
            style={styles.input}
            placeholder={uiCopy.auth.passwordPlaceholder}
            placeholderTextColor={colors.textSecondary}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
          />
        )}
        {mode === 'signup' && (
          <Text style={styles.passwordHint}>{uiCopy.auth.passwordHintSignup}</Text>
        )}

        {mode === 'signup' && (
          <>
            <TextInput
              style={styles.input}
              placeholder={uiCopy.auth.signUpDisplayNamePlaceholder}
              placeholderTextColor={colors.textSecondary}
              value={displayName}
              onChangeText={setDisplayName}
            />
            {!inviteAuth && !modelClaimAuth && (
              <>
                <Text style={styles.roleLabel}>{uiCopy.auth.roleLabel}</Text>
                <View style={styles.roleRow}>
                  {(['client', 'agent', 'model'] as const).map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={[styles.rolePill, role === r && styles.rolePillActive]}
                      onPress={() => setRole(r)}
                    >
                      <Text
                        style={[styles.rolePillLabel, role === r && styles.rolePillLabelActive]}
                      >
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
            {!inviteAuth && !modelClaimAuth && (role === 'client' || role === 'agent') ? (
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
            {modelClaimAuth && (
              <Text style={styles.roleLocked}>
                {uiCopy.auth.accountTypeFixed.replace('{role}', 'Model')}
              </Text>
            )}
            {inviteAuth && !modelClaimAuth && (
              <Text style={styles.roleLocked}>
                {uiCopy.auth.inviteRoleLockedLine
                  .replace('{role}', inviteAuth.inviteRoleLabel)
                  .replace(
                    '{accountType}',
                    inviteAuth.lockedProfileRole === 'agent' ? 'Agency' : 'Client',
                  )}
              </Text>
            )}
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        {mode === 'signup' && signUpAwaitingEmail && (
          <View style={styles.signUpEmailInfo}>
            <Text style={styles.signUpEmailInfoText}>
              {uiCopy.auth.signUpEmailConfirmationRequired}
            </Text>
            {inviteAuth && !modelClaimAuth ? (
              <Text style={styles.signUpEmailInfoSub}>
                {uiCopy.auth.signUpEmailConfirmationInviteNote}
              </Text>
            ) : null}
            {modelClaimAuth ? (
              <Text style={styles.signUpEmailInfoSub}>
                {uiCopy.auth.signUpEmailConfirmationModelClaimNote}
              </Text>
            ) : null}
          </View>
        )}

        {mode === 'forgot' && forgotSent ? (
          <Text style={styles.forgotSentMsg}>{uiCopy.auth.forgotPasswordSent}</Text>
        ) : mode === 'signup' && signUpAwaitingEmail ? (
          <TouchableOpacity
            style={styles.submitBtn}
            onPress={() => {
              setMode('login');
              setSignUpAwaitingEmail(false);
              setPassword('');
            }}
          >
            <Text style={styles.submitLabel}>{uiCopy.auth.forgotPasswordBack}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={busy}>
            {busy ? (
              <ActivityIndicator color={colors.surface} />
            ) : (
              <Text style={styles.submitLabel}>
                {mode === 'login'
                  ? uiCopy.auth.loginTab
                  : mode === 'forgot'
                    ? uiCopy.auth.forgotPasswordSend
                    : uiCopy.auth.createAccount}
              </Text>
            )}
          </TouchableOpacity>
        )}

        {mode === 'login' && !inviteAuth && !modelClaimAuth && (
          <TouchableOpacity
            style={styles.forgotLink}
            onPress={() => {
              setMode('forgot');
              setError(null);
              setForgotSent(false);
            }}
          >
            <Text style={styles.forgotLinkLabel}>{uiCopy.auth.forgotPasswordLink}</Text>
          </TouchableOpacity>
        )}

        {mode === 'forgot' && (
          <TouchableOpacity
            style={styles.forgotLink}
            onPress={() => {
              setMode('login');
              setError(null);
              setForgotSent(false);
            }}
          >
            <Text style={styles.forgotLinkLabel}>{uiCopy.auth.forgotPasswordBack}</Text>
          </TouchableOpacity>
        )}

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
  content: { width: '100%', maxWidth: 420, alignItems: 'center' },
  brand: { ...typography.heading, color: colors.textPrimary, marginBottom: spacing.sm },
  subtitle: { ...typography.body, color: colors.textSecondary, marginBottom: spacing.md },
  sharedSelectionHint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
    lineHeight: 18,
  },
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
  passwordHint: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    alignSelf: 'flex-start',
    marginBottom: spacing.sm,
    lineHeight: 16,
  },
  roleLabel: {
    ...typography.label,
    color: colors.textSecondary,
    alignSelf: 'flex-start',
    marginBottom: spacing.xs,
  },
  roleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
    alignSelf: 'flex-start',
  },
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
  error: { ...typography.body, fontSize: 12, color: colors.errorDark, marginBottom: spacing.sm },
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
  forgotHeader: {
    width: '100%',
    alignItems: 'flex-start',
    marginBottom: spacing.lg,
  },
  forgotTitle: {
    ...typography.heading,
    fontSize: 18,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
  },
  forgotHint: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    lineHeight: 18,
  },
  forgotLink: {
    marginTop: spacing.sm,
    alignSelf: 'center',
  },
  forgotLinkLabel: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
  forgotSentMsg: {
    ...typography.body,
    fontSize: 13,
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  signUpEmailInfo: {
    width: '100%',
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
  },
  signUpEmailInfoText: {
    ...typography.body,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 20,
    marginBottom: spacing.sm,
  },
  signUpEmailInfoSub: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 18,
  },
});
