import React, { useMemo } from 'react';
import { View, useWindowDimensions } from 'react-native';
import { MonthCalendarView, type CalendarDayEvent } from './MonthCalendarView';
import { CalendarViewModeBar, type CalendarViewMode } from './CalendarViewModeBar';
import { CalendarWeekGrid } from './CalendarWeekGrid';
import { CalendarDayTimeline } from './CalendarDayTimeline';
import { UnifiedCalendarAgenda } from './UnifiedCalendarAgenda';
import { uiCopy } from '../constants/uiCopy';
import { isMobileWidth } from '../theme/breakpoints';
import type { UnifiedAgencyCalendarRow } from '../utils/agencyCalendarUnified';
import { dedupeUnifiedRowsByOptionRequest } from '../utils/agencyCalendarUnified';
import type { CalendarProjectionViewerRole } from '../utils/calendarProjectionLabel';
import type { ClientAssignmentFlag } from '../services/clientAssignmentsSupabase';
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
  /** Workflow labels on agency/client rows — same as parent calendar lists. */
  assignmentByClientOrgId?: Record<string, ClientAssignmentFlag>;
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
  assignmentByClientOrgId = {},
}) => {
  const { width: windowWidth } = useWindowDimensions();
  const layoutIsMobile = isMobileWidth(windowWidth);
  const today = useMemo(() => todayYmd(), []);
  const focusDate = selectedDate ?? today;

  const dedupedUnified = useMemo(
    () => dedupeUnifiedRowsByOptionRequest(filteredUnified),
    [filteredUnified],
  );

  const syncMonthToDate = (d: string) => {
    const [y, m] = d.split('-').map(Number);
    setCalendarMonth({ year: y, month: m - 1 });
  };

  const shiftFocus = (d: string) => {
    setSelectedDate(d);
    syncMonthToDate(d);
  };

  const timelineEvents = useMemo(
    () => buildTimelineEventsFromUnifiedRows(dedupedUnified, viewerRole, uiCopy.calendar.projectionBadge),
    [dedupedUnified, viewerRole],
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
    return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }, [focusDate]);

  const viewModeHint = useMemo(() => {
    if (viewMode === 'week') return uiCopy.calendar.viewModeHintWeek;
    if (viewMode === 'day') return uiCopy.calendar.viewModeHintDay;
    if (layoutIsMobile && viewMode === 'month') return uiCopy.calendar.viewModeHintMonthAgenda;
    return uiCopy.calendar.viewModeHintMonth;
  }, [viewMode, layoutIsMobile]);

  const showMobileMonthAgenda = layoutIsMobile && viewMode === 'month';

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

      {showMobileMonthAgenda ? (
        <UnifiedCalendarAgenda
          calendarMonth={calendarMonth}
          setCalendarMonth={setCalendarMonth}
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          rows={dedupedUnified}
          viewerRole={viewerRole}
          assignmentByClientOrgId={assignmentByClientOrgId}
          onOpenUnifiedRow={onOpenUnifiedRow}
        />
      ) : (
        <MonthCalendarView
          year={calendarMonth.year}
          month={calendarMonth.month}
          eventsByDate={eventsByDate}
          selectedDate={selectedDate}
          compact={viewMode !== 'month'}
          onSelectDay={(d) => {
            shiftFocus(d);
          }}
          onPrevMonth={() =>
            setCalendarMonth((m) => (m.month === 0 ? { year: m.year - 1, month: 11 } : { year: m.year, month: m.month - 1 }))
          }
          onNextMonth={() =>
            setCalendarMonth((m) => (m.month === 11 ? { year: m.year + 1, month: 0 } : { year: m.year, month: m.month + 1 }))
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

    </View>
  );
};
