jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import {
  getActivelyRepresentedModelIdsForAgency,
  filterBookingEventsForAgencyActiveRepresentation,
} from '../modelRepresentationGuards';
import type { BookingEvent } from '../bookingEventsSupabase';

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
});
