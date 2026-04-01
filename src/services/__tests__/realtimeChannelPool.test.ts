/**
 * Unit tests for realtimeChannelPool.
 *
 * Uses Jest fake timers to control IDLE_EVICT_MS without real delays.
 * The supabase module is mocked so no network connections are made.
 *
 * Each test calls jest.resetModules() + reimports the pool module to get a
 * fresh, empty pool Map, avoiding cross-test contamination.
 */

import type * as PoolModule from '../realtimeChannelPool';
import type { RealtimeChannel } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Mock factory — recreated on every resetModules() call.
// ---------------------------------------------------------------------------
jest.mock('../../../lib/supabase', () => ({
  supabase: {
    channel: jest.fn(() => ({
      on: jest.fn().mockReturnThis(),
      subscribe: jest.fn().mockReturnThis(),
    })),
    removeChannel: jest.fn(),
  },
}));

// Helper: after a jest.resetModules() the mock cache is also cleared.
// Re-requiring supabase first "warms" the cache so the pool module later
// gets the same mock instances.
function freshMocks(): { channel: jest.Mock; removeChannel: jest.Mock } {
  const mod = jest.requireMock('../../../lib/supabase') as {
    supabase: { channel: jest.Mock; removeChannel: jest.Mock };
  };
  return mod.supabase;
}

function freshPool(): typeof PoolModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('../realtimeChannelPool') as typeof PoolModule;
}

// noop setup — pool module itself is imported fresh inside each test
const noop = (_ch: RealtimeChannel) => _ch;

beforeEach(() => {
  jest.resetModules(); // clear module cache → fresh pool Map on next require
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

// ---------------------------------------------------------------------------
// Basic subscribe / unsubscribe
// ---------------------------------------------------------------------------

describe('pooledSubscribe — basic', () => {
  test('creates a channel on first subscribe', () => {
    const { channel } = freshMocks();
    const { pooledSubscribe } = freshPool();
    pooledSubscribe('conv-1', noop, jest.fn());
    expect(channel).toHaveBeenCalledWith('conv-1');
  });

  test('reuses the same channel for a second subscriber on the same key', () => {
    const { channel } = freshMocks();
    const { pooledSubscribe } = freshPool();
    const setup = jest.fn(noop);
    pooledSubscribe('conv-2', setup, jest.fn());
    pooledSubscribe('conv-2', setup, jest.fn());
    expect(channel).toHaveBeenCalledTimes(1);
    expect(setup).toHaveBeenCalledTimes(1);
  });

  test('dispatches events to all registered callbacks', () => {
    freshMocks();
    const { pooledSubscribe } = freshPool();
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    let dispatchFn: ((p: unknown) => void) | null = null;
    const setup = jest.fn((_ch: RealtimeChannel, dispatch: (p: unknown) => void) => {
      dispatchFn = dispatch;
      return _ch;
    });
    pooledSubscribe('conv-3', setup, cb1);
    pooledSubscribe('conv-3', setup, cb2);
    dispatchFn!({ type: 'INSERT' });
    expect(cb1).toHaveBeenCalledWith({ type: 'INSERT' });
    expect(cb2).toHaveBeenCalledWith({ type: 'INSERT' });
  });
});

// ---------------------------------------------------------------------------
// Cleanup / idle eviction
// ---------------------------------------------------------------------------

describe('pooledSubscribe — cleanup', () => {
  test('does not remove channel immediately on last unsubscribe', () => {
    const { removeChannel } = freshMocks();
    const { pooledSubscribe } = freshPool();
    const cleanup = pooledSubscribe('conv-4', noop, jest.fn());
    cleanup();
    expect(removeChannel).not.toHaveBeenCalled();
  });

  test('removes channel after IDLE_EVICT_MS (30 s) when ref-count drops to 0', () => {
    const { removeChannel } = freshMocks();
    const { pooledSubscribe } = freshPool();
    const cleanup = pooledSubscribe('conv-5', noop, jest.fn());
    cleanup();
    jest.advanceTimersByTime(30_000);
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  test('cancels idle eviction when a new subscriber joins before timeout', () => {
    const { removeChannel } = freshMocks();
    const { pooledSubscribe } = freshPool();
    const cleanup1 = pooledSubscribe('conv-6', noop, jest.fn());
    cleanup1();
    jest.advanceTimersByTime(15_000);
    pooledSubscribe('conv-6', noop, jest.fn());
    jest.advanceTimersByTime(30_000);
    expect(removeChannel).not.toHaveBeenCalled();
  });

  test('double-calling the cleanup function does not create extra timers', () => {
    const { removeChannel } = freshMocks();
    const { pooledSubscribe } = freshPool();
    const cleanup = pooledSubscribe('conv-7', noop, jest.fn());
    cleanup();
    cleanup(); // second call must be a no-op
    jest.advanceTimersByTime(30_000);
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });

  test('channel stays open until all subscribers unsubscribe', () => {
    const { removeChannel } = freshMocks();
    const { pooledSubscribe } = freshPool();
    const c1 = pooledSubscribe('conv-8', noop, jest.fn());
    const c2 = pooledSubscribe('conv-8', noop, jest.fn());
    c1();
    jest.advanceTimersByTime(30_000);
    expect(removeChannel).not.toHaveBeenCalled(); // c2 still active
    c2();
    jest.advanceTimersByTime(30_000);
    expect(removeChannel).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Diagnostics helpers
// ---------------------------------------------------------------------------

describe('getChannelPoolStats', () => {
  test('reports correct active / idle counts', () => {
    freshMocks();
    const { pooledSubscribe, getChannelPoolStats } = freshPool();
    const c1 = pooledSubscribe('stat-1', noop, jest.fn());
    pooledSubscribe('stat-2', noop, jest.fn());
    c1(); // stat-1 goes idle (timer pending)
    const stats = getChannelPoolStats();
    expect(stats.active).toBe(1); // stat-2
    expect(stats.idle).toBe(1);   // stat-1
    expect(stats.total).toBe(2);
  });
});

describe('flushIdleChannels', () => {
  test('immediately removes all idle channels and leaves active ones', () => {
    const { removeChannel } = freshMocks();
    const { pooledSubscribe, flushIdleChannels, getChannelPoolStats } = freshPool();
    const c1 = pooledSubscribe('flush-1', noop, jest.fn());
    c1(); // flush-1 goes idle
    pooledSubscribe('flush-2', noop, jest.fn()); // flush-2 stays active
    flushIdleChannels();
    expect(removeChannel).toHaveBeenCalledTimes(1);
    const stats = getChannelPoolStats();
    expect(stats.idle).toBe(0);
    expect(stats.active).toBe(1);
  });
});
