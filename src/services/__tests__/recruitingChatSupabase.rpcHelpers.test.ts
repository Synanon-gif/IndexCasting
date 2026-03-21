jest.mock('../../../lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
  },
}));

import { supabase } from '../../../lib/supabase';
import {
  isAgencyRecruitingChatRpcMissingError,
  formatRecruitingChatRpcError,
  formatRecruitingChatRpcErrorDe,
  normalizeAgencyRecruitingChatRpcUuid,
  agencyStartRecruitingChatRpc,
} from '../recruitingChatSupabase';

const supabaseRpc = supabase.rpc as jest.Mock;

describe('isAgencyRecruitingChatRpcMissingError', () => {
  it('returns false for bare PGRST202 (often parameter mismatch, not missing function)', () => {
    expect(isAgencyRecruitingChatRpcMissingError({ code: 'PGRST202', message: 'x' })).toBe(false);
  });

  it('returns true when message mentions schema cache', () => {
    expect(
      isAgencyRecruitingChatRpcMissingError({
        message: 'Could not find the function public.agency_start_recruiting_chat in the schema cache',
      })
    ).toBe(true);
  });

  it('returns false for permission errors', () => {
    expect(isAgencyRecruitingChatRpcMissingError({ code: 'P0001', message: 'forbidden' })).toBe(false);
  });

  it('returns false for null', () => {
    expect(isAgencyRecruitingChatRpcMissingError(null)).toBe(false);
  });
});

describe('formatRecruitingChatRpcError', () => {
  it('maps forbidden', () => {
    expect(formatRecruitingChatRpcError({ message: 'forbidden' })).toContain('No permission');
  });

  it('maps wrong agency', () => {
    expect(formatRecruitingChatRpcError({ message: 'wrong agency for application' })).toContain('different agency');
  });
});

describe('normalizeAgencyRecruitingChatRpcUuid', () => {
  it('accepts canonical uuid string', () => {
    expect(normalizeAgencyRecruitingChatRpcUuid('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000'
    );
  });
  it('rejects non-uuid strings', () => {
    expect(normalizeAgencyRecruitingChatRpcUuid('thread-uuid')).toBeNull();
  });
});

describe('formatRecruitingChatRpcErrorDe', () => {
  it('maps forbidden to German', () => {
    expect(formatRecruitingChatRpcErrorDe({ message: 'forbidden' })).toContain('Berechtigung');
  });

  it('includes technical detail for unknown errors', () => {
    expect(formatRecruitingChatRpcErrorDe({ message: 'xyz_unknown_code', details: 'foo' })).toContain('Technisch:');
  });
});

describe('agencyStartRecruitingChatRpc', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('returns ok with thread id', async () => {
    const tid = '550e8400-e29b-41d4-a716-446655440000';
    supabaseRpc.mockResolvedValue({ data: tid, error: null });
    await expect(
      agencyStartRecruitingChatRpc('app-1', 'agency-1', 'Jane D')
    ).resolves.toEqual({ status: 'ok', threadId: tid });
    expect(supabaseRpc).toHaveBeenCalledWith('agency_start_recruiting_chat', {
      p_application_id: 'app-1',
      p_agency_id: 'agency-1',
      p_model_name: 'Jane D',
    });
  });

  it('parses uuid from single-element array', async () => {
    const tid = '550e8400-e29b-41d4-a716-446655440001';
    supabaseRpc.mockResolvedValue({ data: [tid], error: null });
    await expect(agencyStartRecruitingChatRpc('a', 'b', 'c')).resolves.toEqual({
      status: 'ok',
      threadId: tid,
    });
  });

  it('returns missing_rpc when PostgREST cannot find function', async () => {
    supabaseRpc.mockResolvedValue({
      data: null,
      error: {
        code: 'PGRST202',
        message: 'Could not find the function public.agency_start_recruiting_chat in the schema cache',
      },
    });
    await expect(agencyStartRecruitingChatRpc('a', 'b', 'c')).resolves.toEqual({ status: 'missing_rpc' });
  });

  it('returns error on forbidden', async () => {
    supabaseRpc.mockResolvedValue({ data: null, error: { message: 'forbidden' } });
    const r = await agencyStartRecruitingChatRpc('a', 'b', 'c');
    expect(r.status).toBe('error');
    if (r.status === 'error') expect(r.error).toEqual({ message: 'forbidden' });
  });
});
