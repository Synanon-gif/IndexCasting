import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { colors, spacing, typography } from '../theme/theme';
import type { UserRole } from '../navigation/RootNavigator';

type Props = {
  onSelectRole: (role: UserRole) => void;
} & NativeStackScreenProps<any>;

export const LoginScreen: React.FC<Props> = ({ onSelectRole }) => {
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null);

  const roleLabel =
    selectedRole === 'client'
      ? 'Client'
      : selectedRole === 'model'
      ? 'Model'
      : selectedRole === 'agency'
      ? 'Agency'
      : 'Select role';

  return (
    <View style={styles.container}>
      <View style={styles.topBlock}>
        <Text style={styles.brand}>INDEX CASTING</Text>
        <Text style={styles.subtitle}>B2B platform for fashion casting.</Text>
      </View>

      <View style={styles.centerBlock}>
        <Text style={styles.sectionLabel}>Access</Text>
        <Text style={styles.copy}>
          Verified agencies and brands only. Use your work email to request
          access.
        </Text>

        <View style={styles.rolesRow}>
          <TouchableOpacity
            style={[
              styles.rolePill,
              selectedRole === 'client' && styles.rolePillActive,
            ]}
            onPress={() => setSelectedRole('client')}
          >
            <Text
              style={[
                styles.roleLabel,
                selectedRole === 'client' && styles.roleLabelActive,
              ]}
            >
              Client
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.rolePill,
              selectedRole === 'model' && styles.rolePillActive,
            ]}
            onPress={() => setSelectedRole('model')}
          >
            <Text
              style={[
                styles.roleLabel,
                selectedRole === 'model' && styles.roleLabelActive,
              ]}
            >
              Model
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.rolePill,
              selectedRole === 'agency' && styles.rolePillActive,
            ]}
            onPress={() => setSelectedRole('agency')}
          >
            <Text
              style={[
                styles.roleLabel,
                selectedRole === 'agency' && styles.roleLabelActive,
              ]}
            >
              Agency
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.bottomBlock}>
        <TouchableOpacity
          style={[
            styles.primaryButton,
            !selectedRole && styles.primaryButtonDisabled,
          ]}
          disabled={!selectedRole}
          onPress={() => selectedRole && onSelectRole(selectedRole)}
        >
          <Text style={styles.primaryLabel}>
            {selectedRole ? `Continue as ${roleLabel}` : 'Choose a role to enter'}
          </Text>
        </TouchableOpacity>
        <Text style={styles.helperText}>
          Dummy-Flow – Rolle wählen, um den jeweiligen Workspace zu sehen.
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl * 1.5,
    paddingBottom: spacing.xl,
    justifyContent: 'space-between',
  },
  topBlock: {
    gap: spacing.sm,
  },
  brand: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    maxWidth: '80%',
  },
  centerBlock: {
    gap: spacing.md,
  },
  rolesRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  rolePill: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rolePillActive: {
    borderColor: colors.accentGreen,
    backgroundColor: '#F1F3F2',
  },
  roleLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  roleLabelActive: {
    color: colors.accentGreen,
  },
  sectionLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  copy: {
    ...typography.body,
    color: colors.textPrimary,
  },
  bottomBlock: {
    gap: spacing.sm,
  },
  primaryButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.textPrimary,
    paddingVertical: spacing.md,
    alignItems: 'center',
    backgroundColor: colors.surface,
  },
  primaryButtonDisabled: {
    opacity: 0.4,
  },
  primaryLabel: {
    ...typography.label,
    color: colors.textPrimary,
  },
  helperText: {
    ...typography.body,
    color: colors.textSecondary,
  },
});

