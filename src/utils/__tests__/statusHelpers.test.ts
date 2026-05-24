import { colors } from '../../theme/theme';
import { toDisplayStatus, statusBgColor, statusColor } from '../statusHelpers';

describe('statusHelpers', () => {
  it('maps in_negotiation to In negotiation', () => {
    expect(toDisplayStatus('in_negotiation', null)).toBe('In negotiation');
  });

  it('maps in_negotiation + accepted price + anchor to Price agreed', () => {
    expect(
      toDisplayStatus('in_negotiation', 'option_pending', {
        clientPriceStatus: 'accepted',
        agencyCounterPrice: 500,
        proposedPrice: null,
      }),
    ).toBe('Price agreed');
  });

  it('does not show Price agreed once option_confirmed (Option confirmed wins)', () => {
    expect(
      toDisplayStatus('in_negotiation', 'option_confirmed', {
        clientPriceStatus: 'accepted',
        agencyCounterPrice: 500,
        proposedPrice: null,
      }),
    ).toBe('Option confirmed');
  });

  // Model inbox: ModelView applies modelInboxRequiresModelConfirmation + "Awaiting your approval"
  // so raw toDisplayStatus here is never the sole label for a linked model awaiting confirmation.
  it('prioritizes final_status when mapping display state', () => {
    expect(toDisplayStatus('in_negotiation', 'option_confirmed')).toBe('Option confirmed');
    expect(toDisplayStatus('in_negotiation', 'option_confirmed', { requestType: 'casting' })).toBe(
      'Casting confirmed',
    );
    expect(toDisplayStatus('rejected', 'job_confirmed')).toBe('Confirmed');
  });

  it('maps casting in_negotiation before availability to Pending (not In negotiation)', () => {
    expect(toDisplayStatus('in_negotiation', 'option_pending', { requestType: 'casting' })).toBe(
      'Pending',
    );
  });

  it('distinguishes option_confirmed from job_confirmed', () => {
    expect(toDisplayStatus('confirmed', 'option_confirmed')).toBe('Confirmed');
    expect(toDisplayStatus('confirmed', 'job_confirmed')).toBe('Confirmed');
  });

  it('keeps stable colors for Option confirmed', () => {
    expect(statusColor('Option confirmed')).toBe(colors.accentGreen);
    expect(statusBgColor('Option confirmed')).toBe('#E6EDEA');
    expect(statusColor('Casting confirmed')).toBe(colors.accentGreen);
    expect(statusBgColor('Casting confirmed')).toBe('#E6EDEA');
  });

  it('keeps stable colors for In negotiation', () => {
    expect(statusColor('In negotiation')).toBe('#6B4E1A');
    expect(statusBgColor('In negotiation')).toBe(colors.surfaceWarm);
  });

  it('keeps stable colors for Price agreed', () => {
    expect(statusColor('Price agreed')).toBe(colors.accentBrown);
    expect(statusBgColor('Price agreed')).toBe(colors.surfaceAlt);
  });
});
