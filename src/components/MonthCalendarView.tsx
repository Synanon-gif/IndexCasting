/**
 * Monatskalender: ganzer Monat als Grid, Tage mit Ereignissen farbig markiert.
 * Immer anzeigen (auch ohne Ereignisse).
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';

export type CalendarDayEvent = {
  id: string;
  color: string;
  title: string;
  kind?: string;
  /** Dedupe key for option-linked tiles (same day). */
  optionRequestId?: string | null;
};

export type MonthCalendarViewProps = {
  year: number;
  month: number;
  eventsByDate: Record<string, CalendarDayEvent[]>;
  onSelectDay: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  /** Highlights the focused day (same source as week/day views). */
  selectedDate?: string | null;
  /** Denser cells when stacked with week/day views (same event data). */
  compact?: boolean;
};

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getMonthGrid(
  year: number,
  month: number,
): { date: string | null; dayNum: number; isCurrentMonth: boolean }[] {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const daysInMonth = last.getDate();
  const startWeekday = (first.getDay() + 6) % 7;
  const cells: { date: string | null; dayNum: number; isCurrentMonth: boolean }[] = [];
  const pad = (n: number) => String(n).padStart(2, '0');
  for (let i = 0; i < startWeekday; i++)
    cells.push({ date: null, dayNum: 0, isCurrentMonth: false });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ date: `${year}-${pad(month + 1)}-${pad(d)}`, dayNum: d, isCurrentMonth: true });
  }
  const remainder = cells.length % 7;
  const fill = remainder === 0 ? 0 : 7 - remainder;
  for (let i = 0; i < fill; i++) cells.push({ date: null, dayNum: 0, isCurrentMonth: false });
  return cells;
}

export const MonthCalendarView: React.FC<MonthCalendarViewProps> = ({
  year,
  month,
  eventsByDate,
  onSelectDay,
  onPrevMonth,
  onNextMonth,
  selectedDate = null,
  compact = false,
}) => {
  const grid = React.useMemo(() => getMonthGrid(year, month), [year, month]);
  const monthLabel = new Date(year, month).toLocaleString('en-US', {
    month: 'long',
    year: 'numeric',
  });

  return (
    <View style={s.wrapper}>
      <View style={s.header}>
        <TouchableOpacity onPress={onPrevMonth} hitSlop={12} style={s.navBtn}>
          <Text style={s.navLabel}>‹</Text>
        </TouchableOpacity>
        <Text style={s.monthTitle}>{monthLabel}</Text>
        <TouchableOpacity onPress={onNextMonth} hitSlop={12} style={s.navBtn}>
          <Text style={s.navLabel}>›</Text>
        </TouchableOpacity>
      </View>
      <View style={s.weekdayRow}>
        {WEEKDAYS.map((w) => (
          <Text key={w} style={s.weekdayCell}>
            {w}
          </Text>
        ))}
      </View>
      <View style={s.grid}>
        {grid.map((cell, idx) => {
          if (!cell.date) return <View key={idx} style={s.dayCell} />;
          const events = eventsByDate[cell.date] ?? [];
          const isSelected = selectedDate != null && cell.date === selectedDate;
          return (
            <TouchableOpacity
              key={cell.date}
              style={[
                s.dayCell,
                s.dayCellActive,
                compact && s.dayCellCompact,
                isSelected && s.dayCellSelected,
              ]}
              onPress={() => onSelectDay(cell.date!)}
              activeOpacity={0.7}
            >
              <Text
                style={[
                  s.dayNum,
                  !cell.isCurrentMonth && s.dayNumMuted,
                  compact && s.dayNumCompact,
                  isSelected && s.dayNumSelected,
                ]}
              >
                {cell.dayNum}
              </Text>
              {events.length > 0 &&
                (compact ? (
                  // Compact (week+month combined): keep dot-row to save vertical
                  // space — titles are visible in the adjacent week/day surface.
                  <View style={[s.dotsRow, s.dotsRowCompact]}>
                    {events.slice(0, 2).map((ev) => (
                      <View
                        key={ev.id}
                        style={[s.dot, s.dotCompact, { backgroundColor: ev.color }]}
                        accessibilityLabel={ev.title}
                      />
                    ))}
                    {events.length > 2 && <Text style={s.moreText}>+{events.length - 2}</Text>}
                  </View>
                ) : (
                  // Standalone month grid: ALWAYS render the event title for
                  // every party (per product invariant — see calendar legend).
                  // Titles are truncated; full title is on the day-detail tap.
                  <View style={s.eventsCol}>
                    {events.slice(0, 2).map((ev) => (
                      <View
                        key={ev.id}
                        style={[s.eventChip, { backgroundColor: ev.color }]}
                        accessibilityLabel={ev.title}
                      >
                        <Text style={s.eventChipText} numberOfLines={1}>
                          {ev.title}
                        </Text>
                      </View>
                    ))}
                    {events.length > 2 && <Text style={s.moreText}>+{events.length - 2}</Text>}
                  </View>
                ))}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const s = StyleSheet.create({
  wrapper: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  navBtn: { padding: spacing.xs },
  navLabel: { fontSize: 22, color: colors.textPrimary, fontWeight: '600' },
  monthTitle: { ...typography.label, fontSize: 13, color: colors.textPrimary },
  weekdayRow: { flexDirection: 'row', marginBottom: 4 },
  weekdayCell: {
    flex: 1,
    textAlign: 'center',
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  dayCell: {
    width: '14.28%',
    minHeight: 56,
    padding: 2,
    justifyContent: 'flex-start',
    alignItems: 'stretch',
  },
  dayCellCompact: {
    minHeight: 40,
    maxHeight: 40,
    padding: 1,
    alignItems: 'center',
  },
  dayCellActive: { borderRadius: 8 },
  dayCellSelected: {
    borderWidth: 2,
    borderColor: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  dayNum: { ...typography.label, fontSize: 11, color: colors.textPrimary },
  dayNumCompact: { fontSize: 10 },
  dayNumSelected: { fontWeight: '700' },
  dayNumMuted: { color: colors.border },
  dotsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 2,
    marginTop: 2,
  },
  dotsRowCompact: { marginTop: 1, gap: 1 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  dotCompact: { width: 5, height: 5, borderRadius: 2 },
  moreText: { fontSize: 8, color: colors.textSecondary, textAlign: 'center' },
  // Day-cell with chip layout (titles always visible) — non-compact only.
  dayNumLeft: { textAlign: 'left', alignSelf: 'flex-start' },
  eventsCol: { marginTop: 2, gap: 2 },
  eventChip: { borderRadius: 3, paddingHorizontal: 3, paddingVertical: 1 },
  eventChipText: { fontSize: 8, color: '#fff', fontWeight: '600' },
});
