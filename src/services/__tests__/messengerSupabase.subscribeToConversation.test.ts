jest.mock('../realtimeChannelPool', () => ({
  pooledSubscribe: jest.fn(() => () => {}),
  createRealtimeSubscribeStatusHandler: jest.fn(() => jest.fn()),
}));

import { pooledSubscribe } from '../realtimeChannelPool';
import { subscribeToConversation } from '../messengerSupabase';

describe('subscribeToConversation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not open a pool channel when conversationId is empty', () => {
    const unsub = subscribeToConversation('   ', jest.fn());
    expect(pooledSubscribe).not.toHaveBeenCalled();
    unsub();
    expect(pooledSubscribe).not.toHaveBeenCalled();
  });
});
