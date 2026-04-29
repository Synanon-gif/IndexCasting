import {
  getAiAssistantRoleKnowledge,
  getAiAssistantSubtitle,
  getAiAssistantWorkflowGuidance,
  isAiAssistantLiveDataQuestion,
} from '../aiAssistantCopy';

describe('aiAssistantCopy helpers', () => {
  it('selects role-specific subtitles', () => {
    expect(getAiAssistantSubtitle('agency')).toBe('You are using IndexCasting as an Agency.');
    expect(getAiAssistantSubtitle('client')).toBe('You are using IndexCasting as a Client.');
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

  it('uses the real Agency option creation workflow', () => {
    const answer = getAiAssistantWorkflowGuidance('agency', 'option');

    expect(answer).toContain('CALENDAR');
    expect(answer).toContain('ADD OPTION');
    expect(answer).not.toMatch(/\bRoster\b/);
  });

  it('uses the real Agency casting creation workflow', () => {
    const answer = getAiAssistantWorkflowGuidance('agency', 'casting');

    expect(answer).toContain('CALENDAR');
    expect(answer).toContain('ADD CASTING');
    expect(answer).toContain('not the same as a confirmed booking');
  });

  it('keeps Client option guidance away from Agency-only navigation wording', () => {
    const answer = getAiAssistantWorkflowGuidance('client', 'option');

    expect(answer).toContain('Discover');
    expect(answer).toContain('Projects');
    expect(answer).toContain('Request option');
    expect(answer).not.toContain('ADD OPTION');
    expect(answer).not.toContain('MY MODELS');
  });

  it('stores role-specific knowledge with exact Agency labels', () => {
    const agencyKnowledge = getAiAssistantRoleKnowledge('agency');
    const clientKnowledge = getAiAssistantRoleKnowledge('client');

    expect(agencyKnowledge).toContain('DASHBOARD');
    expect(agencyKnowledge).toContain('MY MODELS');
    expect(agencyKnowledge).toContain('CALENDAR');
    expect(agencyKnowledge).toContain('ADD OPTION');
    expect(agencyKnowledge).toContain('ADD CASTING');
    expect(agencyKnowledge).not.toMatch(/\bRoster\b/);
    expect(clientKnowledge).not.toContain('MY MODELS');
    expect(clientKnowledge).not.toContain('ADD OPTION');
  });
});
