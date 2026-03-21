import { buildInviteAbsoluteUrl, buildInviteDeepLinkPath } from '../inviteUrlHelpers';

describe('inviteUrlHelpers', () => {
  describe('buildInviteAbsoluteUrl', () => {
    it('setzt invite-Query auf vollständiger URL', () => {
      const url = buildInviteAbsoluteUrl('https://app.example.com', '/dashboard', 'tok_abc');
      expect(url).toBe('https://app.example.com/dashboard?invite=tok_abc');
    });

    it('nutzt / wenn pathname leer', () => {
      const url = buildInviteAbsoluteUrl('https://app.example.com', '', 'x');
      expect(url).toBe('https://app.example.com/?invite=x');
    });

    it('encodiert Sonderzeichen im Token', () => {
      const url = buildInviteAbsoluteUrl('https://x.com', '/', 'a+b=c');
      expect(url).toContain('invite=a%2Bb%3Dc');
    });
  });

  describe('buildInviteDeepLinkPath', () => {
    it('liefert relativen Pfad mit encodiertem Token', () => {
      expect(buildInviteDeepLinkPath('hello world')).toBe('/?invite=hello%20world');
    });
  });
});
