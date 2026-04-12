import {
  CHAT_BUBBLE_MAX_WIDTH,
  getOrgMessengerMessageColumnStyle,
  getOrgMessengerSenderLineExtraStyle,
  orgMessengerLayoutTestExports,
} from '../orgMessengerMessageLayout';

describe('orgMessengerMessageLayout', () => {
  it('exports canonical chat bubble max width fraction', () => {
    expect(CHAT_BUBBLE_MAX_WIDTH).toBe('75%');
    expect(orgMessengerLayoutTestExports.CHAT_BUBBLE_MAX_WIDTH).toBe('75%');
  });

  describe('getOrgMessengerMessageColumnStyle', () => {
    it('right-aligns outgoing column with expected gutter', () => {
      const s = getOrgMessengerMessageColumnStyle(true);
      expect(s.width).toBe('100%');
      expect(s.alignItems).toBe('flex-end');
      expect(s.paddingLeft).toBe(orgMessengerLayoutTestExports.OUTGOING_GUTTER_LEFT);
      expect(s.paddingRight).toBeDefined();
    });

    it('left-aligns incoming column without artificial right padding', () => {
      const s = getOrgMessengerMessageColumnStyle(false);
      expect(s.alignItems).toBe('flex-start');
      expect(s.paddingRight).toBeUndefined();
      expect(s.paddingLeft).toBeUndefined();
    });
  });

  describe('getOrgMessengerSenderLineExtraStyle', () => {
    it('adds right text alignment for own messages', () => {
      expect(getOrgMessengerSenderLineExtraStyle(true)).toMatchObject({
        textAlign: 'right',
        alignSelf: 'stretch',
      });
    });

    it('is empty for incoming', () => {
      expect(getOrgMessengerSenderLineExtraStyle(false)).toEqual({});
    });
  });
});
