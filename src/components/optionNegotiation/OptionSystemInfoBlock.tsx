import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../../theme/theme';

type Props = {
  text: string;
};

/**
 * Workflow / system line — not a participant bubble (see system-invariants §4).
 * Rendered as an iMessage-style centered milestone marker, not a banner block.
 */
export const OptionSystemInfoBlock: React.FC<Props> = ({ text }) => (
  <View style={styles.milestoneRow} accessibilityRole="text">
    <View style={styles.line} />
    <Text style={styles.milestoneText}>{text}</Text>
    <View style={styles.line} />
  </View>
);

const styles = StyleSheet.create({
  milestoneRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    gap: spacing.sm,
  },
  line: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    opacity: 0.6,
  },
  milestoneText: {
    ...typography.label,
    fontSize: 11,
    lineHeight: 16,
    color: colors.textSecondary,
    textAlign: 'center',
    opacity: 0.75,
    flexShrink: 1,
    paddingHorizontal: spacing.xs,
  },
});
