import { formatSenderDisplayLine } from '../messengerSenderLabel';

describe('formatSenderDisplayLine', () => {
  it('prefers org role over profile when both provided', () => {
    expect(formatSenderDisplayLine('Jane', 'Booker', 'agent')).toBe('Jane (Booker)');
  });

  it('falls back to profile role when no org role', () => {
    expect(formatSenderDisplayLine('Jane', null, 'client')).toBe('Jane (Client)');
    expect(formatSenderDisplayLine('Jane', null, 'agent')).toBe('Jane (Agency)');
  });

  it('returns name only when no role', () => {
    expect(formatSenderDisplayLine('Jane', null, null)).toBe('Jane');
  });
});
