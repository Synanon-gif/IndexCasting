import {
  cappedBlockLayout,
  formatWeekKindFooterShort,
  monthDayKindSegments,
  monthEventKindBucket,
  sortCalendarDayEventsForOverview,
} from '../calendarOverviewLayout';

describe('calendarOverviewLayout', () => {
  it('monthEventKindBucket normalizes kinds', () => {
    expect(monthEventKindBucket('job')).toBe('job');
    expect(monthEventKindBucket('casting')).toBe('casting');
    expect(monthEventKindBucket('option')).toBe('option');
    expect(monthEventKindBucket('manual')).toBe('manual');
    expect(monthEventKindBucket(undefined)).toBe('other');
  });

  it('sortCalendarDayEventsForOverview orders by bucket then title', () => {
    const sorted = sortCalendarDayEventsForOverview([
      { id: '1', title: 'B', kind: 'option' },
      { id: '2', title: 'A', kind: 'job' },
      { id: '3', title: 'C', kind: 'casting' },
    ]);
    expect(sorted.map((e) => e.id)).toEqual(['2', '3', '1']);
  });

  it('monthDayKindSegments aggregates counts', () => {
    const segs = monthDayKindSegments([
      { id: '1', title: 'x', kind: 'option' },
      { id: '2', title: 'y', kind: 'option' },
      { id: '3', title: 'z', kind: 'job' },
    ]);
    expect(segs.map((s) => [s.bucket, s.count])).toEqual([
      ['job', 1],
      ['option', 2],
    ]);
  });

  it('formatWeekKindFooterShort builds compact legend', () => {
    expect(
      formatWeekKindFooterShort([
        { bucket: 'job', count: 2, color: '#000' },
        { bucket: 'option', count: 5, color: '#111' },
      ]),
    ).toBe('J2 O5');
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
