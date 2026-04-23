import { CALENDAR_COLORS, CALENDAR_PROJECTION_COLORS } from '../calendarColors';
import type { CalendarScheduleBlock } from '../calendarUnifiedTimeline';
import {
  cappedBlockLayout,
  formatWeekKindFooterShort,
  monthDayKindSegments,
  monthEventKindBucket,
  sortCalendarDayEventsForOverview,
  startMinToDayTimeBand,
  weekColumnKindSegments,
} from '../calendarOverviewLayout';

describe('calendarOverviewLayout', () => {
  it('monthEventKindBucket normalizes kinds', () => {
    expect(monthEventKindBucket('job')).toBe('job');
    expect(monthEventKindBucket('casting')).toBe('casting');
    expect(monthEventKindBucket('option')).toBe('option');
    expect(monthEventKindBucket('booking')).toBe('job');
    expect(monthEventKindBucket('other')).toBe('other');
    expect(monthEventKindBucket('manual')).toBe('manual');
    expect(monthEventKindBucket(undefined)).toBe('other');
  });

  it('sortCalendarDayEventsForOverview orders by bucket then title', () => {
    const sorted = sortCalendarDayEventsForOverview([
      { id: '1', title: 'B', kind: 'option', color: CALENDAR_COLORS.option },
      { id: '2', title: 'A', kind: 'job', color: CALENDAR_COLORS.job },
      { id: '3', title: 'C', kind: 'casting', color: CALENDAR_COLORS.casting },
    ]);
    expect(sorted.map((e) => e.id)).toEqual(['2', '3', '1']);
  });

  it('monthDayKindSegments aggregates by rendered event color (hex), same as weekColumnKindSegments', () => {
    const segs = monthDayKindSegments([
      { id: '1', title: 'x', kind: 'option', color: CALENDAR_COLORS.option },
      { id: '2', title: 'y', kind: 'option', color: CALENDAR_COLORS.option },
      { id: '3', title: 'z', kind: 'job', color: CALENDAR_COLORS.job },
    ]);
    expect(segs.map((s) => [s.bucket, s.count, s.color])).toEqual([
      ['job', 1, CALENDAR_COLORS.job],
      ['option', 2, CALENDAR_COLORS.option],
    ]);
  });

  it('monthDayKindSegments keeps projection purple, not reject grey, for awaiting-model', () => {
    const segs = monthDayKindSegments([
      {
        id: '1',
        title: 'a',
        kind: 'other',
        color: CALENDAR_PROJECTION_COLORS.awaitingModel,
      },
    ]);
    expect(segs).toHaveLength(1);
    expect(segs[0].color).toBe(CALENDAR_PROJECTION_COLORS.awaitingModel);
  });

  it('weekColumnKindSegments uses rendered block colors (e.g. awaiting model = purple, not grey “other”)', () => {
    const blocks: CalendarScheduleBlock[] = [
      {
        id: '1',
        date: '2026-04-15',
        startMin: 480,
        endMin: 600,
        title: 'A',
        color: CALENDAR_PROJECTION_COLORS.awaitingModel,
      },
    ];
    const segs = weekColumnKindSegments(blocks);
    expect(segs).toHaveLength(1);
    expect(segs[0].color).toBe(CALENDAR_PROJECTION_COLORS.awaitingModel);
    expect(segs[0].count).toBe(1);
  });

  it('formatWeekKindFooterShort builds compact legend', () => {
    expect(
      formatWeekKindFooterShort([
        { bucket: 'job', count: 2, color: '#000' },
        { bucket: 'option', count: 5, color: '#111' },
      ]),
    ).toBe('J2 O5');
  });

  it('startMinToDayTimeBand buckets by clock', () => {
    expect(startMinToDayTimeBand(5 * 60)).toBe('early');
    expect(startMinToDayTimeBand(9 * 60)).toBe('morning');
    expect(startMinToDayTimeBand(14 * 60)).toBe('afternoon');
    expect(startMinToDayTimeBand(20 * 60)).toBe('evening');
  });

  it('cappedBlockLayout caps long blocks only when threshold exceeded', () => {
    const pxPerMin = 44 / 60;
    const uncapped = cappedBlockLayout(540, 600, pxPerMin, 22, 88, 120);
    expect(uncapped.isCapped).toBe(false);
    const atThreshold = cappedBlockLayout(540, 660, pxPerMin, 22, 88, 120);
    expect(atThreshold.isCapped).toBe(false);
    const longDur = cappedBlockLayout(540, 540 + 240, pxPerMin, 22, 88, 120);
    expect(longDur.isCapped).toBe(true);
    expect(longDur.heightPx).toBe(88);
  });
});
