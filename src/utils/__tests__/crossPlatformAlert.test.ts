/**
 * Web branch uses window.confirm; Jest environment is node — provide window for this suite.
 */
jest.mock('react-native', () => ({
  Platform: { OS: 'web' },
  Alert: {
    alert: jest.fn(() => {
      throw new Error('Alert.alert should not run when Platform.OS is web');
    }),
  },
}));

import { showConfirmAlert } from '../crossPlatformAlert';

describe('crossPlatformAlert (web Platform)', () => {
  it('showConfirmAlert ruft onConfirm wenn window.confirm true', () => {
    const confirm = jest.fn().mockReturnValue(true);
    (globalThis as unknown as Record<string, unknown>).window = { confirm };

    const onConfirm = jest.fn();
    showConfirmAlert('Title', 'Message', onConfirm, 'Go');

    expect(confirm).toHaveBeenCalled();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('showConfirmAlert ruft onCancel wenn window.confirm false', () => {
    const confirm = jest.fn().mockReturnValue(false);
    (globalThis as unknown as Record<string, unknown>).window = { confirm };

    const onConfirm = jest.fn();
    const onCancel = jest.fn();
    showConfirmAlert('Title', 'Message', onConfirm, 'Go', onCancel);

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});
