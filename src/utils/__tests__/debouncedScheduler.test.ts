import { createDebouncedScheduler } from '../debouncedScheduler';

describe('createDebouncedScheduler (dashboard focus refresh)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('debounces repeated schedule calls into one fire', () => {
    const onFire = jest.fn();
    const { schedule } = createDebouncedScheduler(onFire, 300);

    schedule();
    schedule();
    expect(onFire).not.toHaveBeenCalled();

    jest.advanceTimersByTime(299);
    expect(onFire).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it('clear prevents pending fire', () => {
    const onFire = jest.fn();
    const { schedule, clear } = createDebouncedScheduler(onFire, 100);
    schedule();
    clear();
    jest.advanceTimersByTime(200);
    expect(onFire).not.toHaveBeenCalled();
  });
});
