import { parseAgencyModelContextId } from '../parseAgencyModelContextId';

describe('parseAgencyModelContextId', () => {
  it('parses agency-model:{agency}:{model}', () => {
    const a = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const m = '11111111-2222-3333-4444-555555555555';
    expect(parseAgencyModelContextId(`agency-model:${a}:${m}`)).toEqual({
      agencyId: a,
      modelId: m,
    });
  });

  it('returns null for invalid input', () => {
    expect(parseAgencyModelContextId(null)).toBeNull();
    expect(parseAgencyModelContextId('')).toBeNull();
    expect(parseAgencyModelContextId('client-org:xx')).toBeNull();
    expect(parseAgencyModelContextId('agency-model:only-one')).toBeNull();
  });
});
