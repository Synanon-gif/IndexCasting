import { toDisplayStatus, statusBgColor, statusColor } from '../statusHelpers';

describe('statusHelpers', () => {
  it('maps in_negotiation to In negotiation', () => {
    expect(toDisplayStatus('in_negotiation', null)).toBe('In negotiation');
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
});
