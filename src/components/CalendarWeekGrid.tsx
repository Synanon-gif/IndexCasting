import React, { useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { isMobileWidth } from '../theme/breakpoints';
import type { CalendarScheduleBlock } from '../utils/calendarUnifiedTimeline';
import { formatMinutesAsHm } from '../utils/calendarTimelineLayout';
import { formatWeekKindFooterShort, weekColumnKindSegments } from '../utils/calendarOverviewLayout';

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const COL_GAP = 4;
const GRID_PADDING = spacing.sm;
const COL_WIDTH_DESKTOP = 112;

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
  const { width: windowWidth } = useWindowDimensions();
  const isMobile = isMobileWidth(windowWidth);

  const colWidth = useMemo(() => {
    if (!isMobile) return COL_WIDTH_DESKTOP;
    const available = windowWidth - 2 * GRID_PADDING - 6 * COL_GAP - 2;
    return Math.max(36, Math.floor(available / 7));
  }, [windowWidth, isMobile]);

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

  const chipFontSize = denseWorkWeek ? (isMobile ? 7 : 8) : isMobile ? 8 : 9;
  const mobileMaxChips = isMobile ? (denseWorkWeek ? 3 : 2) : maxChipsPerDay;

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
      {isMobile ? (
        <View style={[styles.columns, { gap: COL_GAP }]}>
          {weekDates.map((date, idx) => {
            const dayNum = Number(date.slice(8, 10));
            const list = byDate[date] ?? [];
            const isSelected = selectedDate === date;
            const isToday = date === new Date().toISOString().slice(0, 10);
            return (
              <TouchableOpacity
                key={date}
                style={[
                  styles.col,
                  { width: colWidth, minHeight: 110 },
                  isSelected && styles.colSelected,
                  isToday && !isSelected && styles.colToday,
                ]}
                onPress={() => onSelectDay(date)}
                activeOpacity={0.85}
              >
                <Text style={styles.wd}>{WEEKDAY_SHORT[idx]}</Text>
                <Text style={[styles.dayNum, isSelected && styles.dayNumSelected]}>{dayNum}</Text>
                <View style={styles.chips}>
                  {list.slice(0, mobileMaxChips).map((ev) => (
                    <TouchableOpacity
                      key={ev.id + ev.startMin}
                      onPress={(e) => {
                        e.stopPropagation?.();
                        onEventPress(ev);
                      }}
                      style={[
                        styles.chip,
                        denseWorkWeek && styles.chipDense,
                        { backgroundColor: ev.color },
                      ]}
                      accessibilityLabel={`${formatMinutesAsHm(ev.startMin)} ${ev.title}`}
                    >
                      {denseWorkWeek ? (
                        <Text
                          style={[styles.chipText, { fontSize: chipFontSize }]}
                          numberOfLines={1}
                        >
                          {`${formatMinutesAsHm(ev.startMin)} ${ev.title}`}
                        </Text>
                      ) : (
                        <>
                          <Text
                            style={[styles.chipText, { fontSize: chipFontSize }]}
                            numberOfLines={1}
                          >
                            {formatMinutesAsHm(ev.startMin)}
                          </Text>
                          <Text
                            style={[styles.chipTextTitle, { fontSize: chipFontSize }]}
                            numberOfLines={1}
                          >
                            {ev.title}
                          </Text>
                        </>
                      )}
                    </TouchableOpacity>
                  ))}
                  {list.length > mobileMaxChips ? (
                    <Text style={styles.more}>+{list.length - mobileMaxChips}</Text>
                  ) : null}
                  {showDayKindFooter && list.length > 0 ? (
                    <Text style={styles.kindFooter} numberOfLines={1}>
                      {formatWeekKindFooterShort(weekColumnKindSegments(list))}
                    </Text>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      ) : (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={[styles.columns, { gap: COL_GAP }]}>
            {weekDates.map((date, idx) => {
              const dayNum = Number(date.slice(8, 10));
              const list = byDate[date] ?? [];
              const isSelected = selectedDate === date;
              const isToday = date === new Date().toISOString().slice(0, 10);
              return (
                <TouchableOpacity
                  key={date}
                  style={[
                    styles.col,
                    { width: colWidth },
                    isSelected && styles.colSelected,
                    isToday && !isSelected && styles.colToday,
                  ]}
                  onPress={() => onSelectDay(date)}
                  activeOpacity={0.85}
                >
                  <Text style={styles.wd}>{WEEKDAY_SHORT[idx]}</Text>
                  <Text style={[styles.dayNum, isSelected && styles.dayNumSelected]}>{dayNum}</Text>
                  <View style={styles.chips}>
                    {list.slice(0, maxChipsPerDay).map((ev) => (
                      <TouchableOpacity
                        key={ev.id + ev.startMin}
                        onPress={(e) => {
                          e.stopPropagation?.();
                          onEventPress(ev);
                        }}
                        style={[
                          styles.chip,
                          denseWorkWeek && styles.chipDense,
                          { backgroundColor: ev.color },
                        ]}
                        accessibilityLabel={`${formatMinutesAsHm(ev.startMin)} ${ev.title}`}
                      >
                        <Text
                          style={[styles.chipText, denseWorkWeek && styles.chipTextDense]}
                          numberOfLines={1}
                        >
                          {formatMinutesAsHm(ev.startMin)} {ev.title}
                        </Text>
                      </TouchableOpacity>
                    ))}
                    {list.length > maxChipsPerDay ? (
                      <Text style={styles.more}>+{list.length - maxChipsPerDay}</Text>
                    ) : null}
                    {showDayKindFooter && list.length > 0 ? (
                      <Text style={styles.kindFooter} numberOfLines={1}>
                        {formatWeekKindFooterShort(weekColumnKindSegments(list))}
                      </Text>
                    ) : null}
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>
        </ScrollView>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
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
  columns: { flexDirection: 'row' },
  col: {
    minHeight: 140,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 6,
    backgroundColor: 'transparent',
  },
  colSelected: {
    borderColor: colors.textPrimary,
    backgroundColor: colors.surface,
  },
  colToday: {
    borderColor: colors.accentGreen,
  },
  wd: { fontSize: 10, color: colors.textSecondary, textAlign: 'center' },
  dayNum: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.textPrimary,
    textAlign: 'center',
    marginBottom: 4,
  },
  dayNumSelected: { color: colors.textPrimary },
  chips: { gap: 4 },
  chip: {
    borderRadius: 4,
    paddingHorizontal: 4,
    paddingVertical: 3,
  },
  chipDense: {
    paddingVertical: 2,
    paddingHorizontal: 3,
  },
  chipText: { fontSize: 9, color: '#fff', fontWeight: '600' },
  chipTextDense: { fontSize: 8 },
  chipTextTitle: { fontSize: 9, color: '#fff', fontWeight: '500', opacity: 0.95 },
  more: { fontSize: 9, color: colors.textSecondary, textAlign: 'center' },
  kindFooter: {
    fontSize: 8,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 2,
    fontWeight: '500',
  },
});
