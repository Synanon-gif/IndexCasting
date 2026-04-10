import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';

type Props = {
  text: string;
};

/**
 * Workflow / system line — not a participant bubble (see system-invariants §4).
 */
export const OptionSystemInfoBlock: React.FC<Props> = ({ text }) => (
  <View style={styles.wrap} accessibilityRole="text">
    <Text style={styles.icon} accessibilityLabel="">
      ℹ️
    </Text>
    <Text style={styles.body}>{text}</Text>
  </View>
);

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginVertical: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: 'rgba(120,120,120,0.08)',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  icon: {
    ...typography.body,
    fontSize: 14,
    lineHeight: 20,
  },
  body: {
    ...typography.label,
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: colors.textSecondary,
  },
});
