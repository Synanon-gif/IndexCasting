import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';

export type CalendarViewMode = 'month' | 'week' | 'day';

export type CalendarViewModeBarProps = {
  mode: CalendarViewMode;
  onModeChange: (m: CalendarViewMode) => void;
  monthLabel: string;
  weekLabel: string;
  dayLabel: string;
  compact?: boolean;
  /** Optional section title — makes Month/Week/Day discoverable in long layouts. */
  sectionTitle?: string;
  /** One line under the pills (e.g. why Week/Day adds detail). */
  sectionHint?: string;
};

export const CalendarViewModeBar: React.FC<CalendarViewModeBarProps> = ({
  mode,
  onModeChange,
  monthLabel,
  weekLabel,
  dayLabel,
  compact = false,
  sectionTitle,
  sectionHint,
}) => {
  const pill = (m: CalendarViewMode, label: string) => {
    const active = mode === m;
    return (
      <TouchableOpacity
        onPress={() => onModeChange(m)}
        style={[styles.pill, active && styles.pillActive, compact && styles.pillCompact]}
        accessibilityRole="button"
        accessibilityLabel={`${label} view`}
        accessibilityState={{ selected: active }}
      >
        <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.wrap}>
      {sectionTitle ? (
        <Text style={styles.sectionTitle} accessibilityRole="header">
          {sectionTitle}
        </Text>
      ) : null}
      <View style={[styles.row, compact && styles.rowCompact]} accessibilityRole="tablist">
        {pill('month', monthLabel)}
        {pill('week', weekLabel)}
        {pill('day', dayLabel)}
      </View>
      {sectionHint ? <Text style={styles.sectionHint}>{sectionHint}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    marginBottom: spacing.sm,
  },
  sectionTitle: {
    ...typography.label,
    fontSize: 13,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: spacing.xs,
    textTransform: 'none',
    letterSpacing: 0,
  },
  sectionHint: {
    ...typography.body,
    fontSize: 12,
    color: colors.textSecondary,
    marginTop: spacing.xs,
    lineHeight: 16,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
  },
  rowCompact: { marginBottom: 0 },
  pill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    minHeight: 40,
    justifyContent: 'center',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pillCompact: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    minHeight: 36,
  },
  pillActive: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.textPrimary,
  },
  pillText: {
    ...typography.label,
    fontSize: 13,
    color: colors.textSecondary,
  },
  pillTextActive: {
    color: '#ffffff',
    fontWeight: '700',
  },
});
