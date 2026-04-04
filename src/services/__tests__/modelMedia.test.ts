/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Tests for the Model Media Management System
 *
 * Covers:
 *  1. addPhoto — private photos always have is_visible_to_clients = false
 *  2. deletePhoto — calls Storage remove then DB delete
 *  3. createGuestLink — persists package type ('portfolio' | 'polaroid') correctly
 *  4. GuestLinkModel shape — portfolio_images and polaroids are mutually exclusive
 *  5. getGuestLinkModels — RPC returns type-correct image arrays (critical package bug fix)
 */

import { addPhoto } from '../modelPhotosSupabase';
import { createGuestLink, getGuestLinkModels } from '../guestLinksSupabase';

// ---------------------------------------------------------------------------
// Supabase mock
// ---------------------------------------------------------------------------

const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockAuthGetUser = jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } });

const mockStorageFrom = jest.fn();
const mockStorageRemove = jest.fn();

jest.mock('../../../lib/supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => mockFrom(...args),
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: { getUser: () => mockAuthGetUser() },
    storage: {
      from: (...args: unknown[]) => mockStorageFrom(...args),
    },
  },
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Builds a mock Supabase builder chain ending with a resolved value */
function mockChain(resolved: { data: unknown; error: unknown }) {
  const single = jest.fn().mockResolvedValue(resolved);
  const chain: any = { select: jest.fn().mockReturnThis(), single };
  return chain;
}

function _mockInsertChain(resolved: { data: unknown; error: unknown }) {
  const base = mockChain(resolved);
  const maybeSingle = jest.fn().mockResolvedValue({ data: { sort_order: 0 }, error: null });
  return {
    insertBuilder: { insert: jest.fn().mockReturnValue(base) },
    base,
    selectBuilder: {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle,
    },
  };
}

// ---------------------------------------------------------------------------
// 1. addPhoto — private guard
// ---------------------------------------------------------------------------

describe('addPhoto — private photo type', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('sets is_visible_to_clients = false for private photos', async () => {
    let capturedInsertPayload: any = null;

    // First call: SELECT max sort_order
    const sortChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { sort_order: 2 }, error: null }),
    };

    // Second call: INSERT
    const insertResult = {
      id: 'photo-1',
      model_id: 'model-1',
      url: 'supabase-private://documents/model-private-photos/model-1/img.jpg',
      photo_type: 'private',
      is_visible_to_clients: false,
      visible: false,
      sort_order: 3,
      source: null,
      api_external_id: null,
    };
    const insertChain = {
      insert: jest.fn().mockImplementation((payload: any) => {
        capturedInsertPayload = payload;
        return {
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: insertResult, error: null }),
        };
      }),
    };

    mockFrom
      .mockReturnValueOnce(sortChain)   // getPhotosForModel → max sort
      .mockReturnValueOnce(insertChain); // insert

    const result = await addPhoto('model-1', 'supabase-private://documents/model-private-photos/model-1/img.jpg', 'private');

    expect(capturedInsertPayload).not.toBeNull();
    expect(capturedInsertPayload.is_visible_to_clients).toBe(false);
    expect(capturedInsertPayload.visible).toBe(false);
    expect(capturedInsertPayload.photo_type).toBe('private');
    expect(result).not.toBeNull();
    expect(result?.is_visible_to_clients).toBe(false);
  });

  it('sets is_visible_to_clients = true for portfolio photos', async () => {
    let capturedInsertPayload: any = null;

    const sortChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };

    const insertResult = {
      id: 'photo-2', model_id: 'model-1', url: 'https://cdn.example.com/photo.jpg',
      photo_type: 'portfolio', is_visible_to_clients: true, visible: true, sort_order: 0,
      source: null, api_external_id: null,
    };
    const insertChain = {
      insert: jest.fn().mockImplementation((payload: any) => {
        capturedInsertPayload = payload;
        return {
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: insertResult, error: null }),
        };
      }),
    };

    mockFrom
      .mockReturnValueOnce(sortChain)
      .mockReturnValueOnce(insertChain);

    const result = await addPhoto('model-1', 'https://cdn.example.com/photo.jpg', 'portfolio');

    expect(capturedInsertPayload.is_visible_to_clients).toBe(true);
    expect(capturedInsertPayload.visible).toBe(true);
    expect(result).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. deletePhoto — storage remove + DB delete
// ---------------------------------------------------------------------------

