import { getCanonicalAgreedPrice, getNegotiationDisplayPriceCandidate } from '../canonicalOptionPrice';

describe('canonicalOptionPrice', () => {
  describe('getCanonicalAgreedPrice', () => {
    it('returns counter when accepted and confirmed', () => {
      expect(
        getCanonicalAgreedPrice({
          proposed_price: 1000,
          agency_counter_price: 1200,
          client_price_status: 'accepted',
          final_status: 'option_confirmed',
        }),
      ).toBe(1200);
    });

    it('returns proposed when accepted, confirmed, no counter', () => {
      expect(
        getCanonicalAgreedPrice({
          proposed_price: 1000,
          agency_counter_price: null,
          client_price_status: 'accepted',
          final_status: 'option_confirmed',
        }),
      ).toBe(1000);
    });

    it('returns null when not accepted', () => {
      expect(
        getCanonicalAgreedPrice({
          proposed_price: 1000,
          agency_counter_price: 1200,
          client_price_status: 'pending',
          final_status: 'option_confirmed',
        }),
      ).toBeNull();
    });

    it('returns null when accepted but not terminal final_status', () => {
      expect(
        getCanonicalAgreedPrice({
          proposed_price: 1000,
          client_price_status: 'accepted',
          final_status: 'option_pending',
        }),
      ).toBeNull();
    });

    it('job_confirmed with accepted returns canonical', () => {
      expect(
        getCanonicalAgreedPrice({
          proposed_price: 500,
          agency_counter_price: null,
          client_price_status: 'accepted',
          final_status: 'job_confirmed',
        }),
      ).toBe(500);
    });
  });

  describe('getNegotiationDisplayPriceCandidate', () => {
    it('prefers counter over proposed', () => {
      expect(
        getNegotiationDisplayPriceCandidate({
          proposed_price: 1000,
          agency_counter_price: 1200,
        }),
      ).toBe(1200);
    });

    it('falls back to proposed', () => {
      expect(
        getNegotiationDisplayPriceCandidate({
          proposed_price: 1000,
          agency_counter_price: null,
        }),
      ).toBe(1000);
    });
  });
});
