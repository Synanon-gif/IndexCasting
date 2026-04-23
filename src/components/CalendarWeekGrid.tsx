import React, { useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, useWindowDimensions } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { isMobileWidth } from '../theme/breakpoints';
import { uiCopy } from '../constants/uiCopy';
import type { CalendarScheduleBlock } from '../utils/calendarUnifiedTimeline';
import { formatMinutesAsHm } from '../utils/calendarTimelineLayout';
import type { DayTimeBand } from '../utils/calendarOverviewLayout';
import {
  startMinToDayTimeBand,
  weekColumnKindSegments,
  weekKindSegmentLabel,
} from '../utils/calendarOverviewLayout';

function timeBandUiLabel(band: DayTimeBand): string {
  const c = uiCopy.calendar;
  switch (band) {
    case 'early':
      return c.timeBandEarly;
    case 'morning':
      return c.timeBandMorning;
    case 'afternoon':
      return c.timeBandAfternoon;
    case 'evening':
      return c.timeBandEvening;
  }
}

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const COL_GAP = 4;
const GRID_PADDING = spacing.sm;

function WeekKindFooterVisual({ list }: { list: CalendarScheduleBlock[] }) {
  const segments = weekColumnKindSegments(list);
  if (segments.length === 0) return null;
  const c = uiCopy.calendar;
  const a11ySummary = segments.map((s) => `${weekKindSegmentLabel(s)} ${s.count}`).join(', ');
  return (
    <View
      style={styles.kindFooterRow}
      accessible
      accessibilityLabel={`${c.weekFooterA11yPrefix} ${a11ySummary}. ${c.weekFooterA11ySuffix}`}
    >
      {segments.map((s, i) => (
        <View key={`${s.bucket}|${s.color}|${i}`} style={styles.kindFooterItem} accessible={false}>
          <View style={[styles.kindFooterDot, { backgroundColor: s.color }]} />
          <Text style={styles.kindFooterText} numberOfLines={1}>
            {weekKindSegmentLabel(s)} {s.count}
          </Text>
        </View>
      ))}
    </View>
  );
}

export type CalendarWeekGridProps = {
  weekDates: string[];
  /** Events with date in this week */
  events: CalendarScheduleBlock[];
  selectedDate: string | null;
  onSelectDay: (date: string) => void;
  onEventPress: (ev: CalendarScheduleBlock) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  rangeLabel: string;
  maxChipsPerDay?: number;
  /** B2B: single-line event chips on mobile, slightly higher mobile chip cap. */
  denseWorkWeek?: boolean;
  /** B2B: compact kind counts under the chip list (full day). */
  showDayKindFooter?: boolean;
};

