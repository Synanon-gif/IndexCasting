import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { useAuth } from '../context/AuthContext';
import { uiCopy } from '../constants/uiCopy';

/**
 * SetPasswordScreen — shown when the user arrives via a PASSWORD_RECOVERY link.
 * App.tsx gates to this screen when isPasswordRecovery === true.
 *
 * Security: updatePassword() calls supabase.auth.updateUser({ password }) which only
 * updates the currently authenticated user's own password. There is no way to change
 * another user's password through this screen. After success the user is signed out
 * and must log in again with the new password (clean session handoff).
 */
export const SetPasswordScreen: React.FC = () => {
  const { updatePassword, signOut } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSave = async () => {
    setError(null);

    if (!newPassword.trim() || !confirmPassword.trim()) {
      setError(uiCopy.auth.emailPasswordRequired);
      return;
    }

    if (newPassword.length < 10) {
      setError(uiCopy.auth.passwordHintSignup);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(uiCopy.auth.setPasswordMismatch);
      return;
    }

    setBusy(true);
    const { error: e } = await updatePassword(newPassword);
    setBusy(false);

    if (e) {
      setError(e);
    } else {
      // updatePassword() signs the user out — App.tsx will navigate to AuthScreen.
      // Show success briefly so the user understands what happened.
      setSuccess(true);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.brand}>INDEX CASTING</Text>

        <Text style={styles.title}>{uiCopy.auth.setPasswordTitle}</Text>
        <Text style={styles.hint}>{uiCopy.auth.setPasswordHint}</Text>
        <Text style={styles.passwordReqHint}>{uiCopy.auth.passwordHintSignup}</Text>

        {success ? (
          <Text style={styles.successMsg}>{uiCopy.auth.setPasswordSuccess}</Text>
        ) : (
          <>
            <TextInput
              style={styles.input}
              placeholder={uiCopy.auth.setPasswordNew}
              placeholderTextColor={colors.textSecondary}
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoCapitalize="none"
            />
            <TextInput
              style={styles.input}
              placeholder={uiCopy.auth.setPasswordConfirm}
              placeholderTextColor={colors.textSecondary}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoCapitalize="none"
            />

            {error && <Text style={styles.error}>{error}</Text>}

            <TouchableOpacity style={styles.submitBtn} onPress={handleSave} disabled={busy}>
              {busy ? (
                <ActivityIndicator color={colors.surface} />
              ) : (
                <Text style={styles.submitLabel}>{uiCopy.auth.setPasswordSave}</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity style={styles.cancelBtn} onPress={() => void signOut()}>
              <Text style={styles.cancelLabel}>{uiCopy.common.cancel}</Text>
            </TouchableOpacity>
          </>
        )}
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
  content: {
    width: '100%',
    maxWidth: 380,
    alignItems: 'center',
  },
  brand: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.lg,
  },
  title: {
    ...typography.heading,
    fontSize: 20,
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textAlign: 'center',
  },
  hint: {
    ...typography.body,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  passwordReqHint: {
    ...typography.body,
    fontSize: 11,
    color: colors.textSecondary,
    alignSelf: 'flex-start',
    marginBottom: spacing.md,
    lineHeight: 16,
  },
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
  error: {
    ...typography.body,
    fontSize: 12,
    color: colors.errorDark,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  submitBtn: {
    width: '100%',
    paddingVertical: spacing.md,
    borderRadius: 8,
    backgroundColor: colors.textPrimary,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  submitLabel: {
    ...typography.label,
    color: colors.surface,
  },
  successMsg: {
    ...typography.body,
    fontSize: 14,
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: spacing.md,
  },
  cancelBtn: {
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  cancelLabel: {
    ...typography.body,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
});
