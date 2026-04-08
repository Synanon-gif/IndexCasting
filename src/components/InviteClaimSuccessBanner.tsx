import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';

type Props = {
  message: string;
  onDismiss: () => void;
};

export function InviteClaimSuccessBanner({ message, onDismiss }: Props) {
  const insets = useSafeAreaInsets();
  const padTop = Platform.OS === 'web' ? spacing.sm : Math.max(insets.top, spacing.sm);

  return (
    <View style={[styles.wrap, { paddingTop: padTop }]}>
      <Text style={styles.text}>{message}</Text>
      <TouchableOpacity onPress={onDismiss} accessibilityRole="button" hitSlop={8}>
        <Text style={styles.dismiss}>{uiCopy.inviteClaimSuccess.dismiss}</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  text: {
    ...typography.body,
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 18,
  },
  dismiss: {
    ...typography.label,
    fontSize: 12,
    color: colors.textSecondary,
    textDecorationLine: 'underline',
  },
});
