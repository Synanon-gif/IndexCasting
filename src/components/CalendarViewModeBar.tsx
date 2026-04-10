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
};

export const CalendarViewModeBar: React.FC<CalendarViewModeBarProps> = ({
  mode,
  onModeChange,
  monthLabel,
  weekLabel,
  dayLabel,
  compact = false,
}) => {
  const pill = (m: CalendarViewMode, label: string) => {
    const active = mode === m;
    return (
      <TouchableOpacity
        onPress={() => onModeChange(m)}
        style={[styles.pill, active && styles.pillActive, compact && styles.pillCompact]}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
      >
        <Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={[styles.row, compact && styles.rowCompact]}>
      {pill('month', monthLabel)}
      {pill('week', weekLabel)}
      {pill('day', dayLabel)}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginBottom: spacing.sm,
    alignItems: 'center',
  },
  rowCompact: { marginBottom: spacing.xs },
  pill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: 'transparent',
  },
  pillCompact: {
    paddingHorizontal: spacing.xs,
    paddingVertical: 4,
  },
  pillActive: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  pillText: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
  },
  pillTextActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
});
