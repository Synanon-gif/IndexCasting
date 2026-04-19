/**
 * Bidirectional Mediaslide / Netwalk sync — guardrail tests for the three
 * highest-risk invariants introduced by the bidirectional sync feature:
 *
 *   1. Calendar conflict resolution: canonical local rows
 *      (`option_request_id IS NOT NULL`) MUST win over remote block-outs;
 *      remote rows whose `external_event_id` disappears from the payload
 *      MUST be cancelled (not deleted).
 *
 *   2. Outbox idempotency: a second confirm/cancel for the same
 *      (provider, calendar_entry, status) MUST reuse the same idempotency key
 *      so the DB-side unique-constraint deduplicates instead of creating two
 *      pending pushes.
 *
 *   3. Photo-source branch: when `models.photo_source = 'own'` (default),
 *      a Mediaslide / Netwalk pull MUST NOT overwrite `portfolio_images` /
 *      `polaroids` even if the remote payload carries them. Mirroring
 *      happens only when the agency explicitly opted into the external
 *      source-of-truth (see system-invariants §27.1 and the EXTERNE
 *      PROFIL-SYNCS rule).
 */

// ── Module mocks ─────────────────────────────────────────────────────────────

const fromMock = jest.fn();
const rpcMock = jest.fn().mockResolvedValue({ data: null, error: null });

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

const getModelByIdFromSupabaseMock = jest.fn();
jest.mock('../modelsSupabase', () => ({
  ...jest.requireActual<typeof import('../modelsSupabase')>('../modelsSupabase'),
  getModelByIdFromSupabase: (...args: unknown[]) => getModelByIdFromSupabaseMock(...args),
  agencyUpdateModelFullRpc: (...args: unknown[]) => rpcMock('agency_update_model_full', ...args),
}));

const getModelFromMediaslideMock = jest.fn();
const getCalendarFromMediaslideMock = jest.fn();
const pushAvailabilityToMediaslideMock = jest.fn();
jest.mock('../mediaslideConnector', () => ({
  getModelFromMediaslide: (...args: unknown[]) => getModelFromMediaslideMock(...args),
  getCalendarFromMediaslide: (...args: unknown[]) => getCalendarFromMediaslideMock(...args),
  pushAvailabilityToMediaslide: (...args: unknown[]) => pushAvailabilityToMediaslideMock(...args),
  syncModelData: jest.fn().mockResolvedValue({ synced: true }),
}));

const pushAvailabilityToNetwalkMock = jest.fn();
jest.mock('../netwalkConnector', () => ({
  pushAvailabilityToNetwalk: (...args: unknown[]) => pushAvailabilityToNetwalkMock(...args),
}));

jest.mock('../supabaseFetchAll', () => ({
  fetchAllSupabasePages: jest.fn().mockResolvedValue([]),
}));

jest.mock('../territoriesSupabase', () => ({
  upsertTerritoriesForModelCountryAgencyPairs: jest.fn().mockResolvedValue(undefined),
}));

const getAgencyApiKeysMock = jest.fn();
jest.mock('../agencySettingsSupabase', () => ({
  getAgencyApiKeys: (...args: unknown[]) => getAgencyApiKeysMock(...args),
}));

// ── Imports (after mocks) ────────────────────────────────────────────────────

import {
  syncCalendarFromMediaslide,
  syncSingleModelFromMediaslide,
} from '../mediaslideSyncService';
import { syncConfirmedBookingToExternalCalendars } from '../externalCalendarSync';
import type { CalendarEntry } from '../calendarSupabase';

// ── Helpers ──────────────────────────────────────────────────────────────────

