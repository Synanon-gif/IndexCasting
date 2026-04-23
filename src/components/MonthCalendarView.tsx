/**
 * Monatskalender: ganzer Monat als Grid, Tage mit Ereignissen farbig markiert.
 * Immer anzeigen (auch ohne Ereignisse).
 */
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import {
  monthDayKindSegments,
  sortCalendarDayEventsForOverview,
} from '../utils/calendarOverviewLayout';

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
  /**
   * B2B month “radar”: proportional kind strip + top-priority title chip(s) + overflow.
   * Full titles remain on the day view after tap; chips and cell use strong a11y labels.
   */
  denseOverview?: boolean;
  /** Visible title chips in dense month (default 1). Ignored when `denseOverview` is false. */
  denseOverviewMaxVisibleChips?: number;
  /**
   * Separate tap target for the dense "+N" overflow (e.g. open week for that date).
   * When unset, "+N" is only part of the main day `onSelectDay` target.
   */
  onDenseOverflowPress?: (date: string) => void;
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
  denseOverview = false,
  denseOverviewMaxVisibleChips = 1,
  onDenseOverflowPress,
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
          const sortedDense =
            denseOverview && !compact ? sortCalendarDayEventsForOverview(events) : events;
          const segments = denseOverview && !compact ? monthDayKindSegments(events) : [];
          const maxDense = Math.max(1, denseOverviewMaxVisibleChips);
          const denseShown = denseOverview && !compact ? sortedDense.slice(0, maxDense) : [];
          const denseMore =
            denseOverview && !compact ? Math.max(0, events.length - denseShown.length) : 0;
          const a11yTitles = sortCalendarDayEventsForOverview(events)
            .slice(0, 12)
            .map((e) => e.title);
          const a11yMore =
            events.length > a11yTitles.length ? `, +${events.length - a11yTitles.length} more` : '';
          const cellA11yBase =
            events.length > 0
              ? `${cell.dayNum}: ${events.length} events. ${a11yTitles.join(', ')}${a11yMore}`
              : `Day ${cell.dayNum}`;
          const cellA11y =
            events.length > 0 && denseOverview && !compact
              ? `${cellA11yBase}. ${uiCopy.calendar.monthDenseA11yOpensWeek}`
              : events.length > 0
                ? `${cellA11yBase}.`
                : cellA11yBase;

          const splitOverflow =
            denseOverview && !compact && onDenseOverflowPress != null && denseMore > 0;

          const denseBody = (
            <View style={s.denseOverviewCol}>
              {segments.length > 0 ? (
                <View style={s.kindStripRow}>
                  {segments.map((seg, si) => (
                    <View
                      key={`${seg.bucket}-${si}`}
                      style={[s.kindStripSeg, { flex: seg.count, backgroundColor: seg.color }]}
                    />
                  ))}
                </View>
              ) : null}
              <View style={s.eventsCol}>
                {denseShown.map((ev) => (
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
                {!splitOverflow && denseMore > 0 ? (
                  <Text style={s.moreText}>+{denseMore}</Text>
                ) : null}
              </View>
            </View>
          );

          return (
            <View
              key={cell.date}
              style={[
                s.dayCell,
                s.dayCellActive,
                compact && s.dayCellCompact,
                denseOverview && !compact && s.dayCellDenseOverview,
                splitOverflow && s.dayCellSplitOverflow,
                isSelected && s.dayCellSelected,
              ]}
            >
              <TouchableOpacity
                style={splitOverflow ? s.dayCellMainTap : s.dayCellFillTap}
                onPress={() => onSelectDay(cell.date!)}
                activeOpacity={0.7}
                accessibilityLabel={cellA11y}
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
                  ) : denseOverview ? (
                    denseBody
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
              {splitOverflow ? (
                <TouchableOpacity
                  style={s.denseMoreHit}
                  onPress={() => onDenseOverflowPress!(cell.date!)}
                  activeOpacity={0.75}
                  accessibilityRole="button"
                  accessibilityLabel={`${denseMore} more events. ${uiCopy.calendar.monthDenseA11yOpensWeek}`}
                >
                  <Text style={s.moreText}>+{denseMore}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
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
  dayCellDenseOverview: {
    minHeight: 58,
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
  denseOverviewCol: { marginTop: 2, gap: 3 },
  kindStripRow: {
    flexDirection: 'row',
    height: 5,
    borderRadius: 3,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.14)',
    gap: 1,
  },
  kindStripSeg: {
    height: 5,
    borderRadius: 1,
    minWidth: 4,
  },
  dayCellSplitOverflow: {
    flexDirection: 'column',
    justifyContent: 'flex-start',
  },
  dayCellMainTap: {
    flex: 1,
    minHeight: 0,
    width: '100%',
  },
  dayCellFillTap: {
    flex: 1,
    width: '100%',
  },
  denseMoreHit: {
    minHeight: 44,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 2,
    width: '100%',
  },
});
