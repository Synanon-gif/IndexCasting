import {
  bubbleColorsForSender,
  isSelfMessage,
  negotiationBubbleAppearance,
  outgoingSelfBubbleColors,
} from '../roleColors';

describe('roleColors — outgoing vs incoming', () => {
  describe('isSelfMessage', () => {
    it('treats client messages as self for client viewer', () => {
      expect(isSelfMessage('client', 'client')).toBe(true);
      expect(isSelfMessage('agency', 'client')).toBe(false);
      expect(isSelfMessage('model', 'client')).toBe(false);
    });

    it('treats agency messages as self for agency viewer', () => {
      expect(isSelfMessage('agency', 'agency')).toBe(true);
      expect(isSelfMessage('client', 'agency')).toBe(false);
      expect(isSelfMessage('model', 'agency')).toBe(false);
    });

    it('treats model messages as self for model viewer', () => {
      expect(isSelfMessage('model', 'model')).toBe(true);
      expect(isSelfMessage('agency', 'model')).toBe(false);
      expect(isSelfMessage('client', 'model')).toBe(false);
    });

    it('never treats system as self', () => {
      expect(isSelfMessage('system', 'client')).toBe(false);
      expect(isSelfMessage('system', 'agency')).toBe(false);
      expect(isSelfMessage('system', 'model')).toBe(false);
    });
  });

  describe('outgoingSelfBubbleColors', () => {
    it('uses soft green background and dark text', () => {
      expect(outgoingSelfBubbleColors.bubbleBackground).toMatch(/^#/);
      expect(outgoingSelfBubbleColors.bubbleText).toMatch(/^#/);
      expect(outgoingSelfBubbleColors.borderColor).toMatch(/^#/);
      expect(outgoingSelfBubbleColors.bubbleBackground).not.toBe(
        bubbleColorsForSender('client').bubbleBackground,
      );
    });
  });

  describe('negotiationBubbleAppearance', () => {
    it('returns outgoing tokens for viewer own messages', () => {
      const a = negotiationBubbleAppearance('client', 'client');
      expect(a.bubbleBackground).toBe(outgoingSelfBubbleColors.bubbleBackground);
      expect(a.bubbleText).toBe(outgoingSelfBubbleColors.bubbleText);
    });

    it('returns role-based tokens for incoming messages', () => {
      const a = negotiationBubbleAppearance('agency', 'client');
      expect(a.bubbleBackground).toBe(bubbleColorsForSender('agency').bubbleBackground);
    });
  });
});