const LOCAL_MODEL_ID = '11111111-1111-1111-1111-111111111111';
const MEDIASLIDE_ID = 'ms-model-001';
const AGENCY_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function makeCalendarEntry(overrides: Partial<CalendarEntry> = {}): CalendarEntry {
  return {
    id: 'cal-entry-1',
    model_id: LOCAL_MODEL_ID,
    date: '2026-05-10',
    start_time: '09:00:00',
    end_time: '17:00:00',
    title: 'Job: Brand X',
    entry_type: 'booking',
    status: 'booked',
    booking_id: 'b-1',
    note: null,
    created_at: '2026-04-01T10:00:00Z',
    option_request_id: 'or-1',
    client_name: 'Brand X',
    booking_details: null,
    ...overrides,
  } as CalendarEntry;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Calendar conflict resolution
// ─────────────────────────────────────────────────────────────────────────────

describe('syncCalendarFromMediaslide — conflict resolution', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: null, error: null });
    getCalendarFromMediaslideMock.mockReset();
  });

  it('skips remote block-outs that overlap a canonical local entry (same date, option_request_id NOT NULL)', async () => {
    getCalendarFromMediaslideMock.mockResolvedValue([
      {
        external_event_id: 'ms-evt-1',
        date: '2026-05-10', // same date as canonical row below
        start_time: null,
        end_time: null,
        status: 'unavailable',
        title: 'Mediaslide manual block',
        updated_at: '2026-04-01T10:00:00Z',
      },
    ]);

    const insertSpy = jest.fn().mockResolvedValue({ error: null });
    const updateSpy = jest.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });

    fromMock.mockImplementation((table: string) => {
      if (table === 'calendar_entries') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ data: [], error: null }),
              not: () => ({
                neq: () => Promise.resolve({ data: [{ date: '2026-05-10' }], error: null }),
              }),
            }),
          }),
          insert: insertSpy,
          update: updateSpy,
        };
      }
      if (table === 'mediaslide_sync_logs') {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    });

    const result = await syncCalendarFromMediaslide({
      localModelId: LOCAL_MODEL_ID,
      mediaslideId: MEDIASLIDE_ID,
    });

    expect(result.ok).toBe(true);
    // Canonical row owns this date → no remote insert/update for it.
    expect(insertSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    expect(result.upserted).toBe(0);
  });

  it('cancels existing external rows that vanish from remote (audit-trail safe — no delete)', async () => {
    getCalendarFromMediaslideMock.mockResolvedValue([]); // remote payload empty

    const updateSpy = jest.fn().mockReturnValue({ eq: () => Promise.resolve({ error: null }) });
    const insertSpy = jest.fn().mockResolvedValue({ error: null });

    fromMock.mockImplementation((table: string) => {
      if (table === 'calendar_entries') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => {
                return Promise.resolve({
                  data: [
                    {
                      id: 'cal-ext-1',
                      external_event_id: 'ms-evt-old',
                      external_updated_at: '2026-03-01T10:00:00Z',
                      status: 'unavailable',
                      date: '2026-05-15',
                    },
                  ],
                  error: null,
                });
              },
              not: () => ({
                neq: () => Promise.resolve({ data: [], error: null }),
              }),
            }),
          }),
          insert: insertSpy,
          update: updateSpy,
        };
      }
      if (table === 'mediaslide_sync_logs') {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      return { select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) };
    });

    const result = await syncCalendarFromMediaslide({
      localModelId: LOCAL_MODEL_ID,
      mediaslideId: MEDIASLIDE_ID,
    });

    expect(result.ok).toBe(true);
    expect(result.cancelled).toBe(1);
    expect(updateSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    expect(insertSpy).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Outbox idempotency (externalCalendarSync.syncConfirmedBookingToExternalCalendars)
// ─────────────────────────────────────────────────────────────────────────────

describe('syncConfirmedBookingToExternalCalendars — outbox idempotency', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: 'outbox-row-id', error: null });
    getAgencyApiKeysMock.mockReset();
    pushAvailabilityToMediaslideMock.mockReset();
    pushAvailabilityToNetwalkMock.mockReset();
  });

  it('uses the same idempotency key for repeated calls on the same calendar entry + status', async () => {
    getAgencyApiKeysMock.mockResolvedValue({
      mediaslide_connected: true,
      mediaslide_api_key: 'key-ms',
      netwalk_connected: false,
      netwalk_api_key: null,
    });
    pushAvailabilityToMediaslideMock.mockResolvedValue({ ok: true });

    const entry = makeCalendarEntry({ id: 'cal-x', status: 'booked' });

    await syncConfirmedBookingToExternalCalendars(entry, {
      agencyId: AGENCY_ID,
      modelMediaslideId: MEDIASLIDE_ID,
      modelNetwalkId: null,
    });

    await syncConfirmedBookingToExternalCalendars(entry, {
      agencyId: AGENCY_ID,
      modelMediaslideId: MEDIASLIDE_ID,
      modelNetwalkId: null,
    });

    const enqueueCalls = rpcMock.mock.calls.filter((c) => c[0] === 'enqueue_external_sync_outbox');
    expect(enqueueCalls.length).toBe(2);
    const idem1 = (enqueueCalls[0][1] as { p_idempotency_key: string }).p_idempotency_key;
    const idem2 = (enqueueCalls[1][1] as { p_idempotency_key: string }).p_idempotency_key;
    expect(idem1).toBe(idem2);
    expect(idem1).toContain('booking:cal-x:');
  });

  it('produces a different idempotency key when the same entry transitions to cancelled', async () => {
    getAgencyApiKeysMock.mockResolvedValue({
      mediaslide_connected: true,
      mediaslide_api_key: 'key-ms',
      netwalk_connected: false,
      netwalk_api_key: null,
    });
    pushAvailabilityToMediaslideMock.mockResolvedValue({ ok: true });

    const confirmed = makeCalendarEntry({ id: 'cal-y', status: 'booked' });
    const cancelled = makeCalendarEntry({ id: 'cal-y', status: 'cancelled' });

    await syncConfirmedBookingToExternalCalendars(confirmed, {
      agencyId: AGENCY_ID,
      modelMediaslideId: MEDIASLIDE_ID,
      modelNetwalkId: null,
    });
    await syncConfirmedBookingToExternalCalendars(cancelled, {
      agencyId: AGENCY_ID,
      modelMediaslideId: MEDIASLIDE_ID,
      modelNetwalkId: null,
    });

    const enqueueCalls = rpcMock.mock.calls.filter((c) => c[0] === 'enqueue_external_sync_outbox');
    expect(enqueueCalls.length).toBe(2);
    const idem1 = (enqueueCalls[0][1] as { p_idempotency_key: string }).p_idempotency_key;
    const idem2 = (enqueueCalls[1][1] as { p_idempotency_key: string }).p_idempotency_key;
    expect(idem1).not.toBe(idem2);
  });

  it('skips both providers when no agency API keys are configured', async () => {
    getAgencyApiKeysMock.mockResolvedValue(null);

    const result = await syncConfirmedBookingToExternalCalendars(makeCalendarEntry(), {
      agencyId: AGENCY_ID,
      modelMediaslideId: MEDIASLIDE_ID,
      modelNetwalkId: 'nw-1',
    });

    expect(result).toEqual({ mediaslide: 'skipped', netwalk: 'skipped' });
    expect(pushAvailabilityToMediaslideMock).not.toHaveBeenCalled();
    expect(pushAvailabilityToNetwalkMock).not.toHaveBeenCalled();
  });

  it('skips when the model has no remote sync IDs at all (own pictures, no calendar pairing)', async () => {
    const result = await syncConfirmedBookingToExternalCalendars(makeCalendarEntry(), {
      agencyId: AGENCY_ID,
      modelMediaslideId: null,
      modelNetwalkId: null,
    });

    expect(result).toEqual({ mediaslide: 'skipped', netwalk: 'skipped' });
    expect(getAgencyApiKeysMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Photo-source branching — pulls must NOT overwrite portfolio when 'own'
// ─────────────────────────────────────────────────────────────────────────────

describe('syncSingleModelFromMediaslide — photo_source branching', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ error: null });
    getModelByIdFromSupabaseMock.mockReset();
    getModelFromMediaslideMock.mockReset();
  });

  function setupPhotoSourceMock(photoSource: 'own' | 'mediaslide' | 'netwalk') {
    fromMock.mockImplementation((table: string) => {
      if (table === 'models') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: { photo_source: photoSource }, error: null }),
              limit: () => ({
                maybeSingle: () => Promise.resolve({ data: null, error: null }),
              }),
            }),
          }),
          update: () => ({ eq: () => Promise.resolve({ error: null }) }),
        };
      }
      if (table === 'model_agency_territories') {
        return {
          select: () => ({
            eq: () => ({
              limit: () => Promise.resolve({ data: [{ id: 'terr-1' }], error: null }),
            }),
          }),
        };
      }
      if (table === 'mediaslide_sync_logs') {
        return { insert: () => Promise.resolve({ error: null }) };
      }
      return { insert: () => Promise.resolve({ error: null }) };
    });
  }

  it("does NOT include portfolio_images / polaroids in the RPC payload when photo_source = 'own'", async () => {
    setupPhotoSourceMock('own');

    getModelByIdFromSupabaseMock.mockResolvedValue({
      id: LOCAL_MODEL_ID,
      name: 'Local',
      updated_at: '2024-01-01T00:00:00Z',
      portfolio_images: ['local-img.jpg'],
      polaroids: ['local-pol.jpg'],
    });
    getModelFromMediaslideMock.mockResolvedValue({
      id: MEDIASLIDE_ID,
      name: 'Remote Updated',
      updated_at: '2025-01-01T00:00:00Z',
      portfolio: {
        images: ['remote-img-1.jpg', 'remote-img-2.jpg'],
        polaroids: ['remote-pol-1.jpg'],
      },
    });

    const result = await syncSingleModelFromMediaslide({
      localModelId: LOCAL_MODEL_ID,
      mediaslideId: MEDIASLIDE_ID,
    });

    expect(result.ok).toBe(true);
    const updateCall = rpcMock.mock.calls.find((c) => c[0] === 'agency_update_model_full');
    expect(updateCall).toBeDefined();
    const payload = updateCall![1] as Record<string, unknown>;
    // The RPC is always called with these keys (positional contract), but they
    // must be null when photo_source is 'own' — the remote payload must NOT
    // bleed into local mirror columns.
    expect(payload.p_portfolio_images).toBeNull();
    expect(payload.p_polaroids).toBeNull();
  });

  it("includes portfolio_images / polaroids in the RPC payload when photo_source = 'mediaslide'", async () => {
    setupPhotoSourceMock('mediaslide');

    getModelByIdFromSupabaseMock.mockResolvedValue({
      id: LOCAL_MODEL_ID,
      name: 'Local',
      updated_at: '2024-01-01T00:00:00Z',
      portfolio_images: ['local-img.jpg'],
    });
    getModelFromMediaslideMock.mockResolvedValue({
      id: MEDIASLIDE_ID,
      name: 'Remote Updated',
      updated_at: '2025-01-01T00:00:00Z',
      portfolio: {
        images: ['remote-img-1.jpg', 'remote-img-2.jpg'],
        polaroids: ['remote-pol-1.jpg'],
      },
    });

    const result = await syncSingleModelFromMediaslide({
      localModelId: LOCAL_MODEL_ID,
      mediaslideId: MEDIASLIDE_ID,
    });

    expect(result.ok).toBe(true);
    const updateCall = rpcMock.mock.calls.find((c) => c[0] === 'agency_update_model_full');
    expect(updateCall).toBeDefined();
    const payload = updateCall![1] as Record<string, unknown>;
    expect(payload.p_portfolio_images).toEqual(['remote-img-1.jpg', 'remote-img-2.jpg']);
    expect(payload.p_polaroids).toEqual(['remote-pol-1.jpg']);
  });
});
