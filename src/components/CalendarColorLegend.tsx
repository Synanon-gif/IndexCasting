import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import { CALENDAR_COLORS, CALENDAR_PROJECTION_COLORS } from '../utils/calendarColors';

/**
 * Calendar color legend — shown beneath every calendar surface
 * (Agency, Client Web, Model). Swatches match `calendarGridColorForOptionItem` /
 * `getCalendarProjectionBadge` / `getCalendarEntryBlockColor` (`src/utils/calendarProjectionLabel.ts`)
 * and `CALENDAR_COLORS` + `CALENDAR_PROJECTION_COLORS`; manual events use per-row color + `CALENDAR_COLORS.personal` default.
 */
export const CalendarColorLegend: React.FC = () => {
  const items: { label: string; color: string }[] = [
    { label: uiCopy.calendar.legendOption, color: CALENDAR_COLORS.option },
    { label: uiCopy.calendar.legendCasting, color: CALENDAR_COLORS.casting },
    { label: uiCopy.calendar.legendJob, color: CALENDAR_COLORS.job },
    { label: uiCopy.calendar.legendOwnEvent, color: CALENDAR_COLORS.personal },
    { label: uiCopy.calendar.legendAwaitingModel, color: CALENDAR_PROJECTION_COLORS.awaitingModel },
    {
      label: uiCopy.calendar.legendJobConfirmationPending,
      color: CALENDAR_PROJECTION_COLORS.jobConfirmationPending,
    },
    {
      label: uiCopy.calendar.legendRejectedOrInactive,
      color: CALENDAR_PROJECTION_COLORS.rejected,
    },
  ];

  return (
    <View style={styles.wrapper} accessibilityLabel={uiCopy.calendar.colorLegendHeading}>
      <Text style={styles.heading}>{uiCopy.calendar.colorLegendHeading}</Text>
      <View style={styles.row}>
        {items.map((it) => (
          <View key={it.label} style={styles.item}>
            <View style={[styles.swatch, { backgroundColor: it.color }]} />
            <Text style={styles.label} numberOfLines={2}>
              {it.label}
            </Text>
          </View>
        ))}
      </View>
      <Text style={styles.footnote}>{uiCopy.calendar.legendTentativeJobNote}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  heading: {
    ...typography.label,
    fontSize: 11,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  swatch: {
    width: 12,
    height: 12,
    borderRadius: 3,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
  },
  label: {
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
  },
  footnote: {
    ...typography.body,
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
});
