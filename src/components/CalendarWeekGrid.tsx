import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  Pressable,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  LayoutChangeEvent,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { isMobileWidth } from '../theme/breakpoints';
import { uiCopy } from '../constants/uiCopy';
import type { CalendarScheduleBlock } from '../utils/calendarUnifiedTimeline';
import { assignOverlapLanes, formatMinutesAsHm } from '../utils/calendarTimelineLayout';
import {
  blockTimeRangeLabel,
  cappedBlockLayout,
  weekColumnKindSegments,
  weekKindSegmentLabel,
} from '../utils/calendarOverviewLayout';

const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const TIME_AXIS_WIDTH = 52;
const DAY_HEADER_ROW_H = 44;
const HOUR_HEIGHT = 44;

/** Default visible hour window expands with events (same idea as CalendarDayTimeline). */
const MIN_HOUR = 6;
const MAX_HOUR = 22;

const GRID_PADDING = spacing.sm;

const LONG_EVENT_CAP_MIN = 120;
const CAPPED_BLOCK_MAX_PX = 108;
const BLOCK_MIN_HEIGHT_PX = 20;

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
  events: CalendarScheduleBlock[];
  selectedDate: string | null;
  onSelectDay: (date: string) => void;
  onEventPress: (ev: CalendarScheduleBlock) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
  rangeLabel: string;
  /** @deprecated Week view is time-grid based; unused, kept for call-site compatibility. */
  maxChipsPerDay?: number;
  /** B2B: slightly narrower minimum column width on phones. */
  denseWorkWeek?: boolean;
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
  denseWorkWeek = false,
  showDayKindFooter = false,
}) => {
  const { width: layoutWidth } = useWindowDimensions();
  const isMobile = isMobileWidth(layoutWidth);
  const [bodyViewportW, setBodyViewportW] = useState(0);

  const pxPerMin = HOUR_HEIGHT / 60;

  const range = useMemo(() => {
    let evMin = MIN_HOUR * 60;
    let evMax = MAX_HOUR * 60;
    for (const e of events) {
      evMin = Math.min(evMin, Math.max(0, e.startMin - 30));
      evMax = Math.max(evMax, e.endMin + 30);
    }
    const startHour = Math.max(0, Math.floor(evMin / 60));
    const endHour = Math.min(24, Math.ceil(evMax / 60));
    const displayStartMin = startHour * 60;
    const displayEndMin = endHour * 60;
    const totalMin = Math.max(60, displayEndMin - displayStartMin);
    const totalHeight = totalMin * pxPerMin;
    const hours: number[] = [];
    for (let h = startHour; h < endHour; h++) hours.push(h);
    return {
      displayStartMin,
      totalHeight,
      startHour,
      endHour,
      hours,
    };
  }, [events, pxPerMin]);

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

  const minDayColumnPx = denseWorkWeek ? (isMobile ? 72 : 96) : isMobile ? 88 : 112;

  const onBodyMeasured = (e: LayoutChangeEvent) => {
    setBodyViewportW(e.nativeEvent.layout.width);
  };

  const fallbackViewport = Math.max(120, layoutWidth - TIME_AXIS_WIDTH - GRID_PADDING * 2 - 24);
  const usable = bodyViewportW > 0 ? bodyViewportW : fallbackViewport;
  const dayColumnWidth = Math.max(minDayColumnPx, Math.floor(usable / 7));
  const scrollContentWidth = dayColumnWidth * 7;

  const todayYmd = new Date().toISOString().slice(0, 10);

  const renderDayColumn = (date: string, idx: number) => {
    const list = byDate[date] ?? [];
    const lanes = assignOverlapLanes(list);
    const isSelected = selectedDate === date;
    const isToday = date === todayYmd;

    return (
      <View
        key={date}
        style={[
          styles.dayColumn,
          { width: dayColumnWidth, height: range.totalHeight },
          idx > 0 && styles.dayColumnBorder,
          isToday && styles.dayColumnToday,
          isSelected && styles.dayColumnSelected,
        ]}
      >
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => onSelectDay(date)}
          accessibilityRole="button"
          accessibilityLabel={`${WEEKDAY_SHORT[idx]} ${date}. Open day`}
        />

        {lanes.map((ev) => {
          const top = (ev.startMin - range.displayStartMin) * pxPerMin;
          const { heightPx, isCapped } = cappedBlockLayout(
            ev.startMin,
            ev.endMin,
            pxPerMin,
            BLOCK_MIN_HEIGHT_PX,
            CAPPED_BLOCK_MAX_PX,
            LONG_EVENT_CAP_MIN,
          );
          const laneCountForPct = ev.laneCount;
          const wPct = 100 / laneCountForPct;
          const leftPct = wPct * ev.lane;
          const timeLabel = blockTimeRangeLabel(ev.startMin, ev.endMin, isCapped);

          return (
            <TouchableOpacity
              key={`${ev.id}-${ev.startMin}-${ev.lane}-${date}`}
              onPress={(e) => {
                e.stopPropagation?.();
                onEventPress(ev);
              }}
              style={[
                styles.block,
                {
                  top,
                  height: heightPx,
                  left: `${leftPct}%`,
                  width: `${wPct}%`,
                  backgroundColor: ev.color,
                  zIndex: 2,
                },
              ]}
              accessibilityRole="button"
              accessibilityLabel={`${formatMinutesAsHm(ev.startMin)} ${ev.title}`}
            >
              <Text style={styles.blockTime} numberOfLines={1}>
                {timeLabel}
              </Text>
              <Text style={styles.blockTitle} numberOfLines={heightPx < 52 ? 1 : 2}>
                {ev.title}
              </Text>
              {isCapped ? <View style={styles.blockCapCue} pointerEvents="none" /> : null}
            </TouchableOpacity>
          );
        })}
      </View>
    );
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

      <View style={styles.gridShell}>
        {/* Fixed time gutter + horizontally scrollable day strip */}
        <View style={styles.gridRow}>
          <View style={{ width: TIME_AXIS_WIDTH }}>
            <View style={{ height: DAY_HEADER_ROW_H }} />
            {range.hours.map((h) => (
              <View key={`t-${h}`} style={{ height: HOUR_HEIGHT, justifyContent: 'flex-start' }}>
                <Text style={styles.hourLabel}>{String(h).padStart(2, '0')}:00</Text>
              </View>
            ))}
          </View>

          <View style={styles.bodyScrollHost} onLayout={onBodyMeasured}>
            <ScrollView
              horizontal
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsHorizontalScrollIndicator={scrollContentWidth > usable + 1}
              bounces={false}
            >
              <View style={{ width: scrollContentWidth }}>
                <View style={[styles.dayHeaderRow, { height: DAY_HEADER_ROW_H }]}>
                  {weekDates.map((date, idx) => {
                    const dayNum = Number(date.slice(8, 10));
                    const isSelected = selectedDate === date;
                    const isToday = date === todayYmd;
                    return (
                      <TouchableOpacity
                        key={date}
                        style={[
                          styles.dayHeaderCell,
                          { width: dayColumnWidth },
                          idx > 0 && styles.dayHeaderCellBorder,
                          isToday && styles.dayHeadToday,
                        ]}
                        onPress={() => onSelectDay(date)}
                        accessibilityRole="button"
                        accessibilityLabel={`${WEEKDAY_SHORT[idx]}, ${dayNum}`}
                      >
                        <Text style={styles.dayHeadWd}>{WEEKDAY_SHORT[idx]}</Text>
                        <Text style={[styles.dayHeadNum, isSelected && styles.dayHeadNumSel]}>
                          {dayNum}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>

                <View
                  style={[
                    styles.columnsRow,
                    { height: range.totalHeight, width: scrollContentWidth },
                  ]}
                >
                  {range.hours.map((h, i) => (
                    <View
                      key={`hline-all-${h}`}
                      pointerEvents="none"
                      style={[styles.gridHourLine, { top: i * HOUR_HEIGHT }]}
                    />
                  ))}
                  {weekDates.map((date, idx) => renderDayColumn(date, idx))}
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </View>

      {showDayKindFooter && events.length > 0 ? <WeekKindFooterVisual list={events} /> : null}
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
    marginBottom: spacing.xs,
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
  gridShell: {
    width: '100%',
    alignSelf: 'stretch',
  },
  gridRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
  },
  bodyScrollHost: {
    flex: 1,
    minWidth: 0,
  },
  hourLabel: {
    fontSize: 10,
    color: colors.textSecondary,
    marginTop: -2,
  },
  dayHeaderRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  dayHeaderCell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  dayHeaderCellBorder: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  dayHeadToday: {
    backgroundColor: colors.surfaceWarm,
  },
  dayHeadWd: { fontSize: 10, color: colors.textSecondary, fontWeight: '600' },
  dayHeadNum: { fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  dayHeadNumSel: { textDecorationLine: 'underline' },
  columnsRow: {
    flexDirection: 'row',
    position: 'relative',
  },
  gridHourLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    zIndex: 0,
  },
  dayColumn: {
    position: 'relative',
    backgroundColor: 'transparent',
  },
  dayColumnBorder: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  dayColumnToday: {
    backgroundColor: colors.surfaceWarm,
  },
  dayColumnSelected: {
    backgroundColor: 'rgba(0,0,0,0.03)',
  },
  block: {
    position: 'absolute',
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  blockTime: { fontSize: 8, color: '#fff', fontWeight: '700' },
  blockTitle: { fontSize: 9, color: '#fff', fontWeight: '600', lineHeight: 11 },
  blockCapCue: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 14,
    backgroundColor: 'rgba(0,0,0,0.2)',
  },
  kindFooterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
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
