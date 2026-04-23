import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  useWindowDimensions,
  LayoutChangeEvent,
} from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import { uiCopy } from '../constants/uiCopy';
import type { CalendarScheduleBlock } from '../utils/calendarUnifiedTimeline';
import { assignOverlapLanes, formatMinutesAsHm } from '../utils/calendarTimelineLayout';
import { blockTimeRangeLabel, cappedBlockLayout } from '../utils/calendarOverviewLayout';

const HOUR_HEIGHT = 44;
const MIN_HOUR = 6;
const MAX_HOUR = 22;

export type CalendarDayTimelineProps = {
  dateLabel: string;
  events: CalendarScheduleBlock[];
  onEventPress: (ev: CalendarScheduleBlock) => void;
  onPrevDay: () => void;
  onNextDay: () => void;
  /**
   * When set together with `cappedBlockMaxHeightPx`, blocks longer than this many minutes
   * use a capped visual height (timespan still shown in the label).
   */
  longEventCapMinDuration?: number;
  cappedBlockMaxHeightPx?: number;
  /** When set, overlapping lanes get at least this width and the grid scrolls horizontally if needed. */
  minLaneWidthPx?: number;
  /**
   * Max parallel lanes to render; additional overlapping events are counted only
   * (“+N more”) to keep the grid readable. Requires `minLaneWidthPx` for layout width.
   */
  maxVisibleParallelLanes?: number;
};

