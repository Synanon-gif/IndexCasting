import {
  BOOKING_BRIEF_FIELD_KEYS,
  buildBookingBriefDraft,
  filterBriefForRole,
  mergeBookingBriefFromEditor,
  parseBookingBrief,
  getEditableBriefFieldKeys,
  type BookingBrief,
} from '../bookingBrief';

describe('bookingBrief', () => {
  const sample: BookingBrief = {
    shoot_details: { scope: 'shared', text: '  Studio A  ' },
    location: { scope: 'agency', text: 'Secret studio' },
    contact: { scope: 'client', text: 'Client phone' },
    call_time: { scope: 'model', text: 'Model only' },
    deliverables: { scope: 'shared', text: 'Polaroids' },
  };

  it('filterBriefForRole returns shared and own private only', () => {
    expect(filterBriefForRole(sample, 'agency')).toEqual({
      shoot_details: { scope: 'shared', text: 'Studio A' },
      location: { scope: 'agency', text: 'Secret studio' },
      deliverables: { scope: 'shared', text: 'Polaroids' },
    });
    expect(filterBriefForRole(sample, 'client')).toEqual({
      shoot_details: { scope: 'shared', text: 'Studio A' },
      contact: { scope: 'client', text: 'Client phone' },
      deliverables: { scope: 'shared', text: 'Polaroids' },
    });
    expect(filterBriefForRole(sample, 'model')).toEqual({
      shoot_details: { scope: 'shared', text: 'Studio A' },
      call_time: { scope: 'model', text: 'Model only' },
      deliverables: { scope: 'shared', text: 'Polaroids' },
    });
  });

  it('getEditableBriefFieldKeys hides other parties private fields', () => {
    expect(getEditableBriefFieldKeys(sample, 'agency')).toEqual(
      expect.arrayContaining(['shoot_details', 'location', 'deliverables']),
    );
    expect(getEditableBriefFieldKeys(sample, 'agency')).not.toContain('contact');
    expect(getEditableBriefFieldKeys(sample, 'agency')).not.toContain('call_time');
  });

  it('mergeBookingBriefFromEditor preserves non-editable keys', () => {
    const draft = buildBookingBriefDraft(sample, 'agency');
    draft.shoot_details = { text: 'Updated shoot', scope: 'shared' };
    draft.location = { text: '', scope: 'agency' }; // clear
    const merged = mergeBookingBriefFromEditor(sample, draft, 'agency');
    expect(merged.shoot_details).toEqual({ scope: 'shared', text: 'Updated shoot' });
    expect(merged.location).toBeUndefined();
    expect(merged.contact).toEqual({ scope: 'client', text: 'Client phone' });
    expect(merged.call_time).toEqual({ scope: 'model', text: 'Model only' });
  });

  it('parseBookingBrief ignores invalid entries', () => {
    expect(parseBookingBrief(null)).toBeUndefined();
    expect(parseBookingBrief({ shoot_details: { scope: 'bogus', text: 'x' } })).toBeUndefined();
    expect(
      parseBookingBrief({
        shoot_details: { scope: 'shared', text: '  ok  ' },
        location: { scope: 'agency', text: '' },
      }),
    ).toEqual({ shoot_details: { scope: 'shared', text: 'ok' } });
  });

  it('BOOKING_BRIEF_FIELD_KEYS has five keys', () => {
    expect(BOOKING_BRIEF_FIELD_KEYS).toHaveLength(5);
  });

  it('merge clamps illegal scope to shared', () => {
    const brief: BookingBrief = {};
    const draft = buildBookingBriefDraft(brief, 'agency');
    draft.shoot_details = { text: 'Hi', scope: 'client' }; // agency editor cannot set client scope
    const merged = mergeBookingBriefFromEditor(brief, draft, 'agency');
    expect(merged.shoot_details?.scope).toBe('shared');
  });
});
