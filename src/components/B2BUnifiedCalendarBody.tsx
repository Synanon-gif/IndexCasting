import React, { useMemo } from 'react';
import { View } from 'react-native';
import { MonthCalendarView, type CalendarDayEvent } from './MonthCalendarView';
import { CalendarViewModeBar, type CalendarViewMode } from './CalendarViewModeBar';
import { CalendarWeekGrid } from './CalendarWeekGrid';
import { CalendarDayTimeline } from './CalendarDayTimeline';
import { CalendarColorLegend } from './CalendarColorLegend';
import { uiCopy } from '../constants/uiCopy';
import type { UnifiedAgencyCalendarRow } from '../utils/agencyCalendarUnified';
import type { CalendarProjectionViewerRole } from '../utils/calendarProjectionLabel';
import {
  buildTimelineEventsFromUnifiedRows,
  filterTimelineEventsForDate,
  filterTimelineEventsForWeek,
  type CalendarTimelineEvent,
} from '../utils/calendarUnifiedTimeline';
import {
  addDaysYmd,
  startOfWeekMonday,
  todayYmd,
  weekDayDates,
} from '../utils/calendarTimelineLayout';

export type B2BUnifiedCalendarBodyProps = {
  viewerRole: CalendarProjectionViewerRole;
  viewMode: CalendarViewMode;
  onViewModeChange: (mode: CalendarViewMode) => void;
  calendarMonth: { year: number; month: number };
  setCalendarMonth: React.Dispatch<React.SetStateAction<{ year: number; month: number }>>;
  selectedDate: string | null;
  setSelectedDate: React.Dispatch<React.SetStateAction<string | null>>;
  eventsByDate: Record<string, CalendarDayEvent[]>;
  filteredUnified: UnifiedAgencyCalendarRow[];
  onOpenUnifiedRow: (row: UnifiedAgencyCalendarRow) => void;
};

export const B2BUnifiedCalendarBody: React.FC<B2BUnifiedCalendarBodyProps> = ({
  viewerRole,
  viewMode,
  onViewModeChange,
  calendarMonth,
  setCalendarMonth,
  selectedDate,
  setSelectedDate,
  eventsByDate,
  filteredUnified,
  onOpenUnifiedRow,
}) => {
  const today = useMemo(() => todayYmd(), []);
  const focusDate = selectedDate ?? today;

  const syncMonthToDate = (d: string) => {
    const [y, m] = d.split('-').map(Number);
    setCalendarMonth({ year: y, month: m - 1 });
  };

  const shiftFocus = (d: string) => {
    setSelectedDate(d);
    syncMonthToDate(d);
  };

  const timelineEvents = useMemo(
    () =>
      buildTimelineEventsFromUnifiedRows(
        filteredUnified,
        viewerRole,
        uiCopy.calendar.projectionBadge,
      ),
    [filteredUnified, viewerRole],
  );

  const weekStart = useMemo(() => startOfWeekMonday(focusDate), [focusDate]);
  const weekDates = useMemo(() => weekDayDates(weekStart), [weekStart]);

  const weekEvents = useMemo(
    () => filterTimelineEventsForWeek(timelineEvents, weekDates),
    [timelineEvents, weekDates],
  );

  const dayEvents = useMemo(
    () => filterTimelineEventsForDate(timelineEvents, focusDate),
    [timelineEvents, focusDate],
  );

  const rangeLabel = useMemo(() => {
    const a = new Date(`${weekDates[0]}T12:00:00`);
    const b = new Date(`${weekDates[6]}T12:00:00`);
    return `${a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${b.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }, [weekDates]);

  const dayDateLabel = useMemo(() => {
    const d = new Date(`${focusDate}T12:00:00`);
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
  }, [focusDate]);

  const viewModeHint = useMemo(() => {
    if (viewMode === 'week') return uiCopy.calendar.viewModeHintWeek;
    if (viewMode === 'day') return uiCopy.calendar.viewModeHintDay;
    return uiCopy.calendar.viewModeHintMonth;
  }, [viewMode]);

  const handleMonthDayClick = (d: string) => {
    shiftFocus(d);
    onViewModeChange('day');
  };

  return (
    <View>
      <CalendarViewModeBar
        mode={viewMode}
        onModeChange={onViewModeChange}
        monthLabel={uiCopy.dashboard.monthViewLabel}
        weekLabel={uiCopy.dashboard.weekViewLabel}
        dayLabel={uiCopy.calendar.dayViewLabel}
        compact={false}
        sectionTitle={uiCopy.calendar.viewModeHeading}
        sectionHint={viewModeHint}
      />

      {viewMode === 'month' && (
        <MonthCalendarView
          year={calendarMonth.year}
          month={calendarMonth.month}
          eventsByDate={eventsByDate}
          selectedDate={selectedDate}
          compact={false}
          onSelectDay={handleMonthDayClick}
          onPrevMonth={() =>
            setCalendarMonth((m) =>
              m.month === 0
                ? { year: m.year - 1, month: 11 }
                : { year: m.year, month: m.month - 1 },
            )
          }
          onNextMonth={() =>
            setCalendarMonth((m) =>
              m.month === 11
                ? { year: m.year + 1, month: 0 }
                : { year: m.year, month: m.month + 1 },
            )
          }
        />
      )}

      {viewMode === 'week' && (
        <CalendarWeekGrid
          weekDates={weekDates}
          events={weekEvents}
          selectedDate={selectedDate}
          onSelectDay={(d) => shiftFocus(d)}
          onEventPress={(ev) => onOpenUnifiedRow((ev as CalendarTimelineEvent).row)}
          onPrevWeek={() => shiftFocus(addDaysYmd(focusDate, -7))}
          onNextWeek={() => shiftFocus(addDaysYmd(focusDate, 7))}
          rangeLabel={rangeLabel}
        />
      )}

      {viewMode === 'day' && (
        <CalendarDayTimeline
          dateLabel={dayDateLabel}
          events={dayEvents}
          onEventPress={(ev) => onOpenUnifiedRow((ev as CalendarTimelineEvent).row)}
          onPrevDay={() => shiftFocus(addDaysYmd(focusDate, -1))}
          onNextDay={() => shiftFocus(addDaysYmd(focusDate, 1))}
        />
      )}

      <CalendarColorLegend />
    </View>
  );
};
