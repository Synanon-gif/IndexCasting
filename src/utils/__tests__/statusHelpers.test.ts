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

  it('does not show Price agreed once option_confirmed (Confirmed wins)', () => {
    expect(
      toDisplayStatus('in_negotiation', 'option_confirmed', {
        clientPriceStatus: 'accepted',
        agencyCounterPrice: 500,
        proposedPrice: null,
      }),
    ).toBe('Confirmed');
  });

  it('prioritizes final_status when mapping display state', () => {
    expect(toDisplayStatus('in_negotiation', 'option_confirmed')).toBe('Confirmed');
    expect(toDisplayStatus('rejected', 'job_confirmed')).toBe('Confirmed');
  });

  it('keeps option_confirmed as Confirmed display (attention layer handles job confirmation pending separately)', () => {
    expect(toDisplayStatus('confirmed', 'option_confirmed')).toBe('Confirmed');
  });

  it('keeps stable colors for In negotiation', () => {
    expect(statusColor('In negotiation')).toBe('#d97706');
    expect(statusBgColor('In negotiation')).toBe('#fef3c7');
  });

  it('keeps stable colors for Price agreed', () => {
    expect(statusColor('Price agreed')).toBe('#2563eb');
    expect(statusBgColor('Price agreed')).toBe('#dbeafe');
  });
});