export const CalendarWeekGrid: React.FC<CalendarWeekGridProps> = ({
  weekDates,
  events,
  selectedDate,
  onSelectDay,
  onEventPress,
  onPrevWeek,
  onNextWeek,
  rangeLabel,
  maxChipsPerDay = 4,
  denseWorkWeek = false,
  showDayKindFooter = false,
}) => {
  const { width: layoutWidth } = useWindowDimensions();
  const isMobile = isMobileWidth(layoutWidth);

  const byDate = useMemo(() => {
    const m: Record<string, CalendarScheduleBlock[]> = {};
    for (const d of weekDates) m[d] = [];
    for (const e of events) {
      if (m[e.date]) m[e.date].push(e);
    }
    for (const d of weekDates) {
      m[d].sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));
    }
    return m;
  }, [events, weekDates]);

  // Chip presence: bigger on desktop so week chips read at the same distance as month/day, slightly
  // smaller on mobile to keep multi-event days legible without exceeding the 44px tap target.
  const chipFontSize = denseWorkWeek ? (isMobile ? 10 : 11) : isMobile ? 10 : 11;
  const mobileMaxChips = isMobile ? (denseWorkWeek ? 3 : 2) : maxChipsPerDay;

  const renderChipsForDay = (list: CalendarScheduleBlock[], cap: number) => {
    const slice = list.slice(0, cap);
    const nodes: React.ReactNode[] = [];
    let prevBand: ReturnType<typeof startMinToDayTimeBand> | null = null;

    for (let i = 0; i < slice.length; i++) {
      const ev = slice[i];
      if (denseWorkWeek) {
        const band = startMinToDayTimeBand(ev.startMin);
        if (prevBand !== band) {
          prevBand = band;
          nodes.push(
            <View key={`band-${band}-${i}`} style={styles.bandDivider}>
              <Text style={styles.bandLabel}>{timeBandUiLabel(band)}</Text>
            </View>,
          );
        }
      }

      const chipHitStyle = [
        styles.chip,
        denseWorkWeek && styles.chipDense,
        denseWorkWeek && isMobile && styles.chipMobileDenseTap,
        { backgroundColor: ev.color },
      ];

      nodes.push(
        <TouchableOpacity
          key={ev.id + ev.startMin}
          onPress={(e) => {
            e.stopPropagation?.();
            onEventPress(ev);
          }}
          style={chipHitStyle}
          accessibilityLabel={`${formatMinutesAsHm(ev.startMin)} ${ev.title}`}
        >
          {denseWorkWeek ? (
            <Text style={[styles.chipText, { fontSize: chipFontSize }]} numberOfLines={1}>
              {`${formatMinutesAsHm(ev.startMin)} ${ev.title}`}
            </Text>
          ) : (
            <>
              <Text style={[styles.chipText, { fontSize: chipFontSize }]} numberOfLines={1}>
                {formatMinutesAsHm(ev.startMin)}
              </Text>
              <Text style={[styles.chipTextTitle, { fontSize: chipFontSize }]} numberOfLines={1}>
                {ev.title}
              </Text>
            </>
          )}
        </TouchableOpacity>,
      );
    }
    return nodes;
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={onPrevWeek}
          hitSlop={10}
          style={styles.navHit}
          accessibilityRole="button"
          accessibilityLabel="Previous week"
        >
          <Text style={styles.navChevron}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.rangeText} numberOfLines={1}>
          {rangeLabel}
        </Text>
        <TouchableOpacity
          onPress={onNextWeek}
          hitSlop={10}
          style={styles.navHit}
          accessibilityRole="button"
          accessibilityLabel="Next week"
        >
          <Text style={styles.navChevron}>›</Text>
        </TouchableOpacity>
      </View>
      <View style={[styles.columns, { gap: COL_GAP }]}>
        {weekDates.map((date, idx) => {
          const dayNum = Number(date.slice(8, 10));
          const list = byDate[date] ?? [];
          const cap = isMobile ? mobileMaxChips : maxChipsPerDay;
          const isSelected = selectedDate === date;
          const isToday = date === new Date().toISOString().slice(0, 10);
          const hasEvents = list.length > 0;
          return (
            <TouchableOpacity
              key={date}
              style={[
                styles.col,
                styles.colFlex,
                isMobile && denseWorkWeek && styles.colMobileDenseH,
                isMobile && !denseWorkWeek && styles.colMobileStdH,
                hasEvents && styles.colHasEvents,
                isToday && !isSelected && styles.colToday,
                isSelected && styles.colSelected,
              ]}
              onPress={() => onSelectDay(date)}
              activeOpacity={0.85}
            >
              <View style={styles.colHeader}>
                <Text style={styles.wd}>{WEEKDAY_SHORT[idx]}</Text>
                <Text style={[styles.dayNum, isSelected && styles.dayNumSelected]}>{dayNum}</Text>
              </View>
              <View style={styles.colBody}>
                {hasEvents ? (
                  <View style={styles.chips}>
                    {renderChipsForDay(list, cap)}
                    {list.length > cap ? (
                      <View style={denseWorkWeek && isMobile ? styles.moreHit : undefined}>
                        <Text style={styles.more}>+{list.length - cap}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : (
                  // Empty days get a low-contrast hint so the week grid never reads as "broken /
                  // empty cards"; a11y unchanged (touch target still opens the day view).
                  <View style={styles.emptyHint} pointerEvents="none">
                    <Text style={styles.emptyHintText}>—</Text>
                  </View>
                )}
              </View>
              {showDayKindFooter && hasEvents ? <WeekKindFooterVisual list={list} /> : null}
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'stretch',
    width: '100%',
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: GRID_PADDING,
    marginBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  navHit: { padding: spacing.xs },
  navChevron: { fontSize: 22, color: colors.textPrimary, fontWeight: '600' },
  rangeText: {
    ...typography.label,
    fontSize: 12,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  columns: { flexDirection: 'row', width: '100%', alignSelf: 'stretch' },
  col: {
    // Taller columns reduce the visual gap between event chips and the cell border so the week
    // surface no longer reads as "sparse cards"; matches the perceived density of Month and Day.
    minHeight: 172,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
    backgroundColor: 'transparent',
    flexDirection: 'column',
  },
  colFlex: { flexGrow: 1, flexShrink: 1, flexBasis: 0, minWidth: 0 },
  colMobileDenseH: { minHeight: 152 },
  colMobileStdH: { minHeight: 132 },
  colHasEvents: {
    // Subtle warm tint when the day carries events, mirroring the premium MonthCalendarView surface.
    backgroundColor: colors.surfaceWarm,
  },
  colSelected: {
    borderColor: colors.textPrimary,
    borderWidth: 2,
    padding: 7,
    backgroundColor: colors.surface,
  },
  colToday: {
    borderColor: colors.accentGreen,
  },
  colHeader: {
    alignItems: 'center',
    marginBottom: 6,
  },
  colBody: {
    flexGrow: 1,
    flexShrink: 1,
    minHeight: 0,
  },
  wd: { fontSize: 10, color: colors.textSecondary, textAlign: 'center', letterSpacing: 0.4 },
  dayNum: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
    lineHeight: 20,
  },
  dayNumSelected: { fontWeight: '700' },
  chips: { gap: 5 },
  bandDivider: {
    marginTop: 3,
    marginBottom: 3,
    paddingBottom: 2,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  bandLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  chip: {
    // Stronger chip presence: bigger padding + radius so the colour blocks read as event tiles
    // rather than tiny pills, matching Day-view block density on the same calendar surface.
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 5,
  },
  chipDense: {
    paddingVertical: 4,
    paddingHorizontal: 6,
    borderRadius: 5,
  },
  chipMobileDenseTap: {
    minHeight: 44,
    justifyContent: 'center',
  },
  chipText: { fontSize: 11, color: '#fff', fontWeight: '700', lineHeight: 13 },
  chipTextTitle: { fontSize: 11, color: '#fff', fontWeight: '500', opacity: 0.95, lineHeight: 13 },
  more: { fontSize: 10, color: colors.textSecondary, textAlign: 'center', fontWeight: '600' },
  moreHit: {
    minHeight: 40,
    justifyContent: 'center',
  },
  emptyHint: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyHintText: {
    fontSize: 14,
    color: colors.borderLight,
    fontWeight: '500',
  },
  kindFooterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: 6,
    paddingTop: 5,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  kindFooterItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    maxWidth: '100%',
  },
  kindFooterDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
  },
  kindFooterText: {
    fontSize: 9,
    color: colors.textSecondary,
    fontWeight: '600',
  },
});