export const CalendarDayTimeline: React.FC<CalendarDayTimelineProps> = ({
  dateLabel,
  events,
  onEventPress,
  onPrevDay,
  onNextDay,
  longEventCapMinDuration,
  cappedBlockMaxHeightPx,
  minLaneWidthPx,
  maxVisibleParallelLanes,
}) => {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [viewportW, setViewportW] = useState(0);
  const [expandedHidden, setExpandedHidden] = useState(false);
  const timelineMaxHeight = Math.max(300, Math.round(windowHeight * 0.55));
  const pxPerMin = HOUR_HEIGHT / 60;

  const { lanesAll, displayStartMin, totalHeight, startHour, endHour } = useMemo(() => {
    let evMin = MIN_HOUR * 60;
    let evMax = MAX_HOUR * 60;
    for (const e of events) {
      evMin = Math.min(evMin, Math.max(0, e.startMin - 30));
      evMax = Math.max(evMax, e.endMin + 30);
    }
    const startHourInner = Math.max(0, Math.floor(evMin / 60));
    const endHourInner = Math.min(24, Math.ceil(evMax / 60));
    const displayStart = startHourInner * 60;
    const displayEnd = endHourInner * 60;
    const lanesInner = assignOverlapLanes(events);
    const totalMin = Math.max(60, displayEnd - displayStart);
    const totalHeightInner = totalMin * pxPerMin;
    return {
      lanesAll: lanesInner,
      displayStartMin: displayStart,
      totalHeight: totalHeightInner,
      startHour: startHourInner,
      endHour: endHourInner,
    };
  }, [events, pxPerMin]);

  const laneCap =
    maxVisibleParallelLanes != null && maxVisibleParallelLanes > 0
      ? maxVisibleParallelLanes
      : Number.POSITIVE_INFINITY;

  const lanes = useMemo(() => {
    if (!Number.isFinite(laneCap)) return lanesAll;
    return lanesAll.filter((e) => e.lane < laneCap);
  }, [lanesAll, laneCap]);

  const hiddenParallelCount = lanesAll.length - lanes.length;

  const hiddenEvents = useMemo(() => {
    if (!Number.isFinite(laneCap)) return [];
    const h = lanesAll.filter((e) => e.lane >= laneCap);
    return [...h].sort((a, b) => a.startMin - b.startMin || a.title.localeCompare(b.title));
  }, [lanesAll, laneCap]);

  useEffect(() => {
    setExpandedHidden(false);
  }, [events, dateLabel]);

  const maxLaneCount = useMemo(
    () => (lanesAll.length ? Math.max(...lanesAll.map((l) => l.laneCount)) : 1),
    [lanesAll],
  );

  const effectiveLaneColumns = useMemo(
    () => (Number.isFinite(laneCap) ? Math.min(maxLaneCount, laneCap) : maxLaneCount),
    [laneCap, maxLaneCount],
  );

  const useLanePixels = minLaneWidthPx != null && minLaneWidthPx > 0;
  const fallbackViewportW = Math.max(160, windowWidth - 44 - spacing.sm * 4);
  const measuredW = viewportW > 0 ? viewportW : fallbackViewportW;
  const innerCanvasW = useLanePixels
    ? Math.max(measuredW, effectiveLaneColumns * minLaneWidthPx!)
    : undefined;

  const hours = useMemo(() => {
    const h: number[] = [];
    for (let x = startHour; x < endHour; x++) h.push(x);
    return h;
  }, [startHour, endHour]);

  const onGridViewportLayout = (e: LayoutChangeEvent) => {
    setViewportW(e.nativeEvent.layout.width);
  };

  const renderGridContents = (laneLayout: 'percent' | 'pixels') => (
    <>
      {hours.map((h, i) => (
        <View key={`line-${h}`} style={[styles.gridHourLine, { top: i * HOUR_HEIGHT }]} />
      ))}
      {lanes.map((ev) => {
        const top = (ev.startMin - displayStartMin) * pxPerMin;
        const { heightPx, isCapped } = cappedBlockLayout(
          ev.startMin,
          ev.endMin,
          pxPerMin,
          22,
          cappedBlockMaxHeightPx,
          longEventCapMinDuration,
        );
        const timeLabel = blockTimeRangeLabel(ev.startMin, ev.endMin, isCapped);
        const capCue = isCapped ? <View style={styles.blockCapCue} pointerEvents="none" /> : null;

        if (laneLayout === 'pixels' && minLaneWidthPx) {
          const w = minLaneWidthPx - 2;
          const left = ev.lane * minLaneWidthPx + 1;
          return (
            <TouchableOpacity
              key={`${ev.id}-${ev.startMin}-${ev.lane}`}
              onPress={() => onEventPress(ev)}
              style={[
                styles.block,
                {
                  top,
                  height: heightPx,
                  left,
                  width: w,
                  backgroundColor: ev.color,
                },
              ]}
              accessibilityLabel={`${formatMinutesAsHm(ev.startMin)} ${ev.title}`}
            >
              <Text style={styles.blockTime} numberOfLines={1}>
                {timeLabel}
              </Text>
              <Text style={styles.blockTitle} numberOfLines={isCapped ? 2 : 4}>
                {ev.title}
              </Text>
              {capCue}
            </TouchableOpacity>
          );
        }
        const laneCountForPct = Number.isFinite(laneCap)
          ? Math.min(ev.laneCount, laneCap)
          : ev.laneCount;
        const wPct = 100 / laneCountForPct;
        const leftPct = wPct * ev.lane;
        return (
          <TouchableOpacity
            key={`${ev.id}-${ev.startMin}-${ev.lane}`}
            onPress={() => onEventPress(ev)}
            style={[
              styles.block,
              {
                top,
                height: heightPx,
                left: `${leftPct}%`,
                width: `${wPct}%`,
                backgroundColor: ev.color,
              },
            ]}
            accessibilityLabel={`${formatMinutesAsHm(ev.startMin)} ${ev.title}`}
          >
            <Text style={styles.blockTime} numberOfLines={1}>
              {timeLabel}
            </Text>
            <Text style={styles.blockTitle} numberOfLines={isCapped ? 2 : 4}>
              {ev.title}
            </Text>
            {capCue}
          </TouchableOpacity>
        );
      })}
    </>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={onPrevDay}
          hitSlop={10}
          style={styles.navHit}
          accessibilityRole="button"
          accessibilityLabel="Previous day"
        >
          <Text style={styles.navChevron}>‹</Text>
        </TouchableOpacity>
        <Text style={styles.title} numberOfLines={1}>
          {dateLabel}
        </Text>
        <TouchableOpacity
          onPress={onNextDay}
          hitSlop={10}
          style={styles.navHit}
          accessibilityRole="button"
          accessibilityLabel="Next day"
        >
          <Text style={styles.navChevron}>›</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        style={{ maxHeight: timelineMaxHeight }}
        showsVerticalScrollIndicator
        nestedScrollEnabled
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.bodyRow}>
          <View style={{ width: 44 }}>
            {hours.map((h) => (
              <View key={h} style={{ height: HOUR_HEIGHT, justifyContent: 'flex-start' }}>
                <Text style={styles.hourLabel}>{String(h).padStart(2, '0')}:00</Text>
              </View>
            ))}
          </View>
          {useLanePixels ? (
            <View style={styles.gridViewport} onLayout={onGridViewportLayout}>
              <ScrollView
                horizontal
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
                showsHorizontalScrollIndicator={effectiveLaneColumns > 2}
              >
                <View style={[styles.gridArea, { height: totalHeight, width: innerCanvasW }]}>
                  {renderGridContents('pixels')}
                </View>
              </ScrollView>
            </View>
          ) : (
            <View style={[styles.gridArea, { height: totalHeight, flex: 1 }]}>
              {renderGridContents('percent')}
            </View>
          )}
        </View>
        {hiddenParallelCount > 0 ? (
          <View style={styles.hiddenOverflowSection}>
            <TouchableOpacity
              style={styles.hiddenOverflowToggle}
              onPress={() => setExpandedHidden((v) => !v)}
              accessibilityRole="button"
              accessibilityState={{ expanded: expandedHidden }}
              accessibilityHint={uiCopy.calendar.dayTimelineOverflowA11yHint}
              accessibilityLabel={
                expandedHidden
                  ? uiCopy.calendar.dayTimelineOverflowA11yHide(hiddenParallelCount)
                  : uiCopy.calendar.dayTimelineOverflowA11yShow(hiddenParallelCount)
              }
            >
              <Text style={styles.hiddenOverflowToggleText}>
                {expandedHidden
                  ? uiCopy.calendar.dayTimelineOverflowHide(hiddenParallelCount)
                  : uiCopy.calendar.dayTimelineOverflowShow(hiddenParallelCount)}
              </Text>
            </TouchableOpacity>
            {expandedHidden ? (
              <ScrollView
                style={styles.hiddenListScroll}
                nestedScrollEnabled
                keyboardShouldPersistTaps="handled"
              >
                {hiddenEvents.map((ev) => (
                  <TouchableOpacity
                    key={`${ev.id}-${ev.startMin}-h-${ev.lane}`}
                    style={styles.hiddenListRow}
                    onPress={() => onEventPress(ev)}
                    accessibilityLabel={uiCopy.calendar.dayTimelineOverflowRowA11y(
                      formatMinutesAsHm(ev.startMin),
                      formatMinutesAsHm(ev.endMin),
                      ev.title,
                    )}
                  >
                    <View style={[styles.hiddenListSwatch, { backgroundColor: ev.color }]} />
                    <View style={styles.hiddenListTextCol}>
                      <Text style={styles.hiddenListTime} numberOfLines={1}>
                        {formatMinutesAsHm(ev.startMin)}–{formatMinutesAsHm(ev.endMin)}
                      </Text>
                      <Text style={styles.hiddenListTitle} numberOfLines={2}>
                        {ev.title}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            ) : null}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    backgroundColor: colors.surface,
    padding: spacing.sm,
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
  title: {
    ...typography.label,
    fontSize: 13,
    color: colors.textPrimary,
    flex: 1,
    textAlign: 'center',
  },
  bodyRow: { flexDirection: 'row', alignItems: 'stretch' },
  hourLabel: {
    fontSize: 10,
    color: colors.textSecondary,
  },
  gridViewport: {
    flex: 1,
    minWidth: 0,
  },
  gridArea: {
    position: 'relative',
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
  },
  gridHourLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  block: {
    position: 'absolute',
    borderRadius: 6,
    padding: 4,
    overflow: 'hidden',
  },
  blockTime: { fontSize: 9, color: '#fff', fontWeight: '700' },
  blockTitle: { fontSize: 10, color: '#fff', fontWeight: '600' },
  blockCapCue: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 20,
    backgroundColor: 'rgba(0,0,0,0.22)',
    borderBottomLeftRadius: 5,
    borderBottomRightRadius: 5,
  },
  hiddenOverflowSection: {
    marginTop: spacing.sm,
    paddingTop: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  hiddenOverflowToggle: {
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  hiddenOverflowToggleText: {
    ...typography.label,
    fontSize: 11,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  hiddenListScroll: {
    maxHeight: 220,
    marginTop: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    backgroundColor: colors.surface,
  },
  hiddenListRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  hiddenListSwatch: {
    width: 10,
    height: 10,
    borderRadius: 3,
    marginTop: 3,
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.12)',
  },
  hiddenListTextCol: { flex: 1, minWidth: 0 },
  hiddenListTime: {
    ...typography.label,
    fontSize: 10,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  hiddenListTitle: {
    ...typography.body,
    fontSize: 12,
    color: colors.textPrimary,
    fontWeight: '600',
  },
});
