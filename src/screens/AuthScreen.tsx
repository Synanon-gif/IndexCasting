import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { useAuth } from '../context/AuthContext';

type AuthScreenProps = {
  initialMode?: 'login' | 'signup';
  onDemoLogin: (role: 'model' | 'agency' | 'client' | 'apply') => void;
  /** Einladung: Rolle fix (Agentur-Booker = agent, Client-Mitarbeiter = client). */
  inviteAuth?: {
    orgName: string;
    lockedProfileRole: 'agent' | 'client';
    inviteRoleLabel: string;
  };
};

export const AuthScreen: React.FC<AuthScreenProps> = ({
  initialMode = 'login',
  onDemoLogin,
  inviteAuth,
}) => {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState<'model' | 'agent' | 'client'>(
    inviteAuth?.lockedProfileRole ?? 'client'
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async () => {
    setError(null);
    if (!email.trim() || !password.trim()) {
      setError('Email and password required');
      return;
    }
    setBusy(true);
    if (mode === 'login') {
      const { error: e } = await signIn(email.trim(), password);
      if (e) setError(e);
    } else {
      const r = inviteAuth?.lockedProfileRole ?? role;
      const { error: e } = await signUp(email.trim(), password, r, displayName.trim() || undefined);
      if (e) setError(e);
    }
    setBusy(false);
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.subtitle}>B2B platform for fashion casting</Text>

        {inviteAuth && (
          <Text style={styles.inviteBanner}>
            Einladung: {inviteAuth.orgName} · {inviteAuth.inviteRoleLabel}
          </Text>
        )}

        <View style={styles.modeRow}>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'login' && styles.modeBtnActive]}
            onPress={() => setMode('login')}
          >
            <Text style={[styles.modeBtnLabel, mode === 'login' && styles.modeBtnLabelActive]}>Login</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.modeBtn, mode === 'signup' && styles.modeBtnActive]}
            onPress={() => setMode('signup')}
          >
            <Text style={[styles.modeBtnLabel, mode === 'signup' && styles.modeBtnLabelActive]}>Sign Up</Text>
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
              placeholder="Display Name"
              placeholderTextColor={colors.textSecondary}
              value={displayName}
              onChangeText={setDisplayName}
            />
            {!inviteAuth && (
              <>
                <Text style={styles.roleLabel}>Role</Text>
                <View style={styles.roleRow}>
                  {(['client', 'agent', 'model'] as const).map((r) => (
                    <TouchableOpacity
                      key={r}
                      style={[styles.rolePill, role === r && styles.rolePillActive]}
                      onPress={() => setRole(r)}
                    >
                      <Text style={[styles.rolePillLabel, role === r && styles.rolePillLabelActive]}>
                        {r === 'agent' ? 'Agency' : r.charAt(0).toUpperCase() + r.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </>
            )}
            {inviteAuth && (
              <Text style={styles.roleLocked}>
                Konto-Typ: {inviteAuth.lockedProfileRole === 'agent' ? 'Agency' : 'Client'} (vorgegeben durch die Einladung)
              </Text>
            )}
          </>
        )}

        {error && <Text style={styles.error}>{error}</Text>}

        <TouchableOpacity style={styles.submitBtn} onPress={handleSubmit} disabled={busy}>
          {busy ? (
            <ActivityIndicator color={colors.surface} />
          ) : (
            <Text style={styles.submitLabel}>{mode === 'login' ? 'Login' : 'Create Account'}</Text>
          )}
        </TouchableOpacity>

        <View style={styles.divider}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or try demo</Text>
          <View style={styles.dividerLine} />
        </View>

        <View style={styles.demoRow}>
          {(['client', 'agency', 'model'] as const).map((d) => (
            <TouchableOpacity key={d} style={styles.demoBtn} onPress={() => onDemoLogin(d)}>
              <Text style={styles.demoLabel}>
                {d.charAt(0).toUpperCase() + d.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
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
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginVertical: spacing.lg,
  },
  dividerLine: { flex: 1, height: 1, backgroundColor: colors.border },
  dividerText: { ...typography.label, fontSize: 10, color: colors.textSecondary, marginHorizontal: spacing.sm },
  demoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, justifyContent: 'center' },
  demoBtn: {
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
  },
  demoLabel: { ...typography.label, fontSize: 11, color: colors.textSecondary },
});
