import { formatB2bClientHeaderPrimary } from '../b2bMessengerHeaderTitle';
import { uiCopy } from '../../constants/uiCopy';

describe('formatB2bClientHeaderPrimary', () => {
  const fb = uiCopy.b2bChat.conversationFallback;

  it('combines model and agency with em dash', () => {
    expect(formatB2bClientHeaderPrimary('Poetry of People', 'Ruben E')).toBe('Ruben E — Poetry of People');
  });

  it('returns agency only when no model', () => {
    expect(formatB2bClientHeaderPrimary('Studio North', null)).toBe('Studio North');
  });

  it('returns model only when agency title is generic fallback', () => {
    expect(formatB2bClientHeaderPrimary(fb, 'Anna B')).toBe('Anna B');
  });

  it('returns model only when agency title is empty', () => {
    expect(formatB2bClientHeaderPrimary('   ', 'Anna B')).toBe('Anna B');
  });

  it('returns fallback when nothing usable', () => {
    expect(formatB2bClientHeaderPrimary('', null)).toBe(fb);
    expect(formatB2bClientHeaderPrimary(fb, null)).toBe(fb);
  });
});
