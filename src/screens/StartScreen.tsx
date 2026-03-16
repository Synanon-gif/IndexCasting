import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';

// Apply as Model: nur nach Login/Sign-up als Model unter „My Applications“ möglich

export type Role = 'model' | 'agency' | 'client' | 'apply';

type StartScreenProps = {
  onLogin: (role: Role) => void;
};

export const StartScreen: React.FC<StartScreenProps> = ({ onLogin }) => {
  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.subtitle}>B2B platform for fashion casting</Text>
        <View style={styles.buttons}>
          <TouchableOpacity
            style={styles.button}
            onPress={() => onLogin('model')}
          >
            <Text style={styles.buttonLabel}>Login as Model</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.button}
            onPress={() => onLogin('agency')}
          >
            <Text style={styles.buttonLabel}>Login as Agency</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.button}
            onPress={() => onLogin('client')}
          >
            <Text style={styles.buttonLabel}>Login as Client</Text>
          </TouchableOpacity>
        </View>
        <Text style={[styles.buttonLabelSecondary, { marginTop: spacing.sm, fontSize: 11 }]}>
          Apply as Model: Sign up as Model, then use „My Applications“ in your account.
        </Text>
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
  content: {
    width: '100%',
    maxWidth: 360,
    alignItems: 'center',
  },
  brand: {
    ...typography.heading,
    color: colors.textPrimary,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  buttons: {
    width: '100%',
    gap: spacing.md,
  },
  button: {
    width: '100%',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: 2,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
  },
  buttonLabel: {
    ...typography.label,
    color: colors.textPrimary,
  },
  buttonSecondary: {
    borderColor: colors.textSecondary,
  },
  buttonLabelSecondary: {
    ...typography.label,
    color: colors.textSecondary,
  },
});
