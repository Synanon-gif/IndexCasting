import { formatB2bClientHeaderPrimary } from '../b2bMessengerHeaderTitle';
import { uiCopy } from '../../constants/uiCopy';

describe('formatB2bClientHeaderPrimary', () => {
  const fb = uiCopy.b2bChat.conversationFallback;

  it('returns the agency org name only — never the model name (B2B org chats are org↔org)', () => {
    expect(formatB2bClientHeaderPrimary('Poetry of People', 'Ruben E')).toBe('Poetry of People');
  });

  it('returns agency only when no model is provided', () => {
    expect(formatB2bClientHeaderPrimary('Studio North', null)).toBe('Studio North');
  });

  it('falls back to the generic copy when agency title is the generic fallback (model is ignored)', () => {
    expect(formatB2bClientHeaderPrimary(fb, 'Anna B')).toBe(fb);
  });

  it('falls back to the generic copy when agency title is empty (model is ignored)', () => {
    expect(formatB2bClientHeaderPrimary('   ', 'Anna B')).toBe(fb);
  });

  it('returns fallback when nothing usable is provided', () => {
    expect(formatB2bClientHeaderPrimary('', null)).toBe(fb);
    expect(formatB2bClientHeaderPrimary(fb, null)).toBe(fb);
  });

  it('ignores the modelName argument when it is provided alongside a real org name', () => {
    expect(formatB2bClientHeaderPrimary('  Hous of Hay  ', 'Some Model Name')).toBe('Hous of Hay');
  });
});
