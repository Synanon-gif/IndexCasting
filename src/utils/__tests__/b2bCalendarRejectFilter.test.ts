import { filterOutRejectedOptionCalendarRows } from '../b2bCalendarRejectFilter';

describe('filterOutRejectedOptionCalendarRows (unified B2B calendar)', () => {
  it('drops rejected option rows (no ghost tile when calendar mirrors are cancelled)', () => {
    const rows = [
      { option: { id: 'r1', status: 'rejected' as const }, calendar_entry: null },
      { option: { id: 'a1', status: 'in_negotiation' as const }, calendar_entry: null },
    ];
    const out = filterOutRejectedOptionCalendarRows(rows);
    expect(out).toHaveLength(1);
    expect(out[0].option.id).toBe('a1');
  });

  it('keeps confirmed and in_negotiation rows', () => {
    const rows = [
      { option: { id: 'n1', status: 'in_negotiation' as const } },
      { option: { id: 'c1', status: 'confirmed' as const } },
    ];
    expect(filterOutRejectedOptionCalendarRows(rows)).toHaveLength(2);
  });
});