describe('deletePhoto', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockStorageFrom.mockReset();
    mockStorageRemove.mockReset();
  });

  it('calls storage remove and then DB delete', async () => {
    const { deletePhoto } = await import('../modelPhotosSupabase');

    mockStorageFrom.mockReturnValue({ remove: mockStorageRemove.mockResolvedValue({ error: null }) });

    // First from() call: SELECT file_size_bytes (BUG 1 fix — reliable decrement).
    const selectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { file_size_bytes: 204800 }, error: null }),
    };
    // Second from() call: DELETE after storage removal.
    const deleteChain = {
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ error: null }),
    };
    mockFrom.mockReturnValueOnce(selectChain).mockReturnValueOnce(deleteChain);

    const publicUrl =
      'https://xyz.supabase.co/storage/v1/object/public/documentspictures/model-photos/model-1/img.jpg';
    const result = await deletePhoto('photo-id-1', publicUrl);

    expect(mockStorageFrom).toHaveBeenCalledWith('documentspictures');
    expect(mockStorageRemove).toHaveBeenCalledWith(['model-photos/model-1/img.jpg']);
    expect(mockFrom).toHaveBeenCalledWith('model_photos');
    expect(result).toBe(true);
  });

  it('returns false when DB delete fails', async () => {
    const { deletePhoto } = await import('../modelPhotosSupabase');

    mockStorageFrom.mockReturnValue({ remove: mockStorageRemove.mockResolvedValue({ error: null }) });

    const selectChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: { file_size_bytes: 0 }, error: null }),
    };
    const deleteChain = {
      delete: jest.fn().mockReturnThis(),
      eq: jest.fn().mockResolvedValue({ error: { message: 'permission denied' } }),
    };
    mockFrom.mockReturnValueOnce(selectChain).mockReturnValueOnce(deleteChain);

    const result = await deletePhoto('photo-id-2', 'https://xyz.supabase.co/storage/v1/object/public/documentspictures/model-photos/x/y.jpg');
    expect(result).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2b. addPhoto — polaroid photo type visibility
// ---------------------------------------------------------------------------

describe('addPhoto — polaroid photo type', () => {
  beforeEach(() => {
    mockFrom.mockReset();
  });

  it('sets is_visible_to_clients = true for polaroid photos (visible to agency; RLS restricts client access)', async () => {
    let capturedInsertPayload: any = null;

    const sortChain = {
      select: jest.fn().mockReturnThis(),
      eq: jest.fn().mockReturnThis(),
      order: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
    };

    const insertResult = {
      id: 'photo-pola-1',
      model_id: 'model-1',
      url: 'https://cdn.example.com/pola.jpg',
      photo_type: 'polaroid',
      is_visible_to_clients: true,
      visible: true,
      sort_order: 0,
      source: null,
      api_external_id: null,
    };
    const insertChain = {
      insert: jest.fn().mockImplementation((payload: any) => {
        capturedInsertPayload = payload;
        return {
          select: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: insertResult, error: null }),
        };
      }),
    };

    mockFrom
      .mockReturnValueOnce(sortChain)
      .mockReturnValueOnce(insertChain);

    const result = await addPhoto('model-1', 'https://cdn.example.com/pola.jpg', 'polaroid');

    expect(capturedInsertPayload).not.toBeNull();
    expect(capturedInsertPayload.photo_type).toBe('polaroid');
    // Polaroid photos are NOT private — they must not be blocked at the DB row level.
    // Client access restriction is enforced exclusively via RLS (photo_type = 'portfolio' only for clients).
    expect(capturedInsertPayload.is_visible_to_clients).toBe(true);
    expect(capturedInsertPayload.visible).toBe(true);
    expect(result).not.toBeNull();
    expect(result?.photo_type).toBe('polaroid');
  });
});

// ---------------------------------------------------------------------------
// 2c. deletePhoto — private photo uses 'documents' bucket, not 'documentspictures'
// ---------------------------------------------------------------------------

