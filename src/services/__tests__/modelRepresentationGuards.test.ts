jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import {
  getActivelyRepresentedModelIdsForAgency,
  filterBookingEventsForAgencyActiveRepresentation,
  filterManualCalendarEventsForAgencyActiveRepresentation,
} from '../modelRepresentationGuards';
import type { BookingEvent } from '../bookingEventsSupabase';
import type { UserCalendarEvent } from '../userCalendarEventsSupabase';

const from = supabase.from as jest.Mock;

function mockModelsSelect(rows: { id: string }[]) {
  return {
    select: jest.fn().mockReturnValue({
      in: jest.fn().mockReturnValue({
        or: jest.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    }),
  };
}

function mockMatSelect(rows: { model_id: string }[]) {
  return {
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        in: jest.fn().mockResolvedValue({ data: rows, error: null }),
      }),
    }),
  };
}

describe('modelRepresentationGuards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('getActivelyRepresentedModelIdsForAgency intersects status-ok models with MAT (multi-agency safe)', async () => {
    const aid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const m1 = '11111111-1111-1111-1111-111111111111';
    const m2 = '22222222-2222-2222-2222-222222222222';
    from.mockImplementation((table: string) => {
      if (table === 'models') return mockModelsSelect([{ id: m1 }, { id: m2 }]);
      if (table === 'model_agency_territories') return mockMatSelect([{ model_id: m1 }]);
      throw new Error(`unexpected table ${table}`);
    });
    const set = await getActivelyRepresentedModelIdsForAgency(aid, [m1, m2]);
    expect([...set].sort()).toEqual([m1]);
  });

  it('filterBookingEventsForAgencyActiveRepresentation drops events for inactive models', async () => {
    const aid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const mKeep = '11111111-1111-1111-1111-111111111111';
    const mDrop = '22222222-2222-2222-2222-222222222222';
    const events = [{ model_id: mKeep } as BookingEvent, { model_id: mDrop } as BookingEvent];
    from.mockImplementation((table: string) => {
      if (table === 'models') return mockModelsSelect([{ id: mKeep }, { id: mDrop }]);
      if (table === 'model_agency_territories') return mockMatSelect([{ model_id: mKeep }]);
      throw new Error(`unexpected table ${table}`);
    });
    const out = await filterBookingEventsForAgencyActiveRepresentation(events, aid);
    expect(out).toHaveLength(1);
    expect(out[0].model_id).toBe(mKeep);
  });

  it('filterManualCalendarEventsForAgencyActiveRepresentation keeps pure manual, drops mirror for inactive model', async () => {
    const aid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const mKeep = '11111111-1111-1111-1111-111111111111';
    const mDrop = '22222222-2222-2222-2222-222222222222';
    const optKeep = '33333333-3333-3333-3333-333333333333';
    const optDrop = '44444444-4444-4444-4444-444444444444';
    const events: UserCalendarEvent[] = [
      {
        id: 'uce-pure',
        owner_id: aid,
        owner_type: 'agency',
        date: '2026-01-01',
        start_time: null,
        end_time: null,
        title: 'Manual',
        color: '#000',
        note: null,
        organization_id: null,
        created_by: null,
        source_option_request_id: null,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'uce-mirror-bad',
        owner_id: aid,
        owner_type: 'agency',
        date: '2026-01-02',
        start_time: null,
        end_time: null,
        title: 'Mirror ended',
        color: '#000',
        note: null,
        organization_id: null,
        created_by: null,
        source_option_request_id: optDrop,
        created_at: '',
        updated_at: '',
      },
      {
        id: 'uce-mirror-ok',
        owner_id: aid,
        owner_type: 'agency',
        date: '2026-01-03',
        start_time: null,
        end_time: null,
        title: 'Mirror active',
        color: '#000',
        note: null,
        organization_id: null,
        created_by: null,
        source_option_request_id: optKeep,
        created_at: '',
        updated_at: '',
      },
    ];
    from.mockImplementation((table: string) => {
      if (table === 'option_requests') {
        return {
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              in: jest.fn().mockResolvedValue({
                data: [
                  { id: optKeep, model_id: mKeep },
                  { id: optDrop, model_id: mDrop },
                ],
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'models') return mockModelsSelect([{ id: mKeep }, { id: mDrop }]);
      if (table === 'model_agency_territories') return mockMatSelect([{ model_id: mKeep }]);
      throw new Error(`unexpected table ${table}`);
    });
    const out = await filterManualCalendarEventsForAgencyActiveRepresentation(events, aid);
    expect(out).toHaveLength(2);
    expect(out.map((e) => e.id).sort()).toEqual(['uce-mirror-ok', 'uce-pure']);
  });
});
