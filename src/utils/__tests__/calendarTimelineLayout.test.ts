import {
  addDaysYmd,
  assignOverlapLanes,
  parseTimeToMinutes,
  startOfWeekMonday,
  weekDayDates,
} from '../calendarTimelineLayout';

describe('calendarTimelineLayout', () => {
  it('parseTimeToMinutes handles HH:MM and HH:MM:SS', () => {
    expect(parseTimeToMinutes('09:00')).toBe(540);
    expect(parseTimeToMinutes('09:30:00')).toBe(570);
    expect(parseTimeToMinutes(null)).toBeNull();
  });

  it('startOfWeekMonday returns Monday for a Wednesday', () => {
    expect(startOfWeekMonday('2026-04-08')).toBe('2026-04-06');
  });

  it('weekDayDates returns 7 consecutive days', () => {
    const d = weekDayDates('2026-04-06');
    expect(d).toHaveLength(7);
    expect(d[0]).toBe('2026-04-06');
    expect(d[6]).toBe('2026-04-12');
  });

  it('addDaysYmd crosses month boundaries', () => {
    expect(addDaysYmd('2026-03-31', 1)).toBe('2026-04-01');
  });

  it('assignOverlapLanes stacks overlaps', () => {
    const lanes = assignOverlapLanes([
      { startMin: 0, endMin: 60 },
      { startMin: 10, endMin: 70 },
      { startMin: 20, endMin: 80 },
    ]);
    expect(lanes.map((l) => l.lane)).toEqual([0, 1, 2]);
    expect(lanes[0].laneCount).toBe(3);
  });
});
