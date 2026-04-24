import { validateDirectionParticipants } from '../manualInvoicesSupabase';

describe('validateDirectionParticipants', () => {
  describe('agency_to_client', () => {
    it('allows correct sender (agency profile) + recipient (counterparty)', () => {
      expect(
        validateDirectionParticipants({
          direction: 'agency_to_client',
          sender_agency_profile_id: 'a',
          recipient_counterparty_id: 'c',
        }),
      ).toBeNull();
    });

    it('rejects swapped sides', () => {
      expect(
        validateDirectionParticipants({
          direction: 'agency_to_client',
          sender_counterparty_id: 'a',
          recipient_counterparty_id: 'c',
        }),
      ).toBe('agency_to_client_sender_must_be_agency_profile');
      expect(
        validateDirectionParticipants({
          direction: 'agency_to_client',
          sender_agency_profile_id: 'a',
          recipient_agency_profile_id: 'r',
        }),
      ).toBe('agency_to_client_recipient_must_be_counterparty');
    });

    it('blocks duplicate side selection (agency AND counterparty)', () => {
      expect(
        validateDirectionParticipants({
          direction: 'agency_to_client',
          sender_agency_profile_id: 'a',
          sender_counterparty_id: 'b',
        }),
      ).toBe('sender_must_be_either_agency_or_counterparty');
    });

    it('requires both sides when requireBothSelected = true', () => {
      expect(
        validateDirectionParticipants(
          {
            direction: 'agency_to_client',
            sender_agency_profile_id: 'a',
          },
          { requireBothSelected: true },
        ),
      ).toBe('missing_recipient_client_profile');
      expect(
        validateDirectionParticipants(
          {
            direction: 'agency_to_client',
            recipient_counterparty_id: 'c',
          },
          { requireBothSelected: true },
        ),
      ).toBe('missing_sender_agency_profile');
    });
  });

  describe('agency_to_model', () => {
    it('allows correct sender (agency) + recipient (counterparty=model)', () => {
      expect(
        validateDirectionParticipants({
          direction: 'agency_to_model',
          sender_agency_profile_id: 'a',
          recipient_counterparty_id: 'm',
        }),
      ).toBeNull();
    });

    it('blocks recipient agency profile', () => {
      expect(
        validateDirectionParticipants({
          direction: 'agency_to_model',
          sender_agency_profile_id: 'a',
          recipient_agency_profile_id: 'a2',
        }),
      ).toBe('agency_to_model_recipient_must_be_counterparty');
    });
  });

  describe('model_to_agency', () => {
    it('allows correct sender (counterparty) + recipient (agency)', () => {
      expect(
        validateDirectionParticipants({
          direction: 'model_to_agency',
          sender_counterparty_id: 'm',
          recipient_agency_profile_id: 'a',
        }),
      ).toBeNull();
    });

    it('blocks sender agency profile', () => {
      expect(
        validateDirectionParticipants({
          direction: 'model_to_agency',
          sender_agency_profile_id: 'a',
          recipient_agency_profile_id: 'a',
        }),
      ).toBe('model_to_agency_sender_must_be_counterparty');
    });

    it('reports both required sides on incomplete data', () => {
      expect(
        validateDirectionParticipants(
          { direction: 'model_to_agency' },
          { requireBothSelected: true },
        ),
      ).toBe('missing_sender_model_profile');
    });
  });

  it('rejects invalid direction', () => {
    expect(
      validateDirectionParticipants({
        // @ts-expect-error — intentional
        direction: 'unknown',
      }),
    ).toBe('invalid_direction');
  });
});