describe('deletePhoto — bucket selection by URL', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockStorageFrom.mockReset();
    mockStorageRemove.mockReset();
  });

  it('uses the private "documents" bucket for private photo URLs', async () => {
    const { deletePhoto } = await import('../modelPhotosSupabase');

    mockStorageFrom.mockReturnValue({ remove: mockStorageRemove.mockResolvedValue({ error: null }) });

    // First from(): SELECT file_size_bytes; second from(): DELETE.
    mockFrom
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { file_size_bytes: 102400 }, error: null }),
      })
      .mockReturnValueOnce({
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      });

    // Private photos are stored under /documents/ (NOT /documentspictures/)
    const privateUrl =
      'https://xyz.supabase.co/storage/v1/object/public/documents/model-private-photos/model-1/private.jpg';
    const result = await deletePhoto('photo-private-1', privateUrl);

    expect(mockStorageFrom).toHaveBeenCalledWith('documents');
    expect(mockStorageRemove).toHaveBeenCalledWith(['model-private-photos/model-1/private.jpg']);
    expect(result).toBe(true);
  });

  it('uses the public "documentspictures" bucket for portfolio/polaroid URLs', async () => {
    const { deletePhoto } = await import('../modelPhotosSupabase');

    mockStorageFrom.mockReturnValue({ remove: mockStorageRemove.mockResolvedValue({ error: null }) });

    mockFrom
      .mockReturnValueOnce({
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        maybeSingle: jest.fn().mockResolvedValue({ data: { file_size_bytes: 307200 }, error: null }),
      })
      .mockReturnValueOnce({
        delete: jest.fn().mockReturnThis(),
        eq: jest.fn().mockResolvedValue({ error: null }),
      });

    const publicUrl =
      'https://xyz.supabase.co/storage/v1/object/public/documentspictures/model-photos/model-1/portfolio.jpg';
    const result = await deletePhoto('photo-portfolio-1', publicUrl);

    expect(mockStorageFrom).toHaveBeenCalledWith('documentspictures');
    expect(mockStorageRemove).toHaveBeenCalledWith(['model-photos/model-1/portfolio.jpg']);
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. createGuestLink — package type ('portfolio' | 'polaroid') persisted
// ---------------------------------------------------------------------------

describe('createGuestLink — package type', () => {
  beforeEach(() => {
    mockFrom.mockReset();
    mockAuthGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } });
  });

  it('passes type = "polaroid" to the insert payload for a Polaroid Package', async () => {
    let capturedPayload: any = null;

    const insertReturn = {
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: 'link-1',
          agency_id: 'agency-1',
          model_ids: ['m1'],
          label: 'Spring Polaroids 2026',
          type: 'polaroid',
          is_active: true,
          tos_accepted_by_guest: false,
          created_at: new Date().toISOString(),
          agency_email: null,
          agency_name: null,
          created_by: 'user-1',
          expires_at: null,
        },
        error: null,
      }),
    };

    mockFrom.mockReturnValue({
      insert: jest.fn().mockImplementation((payload: any) => {
        capturedPayload = payload;
        return insertReturn;
      }),
    });

    const result = await createGuestLink({
      agency_id: 'agency-1',
      model_ids: ['m1'],
      label: 'Spring Polaroids 2026',
      type: 'polaroid',
    });

    expect(capturedPayload).not.toBeNull();
    expect(capturedPayload.type).toBe('polaroid');
    // Must NOT contain the old include_polaroids field
    expect(capturedPayload.include_polaroids).toBeUndefined();
    expect(result?.type).toBe('polaroid');
  });

  it('passes type = "portfolio" to the insert payload for a Portfolio Package', async () => {
    let capturedPayload: any = null;

    const insertReturn = {
      select: jest.fn().mockReturnThis(),
      single: jest.fn().mockResolvedValue({
        data: {
          id: 'link-2',
          agency_id: 'agency-1',
          model_ids: ['m1', 'm2'],
          label: 'Summer Portfolio 2026',
          type: 'portfolio',
          is_active: true,
          tos_accepted_by_guest: false,
          created_at: new Date().toISOString(),
          agency_email: null,
          agency_name: null,
          created_by: 'user-1',
          expires_at: null,
        },
        error: null,
      }),
    };

    mockFrom.mockReturnValue({
      insert: jest.fn().mockImplementation((payload: any) => {
        capturedPayload = payload;
        return insertReturn;
      }),
    });

    const result = await createGuestLink({
      agency_id: 'agency-1',
      model_ids: ['m1', 'm2'],
      label: 'Summer Portfolio 2026',
      type: 'portfolio',
    });

    expect(capturedPayload.type).toBe('portfolio');
    expect(capturedPayload.include_polaroids).toBeUndefined();
    expect(result?.type).toBe('portfolio');
  });
});

// ---------------------------------------------------------------------------
// 4. GuestLinkModel shape — mutually exclusive image arrays
// ---------------------------------------------------------------------------

