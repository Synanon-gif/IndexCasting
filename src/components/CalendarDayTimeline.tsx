import React, { useMemo } from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { colors, spacing, typography } from '../theme/theme';
import type { CalendarScheduleBlock } from '../utils/calendarUnifiedTimeline';
import { assignOverlapLanes, formatMinutesAsHm } from '../utils/calendarTimelineLayout';

const HOUR_HEIGHT = 44;
const MIN_HOUR = 6;
const MAX_HOUR = 22;

export type CalendarDayTimelineProps = {
  dateLabel: string;
  events: CalendarScheduleBlock[];
  onEventPress: (ev: CalendarScheduleBlock) => void;
  onPrevDay: () => void;
  onNextDay: () => void;
};

export const CalendarDayTimeline: React.FC<CalendarDayTimelineProps> = ({
  dateLabel,
  events,
  onEventPress,
  onPrevDay,
  onNextDay,
}) => {
  const pxPerMin = HOUR_HEIGHT / 60;

  const { lanes, displayStartMin, totalHeight, startHour, endHour } = useMemo(() => {
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
    const lanes = assignOverlapLanes(events);
    const totalMin = Math.max(60, displayEnd - displayStart);
    const totalHeight = totalMin * pxPerMin;
    return {
      lanes,
      displayStartMin: displayStart,
      totalHeight,
      startHour: startHourInner,
      endHour: endHourInner,
    };
  }, [events, pxPerMin]);

  const hours = useMemo(() => {
    const h: number[] = [];
    for (let x = startHour; x < endHour; x++) h.push(x);
    return h;
  }, [startHour, endHour]);

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
      <ScrollView style={{ maxHeight: 520 }} showsVerticalScrollIndicator>
        <View style={styles.bodyRow}>
          <View style={{ width: 44 }}>
            {hours.map((h) => (
              <View key={h} style={{ height: HOUR_HEIGHT, justifyContent: 'flex-start' }}>
                <Text style={styles.hourLabel}>{String(h).padStart(2, '0')}:00</Text>
              </View>
            ))}
          </View>
          <View style={[styles.gridArea, { height: totalHeight }]}>
            {hours.map((h, i) => (
              <View
                key={`line-${h}`}
                style={[styles.gridHourLine, { top: i * HOUR_HEIGHT }]}
              />
            ))}
            {lanes.map((ev) => {
              const top = (ev.startMin - displayStartMin) * pxPerMin;
              const h = Math.max((ev.endMin - ev.startMin) * pxPerMin, 22);
              const w = 100 / ev.laneCount;
              const left = w * ev.lane;
              return (
                <TouchableOpacity
                  key={`${ev.id}-${ev.startMin}-${ev.lane}`}
                  onPress={() => onEventPress(ev)}
                  style={[
                    styles.block,
                    {
                      top,
                      height: h,
                      left: `${left}%`,
                      width: `${w}%`,
                      backgroundColor: ev.color,
                    },
                  ]}
                >
                  <Text style={styles.blockTime}>{formatMinutesAsHm(ev.startMin)}</Text>
                  <Text style={styles.blockTitle} numberOfLines={4}>
                    {ev.title}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
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
  title: { ...typography.label, fontSize: 13, color: colors.textPrimary, flex: 1, textAlign: 'center' },
  bodyRow: { flexDirection: 'row', alignItems: 'stretch' },
  hourLabel: {
    fontSize: 10,
    color: colors.textSecondary,
  },
  gridArea: {
    flex: 1,
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
});
