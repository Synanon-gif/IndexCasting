import { handleTabPress, BOTTOM_TAB_BAR_HEIGHT } from '../bottomTabNavigation';

describe('bottomTabNavigation', () => {
  it('BOTTOM_TAB_BAR_HEIGHT is a positive number', () => {
    expect(BOTTOM_TAB_BAR_HEIGHT).toBeGreaterThan(0);
  });

  it('switches tab when next differs from current', () => {
    const setTab = jest.fn();
    const onReselectRoot = jest.fn();
    handleTabPress({
      current: 'a',
      next: 'b',
      setTab,
      onReselectRoot,
    });
    expect(setTab).toHaveBeenCalledWith('b');
    expect(onReselectRoot).not.toHaveBeenCalled();
  });

  it('calls onReselectRoot when re-selecting the same tab', () => {
    const setTab = jest.fn();
    const onReselectRoot = jest.fn();
    handleTabPress({
      current: 'projects',
      next: 'projects',
      setTab,
      onReselectRoot,
    });
    expect(onReselectRoot).toHaveBeenCalledTimes(1);
    expect(setTab).not.toHaveBeenCalled();
  });

  it('handles rapid alternate presses logically', () => {
    const setTab = jest.fn();
    const reselect = jest.fn();
    handleTabPress({ current: 'a', next: 'b', setTab, onReselectRoot: reselect });
    handleTabPress({ current: 'b', next: 'b', setTab, onReselectRoot: reselect });
    handleTabPress({ current: 'b', next: 'a', setTab, onReselectRoot: reselect });
    expect(setTab).toHaveBeenCalledTimes(2);
    expect(setTab.mock.calls).toEqual([['b'], ['a']]);
    expect(reselect).toHaveBeenCalledTimes(1);
  });
});