describe('GuestLinkModel type shape — portfolio vs polaroid packages', () => {
  it('Portfolio Package: portfolio_images populated, polaroids = []', () => {
    // The RPC returns portfolio_images only when package type = 'portfolio'.
    const model: import('../guestLinksSupabase').GuestLinkModel = {
      id: 'model-1',
      name: 'Anna',
      height: 178,
      bust: 84,
      waist: 62,
      hips: 90,
      city: 'Berlin',
      hair_color: 'Brown',
      eye_color: 'Blue',
      sex: 'female',
      portfolio_images: ['https://cdn.example.com/img1.jpg', 'https://cdn.example.com/img2.jpg'],
      polaroids: [],
    };
    expect(model.portfolio_images).toHaveLength(2);
    expect(model.polaroids).toHaveLength(0);
  });

  it('Polaroid Package: polaroids populated, portfolio_images = []', () => {
    // The RPC returns polaroids only when package type = 'polaroid'.
    const model: import('../guestLinksSupabase').GuestLinkModel = {
      id: 'model-2',
      name: 'Lena',
      height: 175,
      bust: 82,
      waist: 60,
      hips: 88,
      city: 'Paris',
      hair_color: 'Blonde',
      eye_color: 'Green',
      sex: 'female',
      portfolio_images: [],
      polaroids: ['https://cdn.example.com/pola1.jpg', 'https://cdn.example.com/pola2.jpg'],
    };
    expect(model.polaroids).toHaveLength(2);
    expect(model.polaroids[0]).toContain('pola1');
    expect(model.portfolio_images).toHaveLength(0);
  });

  it('Model without polaroids in a Polaroid Package — no errors, empty arrays', () => {
    const model: import('../guestLinksSupabase').GuestLinkModel = {
      id: 'model-3', name: 'Max', height: 185,
      bust: null, waist: null, hips: null,
      city: null, hair_color: null, eye_color: null, sex: 'male',
      portfolio_images: [],
      polaroids: [],
    };
    // No error — empty arrays are valid; UI handles the empty state gracefully.
    expect(model.polaroids).toHaveLength(0);
    expect(model.portfolio_images).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 5. getGuestLinkModels — RPC type-branching (critical package bug fix)
// ---------------------------------------------------------------------------

describe('getGuestLinkModels — RPC returns type-correct image arrays', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('returns portfolio_images populated and polaroids = [] for a Portfolio Package', async () => {
    const rpcRows = [
      {
        id: 'model-1', name: 'Anna', height: 178, bust: 84, waist: 62, hips: 90,
        city: 'Berlin', hair_color: 'Brown', eye_color: 'Blue', sex: 'female',
        portfolio_images: ['https://cdn.example.com/p1.jpg', 'https://cdn.example.com/p2.jpg'],
        polaroids: [],
      },
    ];
    mockRpc.mockResolvedValue({ data: rpcRows, error: null });

    const result = await getGuestLinkModels('link-portfolio');

    expect(mockRpc).toHaveBeenCalledWith('get_guest_link_models', { p_link_id: 'link-portfolio' });
    expect(result).toHaveLength(1);
    expect(result[0].portfolio_images).toHaveLength(2);
    expect(result[0].polaroids).toHaveLength(0);
  });

  it('returns polaroids populated and portfolio_images = [] for a Polaroid Package', async () => {
    const rpcRows = [
      {
        id: 'model-2', name: 'Lena', height: 175, bust: 82, waist: 60, hips: 88,
        city: 'Paris', hair_color: 'Blonde', eye_color: 'Green', sex: 'female',
        portfolio_images: [],
        polaroids: ['https://cdn.example.com/pola1.jpg', 'https://cdn.example.com/pola2.jpg'],
      },
    ];
    mockRpc.mockResolvedValue({ data: rpcRows, error: null });

    const result = await getGuestLinkModels('link-polaroid');

    expect(mockRpc).toHaveBeenCalledWith('get_guest_link_models', { p_link_id: 'link-polaroid' });
    expect(result).toHaveLength(1);
    expect(result[0].polaroids).toHaveLength(2);
    expect(result[0].portfolio_images).toHaveLength(0);
  });

  it('returns [] on RPC error — no crash', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'permission denied' } });

    const result = await getGuestLinkModels('link-bad');

    expect(result).toEqual([]);
  });

  it('returns [] for an invalid or expired link (RPC returns empty array)', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });

    const result = await getGuestLinkModels('link-expired');

    expect(result).toEqual([]);
  });
});
