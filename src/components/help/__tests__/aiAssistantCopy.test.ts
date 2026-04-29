import { getAiAssistantSubtitle, isAiAssistantLiveDataQuestion } from '../aiAssistantCopy';

describe('aiAssistantCopy helpers', () => {
  it('selects role-specific subtitles', () => {
    expect(getAiAssistantSubtitle('agency')).toBe('Agency workflow guidance');
    expect(getAiAssistantSubtitle('client')).toBe('Client workflow guidance');
    expect(getAiAssistantSubtitle('model')).toBe('Model account guidance');
  });

  it('classifies live-data questions that must be refused', () => {
    expect(isAiAssistantLiveDataQuestion('Which bookings do I have tomorrow?')).toBe(true);
    expect(isAiAssistantLiveDataQuestion('Show my invoices')).toBe(true);
    expect(isAiAssistantLiveDataQuestion('Who is in my organization?')).toBe(true);
    expect(isAiAssistantLiveDataQuestion('What did this client say?')).toBe(true);
  });

  it('does not classify static help questions as live-data requests', () => {
    expect(isAiAssistantLiveDataQuestion('How do I create an option?')).toBe(false);
    expect(isAiAssistantLiveDataQuestion('Where can I find settings?')).toBe(false);
  });
});
